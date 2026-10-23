/**
 * Browser controller for /rooms (ADR-019). One page, three screens:
 *
 *   /rooms                     the host enters names and creates a room
 *   /rooms?code=ABCD&screen=board   the shared board (public view, no controls)
 *   /rooms?code=ABCD           a phone: pick a seat, then play that seat
 *
 * The server is the arbiter. This file only sends commands, keeps the seat
 * token, and polls for the view through the RoomFeed; the play screen
 * (src/ui/play.ts) draws it. It holds no rules.
 */
import { createRoomFeed, type FeedAnswer } from '../lib/app/room-feed';
import type { RoomView } from '../lib/app/rooms';
import { parseRoomCode } from '../lib/app/rooms';
import type { PlayCommand } from '../lib/games/catan-play/commands';
import { createFeedback, el, type FailureReporter, required } from './feedback';
import { mountPlay, type PlayScreen, type PlaySnapshot, type PlaySource, type Viewer } from './play';

const API = '/api/rooms';
const tokenKey = (code: string) => `catan-room:${code}`;

interface Seat {
	readonly token: string;
	readonly player: string;
}

/** The server answered with something other than the rooms API (the static site has none). */
class NoServerError extends Error {
	constructor() {
		super('Rooms need the server version of the site.');
		this.name = 'NoServerError';
	}
}

class ApiError extends Error {
	constructor(
		readonly status: number,
		message: string,
		readonly code?: string,
	) {
		super(message);
		this.name = 'ApiError';
	}
}

async function call<T>(method: 'GET' | 'POST', path: string, token: string | null, body?: unknown): Promise<T> {
	const response = await fetch(path, {
		method,
		headers: { 'content-type': 'application/json', ...(token ? { 'x-room-token': token } : {}) },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
	if (!(response.headers.get('content-type') ?? '').includes('application/json')) throw new NoServerError();
	const data = (await response.json()) as Record<string, unknown>;
	if (!response.ok) throw new ApiError(response.status, String(data['error'] ?? 'The request failed.'), data['code'] as string | undefined);
	return data as T;
}

const loadSeat = (code: string): Seat | null => {
	try {
		const raw = localStorage.getItem(tokenKey(code));
		const seat = raw ? (JSON.parse(raw) as Partial<Seat>) : null;
		return seat && typeof seat.token === 'string' && typeof seat.player === 'string' ? (seat as Seat) : null;
	} catch {
		return null;
	}
};
const saveSeat = (code: string, seat: Seat | null) => {
	try {
		if (seat) localStorage.setItem(tokenKey(code), JSON.stringify(seat));
		else localStorage.removeItem(tokenKey(code));
	} catch {
		// Storage blocked: the seat lasts until the tab closes.
	}
};

const toSnapshot = (view: RoomView): PlaySnapshot => ({
	state: view.state,
	history: view.history,
	cardCounts: view.cardCounts,
	devCardCounts: view.devCardCounts,
});

export function startRooms(report: FailureReporter): void {
	const announcer = required<HTMLElement>('#announcer');
	const failure = required<HTMLElement>('#failure');
	const feedback = createFeedback(announcer, failure, report);
	const loading = required<HTMLElement>('#loading');
	const host = required<HTMLElement>('#room-host');
	const join = required<HTMLElement>('#room-join');
	const bar = required<HTMLElement>('#room-bar');
	const noServer = required<HTMLElement>('#no-server');
	const playSection = required<HTMLElement>('#play');

	const params = new URLSearchParams(location.search);
	const code = parseRoomCode(params.get('code') ?? '');
	const isBoard = params.get('screen') === 'board';

	const only = (visible: HTMLElement | null) => {
		for (const section of [loading, host, join, playSection]) section.hidden = section !== visible;
	};

	const handle = (error: unknown, context: string, retry: () => Promise<void>) => {
		if (error instanceof NoServerError) {
			only(null);
			bar.hidden = true;
			noServer.hidden = false;
			return;
		}
		if (error instanceof ApiError && error.status < 500) {
			// A refusal the person can act on (no such room, seat taken): say so, no Try again.
			feedback.inform(error.status === 404 ? 'Room not found' : 'That did not work', error.message);
			return;
		}
		feedback.fail(error, context, retry);
	};

	// ------------------------------------------------------------ host: create a room

	function showHost() {
		only(host);
		const form = required<HTMLFormElement>('#room-form');
		form.addEventListener('submit', async (event) => {
			event.preventDefault();
			const names = [...form.querySelectorAll<HTMLInputElement>('input[name="player"]')].map((i) => i.value.trim()).filter(Boolean);
			const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
			if (submit) submit.disabled = true;
			try {
				const { code: created } = await call<{ code: string }>('POST', API, null, { action: 'create', names });
				location.assign(`/rooms?code=${created}&screen=board`);
			} catch (error) {
				handle(error, 'rooms:create', async () => form.requestSubmit());
			} finally {
				if (submit) submit.disabled = false;
			}
		});
	}

	// ------------------------------------------------------------ the room bar (code, link, seats)

	function drawBar(view: RoomView, seat: Seat | null) {
		bar.hidden = false;
		const link = `${location.origin}/rooms?code=${view.code}`;
		const codeLine = el('p', 'room-bar__code');
		codeLine.append(el('span', 'room-bar__label', 'Room '), el('strong', 'room-bar__value', view.code));
		const items: HTMLElement[] = [codeLine];
		if (seat) {
			items.push(el('p', 'room-bar__you', `You are ${seat.player}`));
		} else {
			const linkLine = el('p', 'room-bar__link');
			const a = el('a', undefined, link);
			a.href = link;
			linkLine.append(document.createTextNode('Join on your phone: '), a);
			items.push(linkLine);
		}
		const seats = el('ul', 'room-bar__seats');
		seats.setAttribute('aria-label', 'Seats');
		view.seats.forEach((s, i) => {
			const chip = el('li', `room-seat${s.joined ? ' room-seat--joined' : ''}`);
			chip.append(el('span', `seat seat--${i + 1}`, String(i + 1)), document.createTextNode(` ${s.name}${s.joined ? '' : ' (not joined)'}`));
			seats.append(chip);
		});
		items.push(seats);
		bar.replaceChildren(...items);
	}

	// ------------------------------------------------------------ playing (board or seat)

	async function play(roomCode: string, seat: Seat | null) {
		let latest: RoomView | null = null;
		const viewer: Viewer = seat ? { kind: 'seat', player: seat.player } : { kind: 'board' };
		const fetchView = (since: number | null) =>
			call<FeedAnswer<RoomView>>('GET', `${API}?code=${roomCode}${since === null ? '' : `&since=${since}`}`, seat?.token ?? null);

		const source: PlaySource = {
			async snapshot() {
				if (!latest) {
					const answer = await fetchView(null);
					if (!('unchanged' in answer)) latest = answer;
				}
				if (!latest) throw new Error('The room view did not load.');
				return toSnapshot(latest);
			},
			async run(command: PlayCommand) {
				try {
					await call('POST', API, seat?.token ?? null, { action: 'command', code: roomCode, command });
				} catch (error) {
					if (error instanceof ApiError && error.status < 500) return { ok: false, message: error.message };
					throw error;
				}
				const before = latest?.history.length ?? 0;
				const answer = await fetchView(null);
				if (!('unchanged' in answer)) latest = answer;
				const snapshot = await source.snapshot();
				return { ok: true, snapshot, announce: `${snapshot.history.slice(before).join('. ')}.` };
			},
		};

		let screen: PlayScreen | null = null;
		const feed = createRoomFeed<RoomView>({
			fetch: fetchView,
			onView: (view) => {
				const first = latest === null;
				latest = view;
				drawBar(view, seat);
				feedback.clearFailure();
				if (!screen) return;
				void (first ? screen.render() : screen.update(toSnapshot(view)));
			},
			onError: (error) => {
				if (error instanceof ApiError && error.code === 'BAD_TOKEN') {
					// The seat was lost (a new room with this code, or storage was cleared).
					saveSeat(roomCode, null);
					feed.stop();
					void showJoin(roomCode);
					return;
				}
				handle(error, 'rooms:view', async () => feed.refresh());
			},
			isHidden: () => document.hidden,
			now: () => Date.now(),
			setTimer: (run, ms) => setTimeout(run, ms),
			clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
		});
		document.addEventListener('visibilitychange', () => {
			if (!document.hidden) void feed.refresh();
		});

		// Push (ADR-019): a socket that says "changed"; polling remains the fallback.
		let socketTries = 0;
		const connectPush = (url: string) => {
			let socket: WebSocket;
			try {
				socket = new WebSocket(`${url}?code=${roomCode}`);
			} catch {
				return;
			}
			socket.addEventListener('open', () => {
				socketTries = 0;
				feed.setPushConnected(true);
				void feed.refresh(); // catch up on anything missed while disconnected
			});
			socket.addEventListener('message', (event) => {
				try {
					if ((JSON.parse(String(event.data)) as { type?: string }).type === 'changed') void feed.refresh();
				} catch {
					// Not a notice; ignore.
				}
			});
			socket.addEventListener('close', () => {
				feed.setPushConnected(false);
				// API Gateway closes idle sockets after 10 minutes; reconnect with back-off.
				socketTries += 1;
				setTimeout(() => connectPush(url), Math.min(30_000, 1000 * 2 ** Math.min(socketTries, 5)));
			});
		};

		screen = mountPlay(source, feedback, () => only(playSection), viewer);
		await feed.start();
		if (latest) {
			await screen.render();
			const push = (latest as RoomView & { push?: string }).push;
			if (push) connectPush(push);
		}
	}

	// ------------------------------------------------------------ phone: pick a seat

	async function showJoin(roomCode: string) {
		const view = await call<RoomView>('GET', `${API}?code=${roomCode}`, null);
		drawBar(view, null);
		only(join);
		const list = required<HTMLElement>('#seat-list');
		list.replaceChildren(
			...view.seats.map((s, i) => {
				const item = el('li', 'seat-choice');
				const b = el('button', 'button seat-choice__button');
				b.type = 'button';
				b.disabled = s.joined;
				b.append(el('span', `seat seat--${i + 1}`, String(i + 1)), document.createTextNode(s.joined ? `${s.name} (taken)` : `Play as ${s.name}`));
				b.addEventListener('click', async () => {
					b.disabled = true;
					try {
						const seat = await call<Seat>('POST', API, null, { action: 'join', code: roomCode, seat: i });
						saveSeat(roomCode, seat);
						feedback.announce(`You are playing as ${seat.player}.`);
						await play(roomCode, seat);
					} catch (error) {
						b.disabled = false;
						handle(error, 'rooms:join', async () => b.click());
						if (error instanceof ApiError && error.status === 409) void showJoin(roomCode);
					}
				});
				item.append(b);
				return item;
			}),
		);
		list.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
	}

	// ------------------------------------------------------------ start

	const begin = async () => {
		if (!code) return showHost();
		if (isBoard) return play(code, null);
		const seat = loadSeat(code);
		return seat ? play(code, seat) : showJoin(code);
	};
	begin().catch((error) => handle(error, 'rooms:start', begin));
}
