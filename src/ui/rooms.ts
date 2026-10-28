/**
 * Browser controller for /rooms (ADR-019, ADR-021). One page, four screens:
 *
 *   /rooms                          start a room (choose how many play) or type a code
 *   /rooms?code=ABCD&screen=board   the shared board: the lobby, then the game (public view)
 *   /rooms?code=ABCD                a phone: type your name, wait in the lobby, then play
 *
 * The server is the arbiter. This file only sends commands, keeps the host and
 * seat tokens, and follows the room through the RoomFeed (push with polling as
 * the fallback); the play screen (src/ui/play.ts) draws the game. No rules here.
 */
import { createRoomFeed, type FeedAnswer } from '../lib/app/room-feed';
import { MAX_NAME_LENGTH, parsePlayerName, parseRoomCode, type RoomView } from '../lib/app/rooms';
import { MAX_PLAYERS, MIN_PLAYERS } from '../lib/games/catan/decide';
import type { PlayCommand } from '../lib/games/catan-play/commands';
import { createFeedback, el, type FailureReporter, required } from './feedback';
import { iconElement } from './icons';
import { mountPlay, type PlayScreen, type PlaySnapshot, type PlaySource, type Viewer } from './play';

const API = '/api/rooms';
const seatKey = (code: string) => `catan-room:${code}`;
const hostKey = (code: string) => `catan-room-host:${code}`;

interface Seat {
	readonly token: string;
	readonly player: string;
}

type PushView = RoomView & { readonly push?: string };

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

function load<T>(key: string, valid: (v: unknown) => v is T): T | null {
	try {
		const raw = localStorage.getItem(key);
		const value: unknown = raw ? JSON.parse(raw) : null;
		return valid(value) ? value : null;
	} catch {
		return null;
	}
}
function save(key: string, value: unknown) {
	try {
		if (value === null) localStorage.removeItem(key);
		else localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// Storage blocked: the token lasts until the tab closes.
	}
}
const isSeat = (v: unknown): v is Seat =>
	typeof v === 'object' && v !== null && typeof (v as Seat).token === 'string' && typeof (v as Seat).player === 'string';
const isText = (v: unknown): v is string => typeof v === 'string';

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
	const lobby = required<HTMLElement>('#room-lobby');
	const bar = required<HTMLElement>('#room-bar');
	const noServer = required<HTMLElement>('#no-server');
	const playSection = required<HTMLElement>('#play');

	const params = new URLSearchParams(location.search);
	const code = parseRoomCode(params.get('code') ?? '');
	const isBoard = params.get('screen') === 'board';

	const only = (visible: HTMLElement | null) => {
		for (const section of [loading, host, join, lobby, playSection]) section.hidden = section !== visible;
	};

	const handle = (error: unknown, context: string, retry: () => Promise<void>) => {
		if (error instanceof NoServerError) {
			only(null);
			bar.hidden = true;
			noServer.hidden = false;
			return;
		}
		if (error instanceof ApiError && error.status < 500) {
			// A refusal the person can act on (no such room, name taken): say so, no Try again.
			feedback.inform(error.status === 404 ? 'Room not found' : 'That did not work', error.message);
			return;
		}
		feedback.fail(error, context, retry);
	};

	// ------------------------------------------------------------ start a room, or type a code

	function showStart() {
		only(host);
		const count = required<HTMLOutputElement>('#count');
		const less = required<HTMLButtonElement>('#count-less');
		const more = required<HTMLButtonElement>('#count-more');
		let players = 4;
		const sync = () => {
			count.textContent = String(players);
			less.disabled = players <= MIN_PLAYERS;
			more.disabled = players >= MAX_PLAYERS;
		};
		less.addEventListener('click', () => {
			players = Math.max(MIN_PLAYERS, players - 1);
			sync();
		});
		more.addEventListener('click', () => {
			players = Math.min(MAX_PLAYERS, players + 1);
			sync();
		});
		sync();

		const form = required<HTMLFormElement>('#room-form');
		form.addEventListener('submit', async (event) => {
			event.preventDefault();
			const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
			if (submit) submit.disabled = true;
			try {
				const created = await call<{ code: string; hostToken: string }>('POST', API, null, { action: 'create', seats: players });
				save(hostKey(created.code), created.hostToken);
				location.assign(`/rooms?code=${created.code}&screen=board`);
			} catch (error) {
				handle(error, 'rooms:create', async () => form.requestSubmit());
			} finally {
				if (submit) submit.disabled = false;
			}
		});

		const codeForm = required<HTMLFormElement>('#code-form');
		const input = required<HTMLInputElement>('#code-input');
		const codeError = required<HTMLElement>('#code-error');
		codeForm.addEventListener('submit', (event) => {
			event.preventDefault();
			const typed = parseRoomCode(input.value);
			if (!typed) {
				codeError.textContent = 'A room code is 4 letters, like ABCD.';
				codeError.hidden = false;
				input.setAttribute('aria-invalid', 'true');
				input.focus();
				return;
			}
			location.assign(`/rooms?code=${typed}`);
		});
		input.addEventListener('input', () => {
			codeError.hidden = true;
			input.removeAttribute('aria-invalid');
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
		} else if (!view.started) {
			const linkLine = el('p', 'room-bar__link');
			const a = el('a', undefined, link);
			a.href = link;
			linkLine.append(document.createTextNode('Join at '), a);
			items.push(linkLine);
		}
		bar.replaceChildren(...items);
	}

	// ------------------------------------------------------------ the lobby

	function drawLobby(view: RoomView, seat: Seat | null, hostToken: string | null, refresh: () => Promise<void>) {
		only(lobby);
		const joined = view.seats.filter((s) => s.joined).length;
		required<HTMLElement>('#lobby-title').textContent = `Waiting for players (${joined} of ${view.seats.length})`;
		required<HTMLElement>('#lobby-seats').replaceChildren(
			...view.seats.map((s, i) => {
				const item = el('li', `lobby-seat seat-color--${i + 1}${s.joined ? ' lobby-seat--joined' : ''}`);
				item.append(el('span', `seat seat--${i + 1}`, String(i + 1)), el('span', 'lobby-seat__name', s.name ?? 'Open seat'));
				return item;
			}),
		);
		const controls = required<HTMLElement>('#lobby-controls');
		if (view.host && hostToken) {
			const lowest = Math.max(MIN_PLAYERS, ...view.seats.map((s, i) => (s.joined ? i + 1 : 0)));
			const act = async (body: Record<string, unknown>, context: string) => {
				try {
					await call('POST', API, hostToken, { code: view.code, ...body });
					await refresh();
				} catch (error) {
					handle(error, context, async () => act(body, context));
				}
			};
			const less = el('button', 'button action action--end stepper__button', '−');
			less.type = 'button';
			less.setAttribute('aria-label', 'Remove an empty seat');
			less.disabled = view.seats.length <= lowest;
			less.addEventListener('click', () => void act({ action: 'resize', seats: view.seats.length - 1 }, 'rooms:resize'));
			const more = el('button', 'button action action--build stepper__button', '+');
			more.type = 'button';
			more.setAttribute('aria-label', 'Add a seat');
			more.disabled = view.seats.length >= MAX_PLAYERS;
			more.addEventListener('click', () => void act({ action: 'resize', seats: view.seats.length + 1 }, 'rooms:resize'));
			const stepper = el('div', 'stepper');
			stepper.setAttribute('role', 'group');
			stepper.setAttribute('aria-label', 'Seats');
			stepper.append(el('span', 'stepper__label', 'Seats'), less, el('output', 'stepper__value numeric', String(view.seats.length)), more);
			const start = el('button', `button action action--roll${joined >= MIN_PLAYERS ? ' action--next' : ''}`);
			start.type = 'button';
			start.append(iconElement('dice'), document.createTextNode('Start game'));
			start.disabled = joined < MIN_PLAYERS;
			start.addEventListener('click', () => void act({ action: 'start' }, 'rooms:start'));
			const hint = el('p', 'hint', joined < MIN_PLAYERS ? `At least ${MIN_PLAYERS} players need to join.` : 'Empty seats are dropped when you start.');
			controls.replaceChildren(stepper, start, hint);
		} else {
			controls.replaceChildren(
				el('p', 'lobby-wait', seat ? `You're in as ${seat.player}. The host will start the game.` : 'Waiting for the host to start.'),
			);
		}
	}

	// ------------------------------------------------------------ following a room (lobby, then game)

	async function follow(roomCode: string, seat: Seat | null, hostToken: string | null) {
		let latest: PushView | null = null;
		let gameShown = false;
		const token = seat?.token ?? hostToken;
		const viewer: Viewer = seat ? { kind: 'seat', player: seat.player } : { kind: 'board' };
		const fetchView = (since: number | null) =>
			call<FeedAnswer<PushView>>('GET', `${API}?code=${roomCode}${since === null ? '' : `&since=${since}`}`, token);

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

		const screen: PlayScreen = mountPlay(source, feedback, () => only(playSection), viewer);
		const show = (view: PushView) => {
			latest = view;
			drawBar(view, seat);
			feedback.clearFailure();
			if (!view.started) return drawLobby(view, seat, hostToken, () => feed.refresh());
			if (!gameShown) {
				gameShown = true;
				feedback.announce('The game has started.');
				return void screen.render();
			}
			return void screen.update(toSnapshot(view));
		};

		const feed = createRoomFeed<PushView>({
			fetch: fetchView,
			onView: show,
			onError: (error) => {
				if (error instanceof ApiError && error.code === 'BAD_TOKEN') {
					// The seat was lost (a new room with this code, or storage was cleared).
					save(seatKey(roomCode), null);
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

		await feed.start();
		const push = (latest as PushView | null)?.push;
		if (push) connectPush(push);
	}

	// ------------------------------------------------------------ phone: name yourself

	async function showJoin(roomCode: string) {
		const view = await call<RoomView>('GET', `${API}?code=${roomCode}`, null);
		drawBar(view, null);
		if (view.started) {
			only(null);
			feedback.inform('This game has already started', 'Only the players who joined before the start can play. Ask the host for a new room.');
			return;
		}
		only(join);
		const form = required<HTMLFormElement>('#join-form');
		const input = required<HTMLInputElement>('#name-input');
		input.maxLength = MAX_NAME_LENGTH;
		input.focus();
		form.onsubmit = async (event) => {
			event.preventDefault();
			const name = parsePlayerName(input.value);
			if (!name) {
				feedback.inform('Enter your name', `A name of 1 to ${MAX_NAME_LENGTH} characters.`);
				input.focus();
				return;
			}
			const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
			if (submit) submit.disabled = true;
			try {
				const seat = await call<Seat>('POST', API, null, { action: 'join', code: roomCode, name });
				save(seatKey(roomCode), seat);
				feedback.clearFailure();
				feedback.announce(`You joined as ${seat.player}.`);
				await follow(roomCode, seat, null);
			} catch (error) {
				handle(error, 'rooms:join', async () => form.requestSubmit());
			} finally {
				if (submit) submit.disabled = false;
			}
		};
	}

	// ------------------------------------------------------------ start

	const begin = async () => {
		if (!code) return showStart();
		if (isBoard) return follow(code, null, load(hostKey(code), isText));
		const seat = load(seatKey(code), isSeat);
		return seat ? follow(code, seat, null) : showJoin(code);
	};
	begin().catch((error) => handle(error, 'rooms:start', begin));
}
