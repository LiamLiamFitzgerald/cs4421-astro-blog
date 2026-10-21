/**
 * Browser controller for /catan. It runs the setup screen, the "Just keep
 * score" mode, and hands played games to the play controller (src/ui/play.ts).
 * It holds no game rules (ADR-006): every rule lives in decide/evolve and
 * every message in src/lib/app.
 */
import { LocalStorageEventStore } from '../lib/adapters/local-storage-event-store';
import { MemoryEventStore } from '../lib/adapters/memory-event-store';
import type { EventStore } from '../lib/app/event-store';
import { executeCommand, loadGame } from '../lib/app/catan-service';
import {
	buildScoreboard,
	describeEvent,
	describeViolation,
	parsePlayerNames,
	parseSeed,
	type ScoreRow,
} from '../lib/app/scoreboard';
import { generateBoard, isValidSeed, MAX_SEED } from '../lib/games/catan/board';
import type { CatanCommand } from '../lib/games/catan/commands';
import { MAX_PLAYERS, MAX_ROAD_LENGTH, MIN_PLAYERS } from '../lib/games/catan/decide';
import type { CatanEvent } from '../lib/games/catan/events';
import type { CatanState } from '../lib/games/catan/state';
import type { PlayEvent } from '../lib/games/catan-play/events';
import { WINNING_POINTS } from '../lib/games/catan/score';
import { renderBoard } from './board';
import { createFeedback, el, type FailureReporter } from './feedback';
import { iconElement, type IconName } from './icons';
import { createPlayView } from './play';

const GAME_ID = 'local';

// ---------------------------------------------------------------- elements

const $ = <T extends Element>(selector: string) => {
	const node = document.querySelector<T>(selector);
	if (!node) throw new Error(`Scoreboard markup is missing ${selector}`);
	return node;
};


// ---------------------------------------------------------------- storage

type ClearableStore<E> = EventStore<E> & { clear?(id: string): void };

/** Browser storage if it works, otherwise memory (and the page says so). Each mode has its own log. */
function openStores(): { score: ClearableStore<CatanEvent>; play: ClearableStore<PlayEvent>; persistent: boolean } {
	try {
		const probe = 'catan:probe';
		window.localStorage.setItem(probe, probe);
		window.localStorage.removeItem(probe);
		return {
			score: new LocalStorageEventStore<CatanEvent>(window.localStorage),
			play: new LocalStorageEventStore<PlayEvent>(window.localStorage, 'catan-play:events:'),
			persistent: true,
		};
	} catch {
		return { score: new MemoryEventStore<CatanEvent>(), play: new MemoryEventStore<PlayEvent>(), persistent: false };
	}
}

// ---------------------------------------------------------------- controller

export function startScoreboard(report: FailureReporter): void {
	const opened = openStores();
	let store = opened.score;
	let playStore = opened.play;
	const persistent = opened.persistent;
	let seed = parseSeed(new URLSearchParams(location.search).get('seed'));
	if (seed === null || !isValidSeed(seed)) seed = randomSeed();

	const loading = $<HTMLElement>('#loading');
	const setup = $<HTMLElement>('#setup');
	const game = $<HTMLElement>('#game');
	const failure = $<HTMLElement>('#failure');
	const announcer = $<HTMLElement>('#announcer');
	const storageNote = $<HTMLElement>('#storage-note');
	const nameList = $<HTMLOListElement>('#player-fields');
	const addPlayer = $<HTMLButtonElement>('#add-player');
	const setupError = $<HTMLElement>('#setup-error');
	const setupForm = $<HTMLFormElement>('#setup-form');
	const setupBoard = $<SVGSVGElement>('#setup-board');
	const setupBoardList = $<HTMLOListElement>('#setup-board-list');
	const dealButton = $<HTMLButtonElement>('#deal');
	const gameBoard = $<SVGSVGElement>('#game-board');
	const gameBoardList = $<HTMLOListElement>('#game-board-list');
	const noBoard = $<HTMLElement>('#no-board');
	const players = $<HTMLElement>('#players');
	const winner = $<HTMLElement>('#winner');
	const events = $<HTMLOListElement>('#events');
	const eventCount = $<HTMLElement>('#event-count');
	const newGame = $<HTMLButtonElement>('#new-game');
	const dialog = $<HTMLDialogElement>('#confirm-new-game');
	const dialogPlayers = $<HTMLElement>('#confirm-players');
	const playSection = $<HTMLElement>('#play');

	storageNote.hidden = persistent;
	const feedback = createFeedback(announcer, failure, report);
	const announce = (text: string) => feedback.announce(text);

	const showPlay = () => {
		loading.hidden = true;
		setup.hidden = true;
		game.hidden = true;
		playSection.hidden = false;
		newGame.hidden = false;
	};
	let play = createPlayView(playStore, feedback, showPlay);

	const showFailure = (error: unknown, context: string, retry: () => Promise<void>) =>
		feedback.fail(error, context, retry);

	// ---------------------------------------------------- commands

	let busy = false;

	/**
	 * Runs one command. Rule violations are shown next to the player; anything
	 * else is shown as a failure with a retry. Controls are always re-enabled.
	 */
	async function run(command: CatanCommand, source?: HTMLButtonElement, note?: HTMLElement) {
		if (busy) return;
		busy = true;
		source?.setAttribute('aria-busy', 'true');
		if (source) source.disabled = true;
		try {
			const before = (await store.load(GAME_ID)).length;
			const result = await executeCommand(store, GAME_ID, command);
			if (!result.ok) {
				const message = describeViolation(result.error);
				if (note) {
					note.textContent = message;
					note.hidden = false;
				} else {
					setupError.textContent = message;
					setupError.hidden = false;
				}
				announce(message);
				return;
			}
			feedback.clearFailure();
			const log = await store.load(GAME_ID);
			const added = log.slice(before);
			const latest = added.at(-1);
			await render(command.type === 'StartGame' ? undefined : (command as { player?: string }).player);
			if (latest) announce(`${describeEvent(latest)}.${pointsSuffix(result.value, latest)}`);
		} catch (error) {
			showFailure(error, `command:${command.type}`, () => run(command, source, note));
			await render().catch(() => undefined);
		} finally {
			busy = false;
			source?.removeAttribute('aria-busy');
			// Panels are rebuilt by render(), which also disables them once someone has won.
			if (source) source.disabled = false;
		}
	}

	function pointsSuffix(state: CatanState, event: CatanEvent): string {
		if (!('player' in event)) return '';
		const row = buildScoreboard(state).find((r) => r.player === event.player);
		if (!row) return '';
		return row.isWinner ? ` ${row.player} wins with ${row.points} points.` : ` ${row.player} has ${row.points} points.`;
	}

	// ---------------------------------------------------- setup screen

	function nameField(value = '') {
		const index = nameList.children.length + 1;
		const item = el('li', 'player-field');
		const badge = el('span', `seat seat--${index}`, String(index));
		badge.setAttribute('aria-hidden', 'true');
		const input = el('input', 'input');
		input.name = 'player';
		input.value = value;
		input.autocomplete = 'off';
		input.maxLength = 24;
		input.setAttribute('aria-label', `Player ${index} name`);
		input.addEventListener('input', () => {
			setupError.hidden = true;
			for (const field of nameList.querySelectorAll('input')) {
				field.removeAttribute('aria-invalid');
				field.removeAttribute('aria-describedby');
			}
		});
		const remove = el('button', 'button button--quiet button--small');
		remove.type = 'button';
		remove.append(iconElement('close', `Remove player ${index}`));
		remove.addEventListener('click', () => {
			item.remove();
			renumberFields();
		});
		item.append(badge, input, remove);
		nameList.append(item);
		renumberFields();
		return input;
	}

	function renumberFields() {
		[...nameList.children].forEach((item, i) => {
			const n = String(i + 1);
			const badge = item.querySelector('.seat');
			if (badge) {
				badge.textContent = n;
				badge.className = `seat seat--${i + 1}`;
			}
			item.querySelector('input')?.setAttribute('aria-label', `Player ${n} name`);
			const remove = item.querySelector<HTMLButtonElement>('button');
			if (remove) {
				remove.hidden = nameList.children.length <= MIN_PLAYERS;
				remove.querySelector('svg')?.setAttribute('aria-label', `Remove player ${n}`);
			}
		});
		addPlayer.hidden = nameList.children.length >= MAX_PLAYERS;
	}

	function showSetupBoard() {
		renderBoard(setupBoard, generateBoard(seed ?? 0), setupBoardList);
		const url = new URL(location.href);
		url.searchParams.set('seed', String(seed));
		history.replaceState(null, '', url);
	}

	for (const name of ['', '', '']) nameField(name);
	addPlayer.addEventListener('click', () => nameField().focus());
	dealButton.addEventListener('click', () => {
		seed = randomSeed();
		showSetupBoard();
		announce('A new board has been dealt.');
	});

	setupForm.addEventListener('submit', (event) => {
		event.preventDefault();
		setupError.hidden = true;
		const inputs = [...nameList.querySelectorAll<HTMLInputElement>('input')];
		const names = parsePlayerNames(inputs.map((input) => input.value));
		const submit = setupForm.querySelector<HTMLButtonElement>('button[type="submit"]') ?? undefined;
		const mode = new FormData(setupForm).get('mode') === 'score' ? 'score' : 'play';
		const started =
			mode === 'play'
				? play.start(names, seed ?? 0).then((message) => {
						if (message) {
							setupError.textContent = message;
							setupError.hidden = false;
						}
					})
				: run({ type: 'StartGame', players: names, seed: seed ?? undefined }, submit);
		void started.then(() => {
			if (setupError.hidden) return;
			// Point at the field to fix: a repeated name, else the first empty field.
			const seen = new Set<string>();
			const repeated = inputs.find((input) => {
				const name = input.value.trim();
				if (name === '') return false;
				if (seen.has(name)) return true;
				seen.add(name);
				return false;
			});
			const target = repeated ?? inputs.find((input) => input.value.trim() === '') ?? inputs[0];
			target?.setAttribute('aria-invalid', 'true');
			target?.setAttribute('aria-describedby', 'setup-error');
			target?.focus();
		});
	});

	// ---------------------------------------------------- game screen

	function actionButton(
		icon: IconName | null,
		label: string,
		hint: string,
		command: CatanCommand,
		feedback: HTMLElement,
		disabled: boolean,
	) {
		const button = el('button', 'button button--small action');
		button.type = 'button';
		button.dataset.action = command.type;
		button.title = hint;
		button.disabled = disabled;
		if (icon) button.append(iconElement(icon));
		button.append(document.createTextNode(label));
		button.addEventListener('click', () => {
			feedback.hidden = true;
			void run(command, button, feedback);
		});
		return button;
	}

	function stat(icon: IconName, label: string, value: number) {
		const item = el('div', 'stat');
		const dd = el('dd', 'stat__value numeric');
		dd.append(iconElement(icon), document.createTextNode(String(value)));
		item.append(dd, el('dt', 'stat__label', label));
		return item;
	}

	function playerPanel(row: ScoreRow, seat: number, over: boolean, changed: boolean) {
		const panel = el('article', `player seat-color--${seat}`);
		panel.classList.toggle('player--winner', row.isWinner);
		panel.classList.toggle('player--changed', changed);
		panel.setAttribute('aria-labelledby', `player-${seat}-name`);

		const head = el('header', 'player__head');
		const badge = el('span', `seat seat--${seat}`, String(seat));
		badge.setAttribute('aria-hidden', 'true');
		const name = el('h3', 'player__name', row.player);
		name.id = `player-${seat}-name`;
		const score = el('p', 'player__score');
		score.append(el('strong', 'numeric', String(row.points)), el('span', undefined, ` of ${WINNING_POINTS} points`));
		head.append(badge, name, score);

		const meter = el('div', 'meter');
		meter.setAttribute('role', 'meter');
		meter.setAttribute('aria-valuemin', '0');
		meter.setAttribute('aria-valuemax', String(WINNING_POINTS));
		meter.setAttribute('aria-valuenow', String(Math.min(row.points, WINNING_POINTS)));
		meter.setAttribute('aria-label', `${row.player}'s progress to ${WINNING_POINTS} points`);
		for (let i = 0; i < WINNING_POINTS; i++) meter.append(el('span', i < row.points ? 'meter__step meter__step--on' : 'meter__step'));

		const awards = el('ul', 'awards');
		const award = (icon: IconName, text: string, kind: string) => {
			const item = el('li', `award award--${kind}`);
			item.append(iconElement(icon), document.createTextNode(text));
			awards.append(item);
		};
		if (row.isWinner) award('crown', 'Winner', 'winner');
		if (row.hasLargestArmy) award('army', 'Largest Army', 'army');
		if (row.hasLongestRoad) award('trophy', 'Longest Road', 'road');

		const stats = el('dl', 'stats');
		stats.append(
			stat('settlement', 'Settlements', row.settlements),
			stat('city', 'Cities', row.cities),
			stat('card', 'VP cards', row.victoryPointCards),
			stat('knight', 'Knights', row.knights),
		);

		const feedback = el('p', 'player__feedback');
		feedback.hidden = true;
		feedback.setAttribute('role', 'alert');

		const player = row.player;
		const actions = el('div', 'actions');
		actions.setAttribute('role', 'group');
		actions.setAttribute('aria-label', `Record for ${player}`);
		actions.append(
			actionButton('settlement', 'Settlement', 'Built a settlement (1 point)', { type: 'BuildSettlement', player }, feedback, over),
			actionButton('city', 'City', 'Upgraded a settlement to a city (+1 point)', { type: 'UpgradeSettlement', player }, feedback, over),
			actionButton('card', 'VP card', 'Revealed a victory point card (1 point)', { type: 'RevealVictoryPointCard', player }, feedback, over),
			actionButton('knight', 'Knight', 'Played a knight (3 or more can win Largest Army)', { type: 'PlayKnight', player }, feedback, over),
		);

		const road = el('div', 'road');
		road.setAttribute('role', 'group');
		road.setAttribute('aria-label', `${player}'s longest road`);
		const roadLabel = el('span', 'road__label');
		roadLabel.append(iconElement('road'), document.createTextNode('Longest road'));
		const minus = actionButton(null, '−', 'One shorter', { type: 'RecordRoadLength', player, length: row.roadLength - 1 }, feedback, over || row.roadLength === 0);
		minus.setAttribute('aria-label', `${player}: road one shorter`);
		const value = el('output', 'road__value', String(row.roadLength));
		value.setAttribute('aria-label', `${player}'s longest road`);
		const plus = actionButton(null, '+', 'One longer', { type: 'RecordRoadLength', player, length: row.roadLength + 1 }, feedback, over || row.roadLength >= MAX_ROAD_LENGTH);
		plus.setAttribute('aria-label', `${player}: road one longer`);
		road.append(roadLabel, minus, value, plus);

		panel.append(head, meter, awards, stats, actions, road, feedback);
		return panel;
	}

	/** Draws whichever screen the stored log implies. `changedPlayer` is highlighted briefly. */
	async function render(changedPlayer?: string) {
		if (await play.isActive()) {
			await play.render();
			return;
		}
		playSection.hidden = true;
		const state = await loadGame(store, GAME_ID);
		const log = await store.load(GAME_ID);
		loading.hidden = true;
		setup.hidden = state.started;
		game.hidden = !state.started;
		newGame.hidden = !state.started;
		if (!state.started) {
			showSetupBoard();
			return;
		}

		if (state.board) {
			renderBoard(gameBoard, state.board, gameBoardList);
			gameBoard.removeAttribute("hidden");
			noBoard.hidden = true;
		} else {
			gameBoard.setAttribute("hidden", "");
			noBoard.hidden = false;
		}

		const over = state.winner !== null;
		const rows = buildScoreboard(state);
		players.replaceChildren(...rows.map((row, i) => playerPanel(row, i + 1, over, row.player === changedPlayer)));

		winner.hidden = !over;
		if (over) {
			const body = winner.querySelector('.notice__body');
			const top = rows.find((row) => row.isWinner);
			if (body && top) {
				body.replaceChildren(
					el('p', 'notice__title', `${top.player} wins with ${top.points} points.`),
					el('p', undefined, 'The game is over, so recording is switched off. Start a new game to play again.'),
				);
			}
		}

		events.replaceChildren(...[...log].reverse().map((event) => el('li', undefined, describeEvent(event))));
		eventCount.textContent = String(log.length);
	}

	// ---------------------------------------------------- new game

	newGame.addEventListener('click', async () => {
		const playing = await play.isActive().catch(() => false);
		const names = playing
			? await play.players()
			: ((await loadGame(store, GAME_ID).catch(() => null))?.playerOrder ?? []);
		dialogPlayers.textContent = names.join(', ') || 'this game';
		dialog.showModal();
	});

	dialog.addEventListener('close', () => {
		if (dialog.returnValue !== 'discard') return;
		try {
			store.clear?.(GAME_ID);
			play.clear();
			if (!persistent) {
				store = new MemoryEventStore<CatanEvent>();
				playStore = new MemoryEventStore<PlayEvent>();
				play = createPlayView(playStore, feedback, showPlay);
			}
			seed = randomSeed();
			feedback.clearFailure();
			void render().then(() => {
				nameList.querySelector('input')?.focus();
				announce('The game was discarded. Enter players to start a new one.');
			});
		} catch (error) {
			showFailure(error, 'new-game', async () => {
				dialog.returnValue = 'discard';
				dialog.dispatchEvent(new Event('close'));
			});
		}
	});

	// ---------------------------------------------------- start

	async function boot() {
		try {
			await render();
		} catch (error) {
			loading.hidden = true;
			showFailure(error, 'load', boot);
		}
	}
	void boot();

	// Re-render if another tab changes the saved game.
	window.addEventListener('storage', (event) => {
		if (event.key?.startsWith('catan:events:') || event.key?.startsWith('catan-play:events:')) void boot();
	});
}

function randomSeed(): number {
	return crypto.getRandomValues(new Uint32Array(1))[0] ?? Math.floor(Math.random() * MAX_SEED);
}
