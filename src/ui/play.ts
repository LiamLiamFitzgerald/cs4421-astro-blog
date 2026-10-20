/**
 * Browser controller for play mode on /catan. Like the scoreboard it holds no
 * rules: legal spots, costs and what is missing come from the catan-play
 * queries, and every message comes from src/lib/app/play-view.ts (ADR-008).
 */
import type { EventStore } from '../lib/app/event-store';
import { executePlayCommand, loadPlay } from '../lib/app/play-service';
import {
	describeCorner,
	describeEdge,
	describeHand,
	describePlayEvent,
	describePlayViolation,
	describeRoll,
	describeStep,
	PIECE_NAMES,
	tradeableResources,
} from '../lib/app/play-view';
import type { PlayCommand } from '../lib/games/catan-play/commands';
import type { PlayEvent } from '../lib/games/catan-play/events';
import { replayPlay } from '../lib/games/catan-play/evolve';
import {
	buildOptions,
	currentPlayer,
	expectedStep,
	legalSetupRoads,
	legalSetupSettlements,
	longestRoadLength,
	piecesLeft,
	points,
} from '../lib/games/catan-play/queries';
import { emptyHand, handSize, type Piece, RESOURCES, type Resource } from '../lib/games/catan-play/resources';
import type { PlayState } from '../lib/games/catan-play/state';
import { WINNING_POINTS } from '../lib/games/catan/score';
import { type BoardOverlay, renderBoard } from './board';
import { el, type Feedback, required } from './feedback';
import { iconElement, type IconName } from './icons';

const GAME_ID = 'local';

export interface PlayView {
	/** True when a played game is stored. */
	isActive(): Promise<boolean>;
	/** Draws the stored game. */
	render(): Promise<void>;
	/** Starts a game; returns the reason when the rules refuse it. */
	start(players: readonly string[], seed: number): Promise<string | null>;
	players(): Promise<readonly string[]>;
	/** Deletes the stored game. */
	clear(): void;
}

const RESOURCE_ICONS: Readonly<Record<Resource, IconName>> = {
	lumber: 'lumber',
	brick: 'brick',
	wool: 'wool',
	grain: 'grain',
	ore: 'ore',
};
const PIECE_ICONS: Readonly<Record<Piece, IconName>> = { road: 'road', settlement: 'settlement', city: 'city' };

/** One fair die from the browser's secure random source (no modulo bias). */
function rollDie(): number {
	const buffer = new Uint8Array(1);
	for (;;) {
		crypto.getRandomValues(buffer);
		const value = buffer[0] ?? 255;
		if (value < 252) return (value % 6) + 1;
	}
}

export function createPlayView(
	store: EventStore<PlayEvent> & { clear?(id: string): void },
	feedback: Feedback,
	show: (screen: 'play') => void,
): PlayView {
	const section = required<HTMLElement>('#play');
	const board = required<SVGSVGElement>('#play-board');
	const boardList = required<HTMLOListElement>('#play-board-list');
	const boardHint = required<HTMLElement>('#play-board-hint');
	const turn = required<HTMLElement>('#play-turn');
	const roster = required<HTMLElement>('#play-players');
	const winner = required<HTMLElement>('#play-winner');
	const events = required<HTMLOListElement>('#play-events');
	const eventCount = required<HTMLElement>('#play-event-count');

	let mode: Piece | null = null;
	let busy = false;
	let lastMessage = '';
	let rolledJustNow = false;

	const seatOf = (state: PlayState, player: string) => state.players.indexOf(player) + 1;

	/** Runs a command; violations show beside the turn controls, failures get Try again. */
	async function run(command: PlayCommand): Promise<string | null> {
		if (busy) return null;
		busy = true;
		section.setAttribute('aria-busy', 'true');
		try {
			const result = await executePlayCommand(store, GAME_ID, command);
			if (!result.ok) {
				const message = describePlayViolation(result.error);
				lastMessage = message;
				feedback.announce(message);
				await render();
				return message;
			}
			feedback.clearFailure();
			lastMessage = '';
			mode = null;
			rolledJustNow = command.type === 'RollDice';
			const { state, events: added } = result.value;
			await render();
			feedback.announce(announcement(state, added));
			return null;
		} catch (error) {
			feedback.fail(error, `play:${command.type}`, async () => {
				await run(command);
			});
			await render().catch(() => undefined);
			return null;
		} finally {
			busy = false;
			section.removeAttribute('aria-busy');
		}
	}

	function announcement(state: PlayState, added: readonly PlayEvent[]): string {
		const parts = added.map((event) =>
			event.type === 'DiceRolled' && state.lastRoll
				? describeRoll(state.lastRoll, state.players)
				: `${describePlayEvent(event, state)}.`,
		);
		const next = currentPlayer(state);
		const step = expectedStep(state);
		if (state.winner) parts.push(`${state.winner} wins with ${points(state, state.winner)} points.`);
		else if (next && step && added.some((e) => e.type === 'TurnEnded' || e.type === 'SetupRoadPlaced')) {
			parts.push(`${next}'s turn. ${describeStep(step)}`);
		}
		return parts.join(' ');
	}

	// ------------------------------------------------------------ board

	function overlay(state: PlayState): BoardOverlay {
		const player = currentPlayer(state) ?? '';
		const step = expectedStep(state);
		const buildings = Object.entries(state.buildings).map(([vertex, b]) => ({
			vertex: Number(vertex),
			seat: seatOf(state, b.player),
			kind: b.kind,
			label: `${b.player}'s ${b.kind} at ${describeCorner(state.board, Number(vertex))}`,
		}));
		const roads = Object.entries(state.roads).map(([edge, owner]) => ({
			edge: Number(edge),
			seat: seatOf(state, owner),
			label: `${owner}'s road ${describeEdge(state.board, Number(edge))}`,
		}));

		let targets: BoardOverlay['targets'];
		const vertexTargets = (ids: number[], verb: string, make: (v: number) => PlayCommand) => ({
			kind: 'vertex' as const,
			ids,
			label: (v: number) => `${verb} at ${describeCorner(state.board, v)}`,
			onPick: (v: number) => void run(make(v)),
		});
		const edgeTargets = (ids: number[], make: (e: number) => PlayCommand) => ({
			kind: 'edge' as const,
			ids,
			label: (e: number) => `Build a road ${describeEdge(state.board, e)}`,
			onPick: (e: number) => void run(make(e)),
		});
		if (step === 'place-settlement') {
			targets = vertexTargets(legalSetupSettlements(state), 'Place a settlement', (vertex) => ({ type: 'PlaceSetupSettlement', player, vertex }));
		} else if (step === 'place-road') {
			targets = edgeTargets(legalSetupRoads(state), (edge) => ({ type: 'PlaceSetupRoad', player, edge }));
		} else if (step === 'build-or-end' && mode) {
			const option = buildOptions(state, player).find((o) => o.piece === mode);
			const spots = option?.allowed ? [...option.spots] : [];
			if (mode === 'road') targets = edgeTargets(spots, (edge) => ({ type: 'BuildRoad', player, edge }));
			if (mode === 'settlement') targets = vertexTargets(spots, 'Build a settlement', (vertex) => ({ type: 'BuildSettlement', player, vertex }));
			if (mode === 'city') targets = vertexTargets(spots, 'Upgrade to a city', (vertex) => ({ type: 'BuildCity', player, vertex }));
		}
		return { buildings, roads, targets };
	}

	function boardInstruction(state: PlayState): string {
		const step = expectedStep(state);
		if (step === 'place-settlement') return 'Choose a highlighted corner for the settlement.';
		if (step === 'place-road') return 'Choose a highlighted edge for the road.';
		if (step === 'build-or-end' && mode) return `Choose where to build the ${PIECE_NAMES[mode]}. Select Build ${PIECE_NAMES[mode]} again (or press Escape) to cancel.`;
		return '';
	}

	// ------------------------------------------------------------ turn panel

	function die(value: number): SVGSVGElement {
		const pips: Record<number, [number, number][]> = {
			1: [[2, 2]],
			2: [[1, 1], [3, 3]],
			3: [[1, 1], [2, 2], [3, 3]],
			4: [[1, 1], [3, 1], [1, 3], [3, 3]],
			5: [[1, 1], [3, 1], [2, 2], [1, 3], [3, 3]],
			6: [[1, 1], [3, 1], [1, 2], [3, 2], [1, 3], [3, 3]],
		};
		const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		svg.setAttribute('viewBox', '0 0 40 40');
		svg.setAttribute('class', 'die');
		svg.setAttribute('aria-hidden', 'true');
		const face = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
		for (const [k, v] of Object.entries({ x: 2, y: 2, width: 36, height: 36, rx: 7, class: 'die__face' })) face.setAttribute(k, String(v));
		svg.append(face);
		for (const [cx, cy] of pips[value] ?? []) {
			const pip = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
			for (const [k, v] of Object.entries({ cx: cx * 10, cy: cy * 10, r: 3.6, class: 'die__pip' })) pip.setAttribute(k, String(v));
			svg.append(pip);
		}
		return svg;
	}

	function button(label: string, icon: IconName | null, className = 'button'): HTMLButtonElement {
		const b = el('button', className);
		b.type = 'button';
		if (icon) b.append(iconElement(icon));
		b.append(document.createTextNode(label));
		return b;
	}

	function costList(cost: Record<Resource, number>): HTMLElement {
		const list = el('span', 'cost');
		for (const r of RESOURCES) {
			for (let i = 0; i < cost[r]; i++) list.append(iconElement(RESOURCE_ICONS[r], r));
		}
		return list;
	}

	function turnPanel(state: PlayState): HTMLElement[] {
		const player = currentPlayer(state) ?? '';
		const step = expectedStep(state);
		const seat = seatOf(state, player);
		const parts: HTMLElement[] = [];

		const head = el('header', 'turn__head');
		const badge = el('span', `seat seat--${seat}`, String(seat));
		badge.setAttribute('aria-hidden', 'true');
		const title = el('h2', 'turn__title', state.winner ? 'Game over' : `${player}'s turn`);
		title.id = 'turn-title';
		head.append(badge, title);
		if (state.phase === 'setup') head.append(el('span', 'turn__phase', 'Setup'));
		parts.push(head);

		if (step) parts.push(el('p', 'turn__step', describeStep(step)));

		if (state.lastRoll && state.phase !== 'setup') {
			const roll = el('div', `roll${rolledJustNow ? ' roll--new' : ''}`);
			const dice = el('div', 'roll__dice');
			dice.append(die(state.lastRoll.dice[0]), die(state.lastRoll.dice[1]));
			roll.append(dice, el('p', 'roll__text', describeRoll(state.lastRoll, state.players)));
			parts.push(roll);
		}

		if (lastMessage) {
			const message = el('p', 'player__feedback', lastMessage);
			message.setAttribute('role', 'alert');
			parts.push(message);
		}

		const actions = el('div', 'turn__actions');
		if (step === 'roll') {
			const roll = button('Roll the dice', 'dice', 'button button--primary');
			roll.addEventListener('click', () => void run({ type: 'RollDice', player, dice: [rollDie(), rollDie()] }));
			actions.append(roll);
		}
		if (step === 'build-or-end') {
			const builds = el('div', 'builds');
			builds.setAttribute('role', 'group');
			builds.setAttribute('aria-label', 'Build');
			for (const option of buildOptions(state, player)) {
				const b = el('button', 'button build');
				b.type = 'button';
				b.setAttribute('aria-pressed', String(mode === option.piece));
				const label = el('span', 'build__label');
				label.append(iconElement(PIECE_ICONS[option.piece]), document.createTextNode(`Build ${PIECE_NAMES[option.piece]}`));
				b.append(label, costList(option.cost));
				const reason =
					option.piecesLeft === 0
						? `No ${PIECE_NAMES[option.piece]} pieces left`
						: handSize(option.missing) > 0
							? `Needs ${describeHand(option.missing)}`
							: option.spots.length === 0
								? 'Nowhere to build one yet'
								: `${option.piecesLeft} left`;
				const note = el('span', 'build__note', reason);
				note.id = `build-note-${option.piece}`;
				b.setAttribute('aria-describedby', note.id);
				b.append(note);
				b.disabled = !option.allowed;
				b.addEventListener('click', () => {
					mode = mode === option.piece ? null : option.piece;
					lastMessage = '';
					void render().then(() => {
						if (mode) board.querySelector<SVGElement>('[data-spot]')?.focus();
					});
				});
				builds.append(b);
			}
			actions.append(builds, tradeForm(state, player));
			const end = button('End turn', null, 'button button--primary turn__end');
			end.addEventListener('click', () => void run({ type: 'EndTurn', player }));
			actions.append(end);
		}
		parts.push(actions);
		return parts;
	}

	function tradeForm(state: PlayState, player: string): HTMLElement {
		const form = el('form', 'trade');
		form.setAttribute('aria-label', 'Trade with the bank');
		const offer = tradeableResources(state.hands[player] ?? emptyHand);
		const legend = el('p', 'trade__title', 'Trade 4 for 1 with the bank');
		const give = el('select', 'input trade__select');
		give.setAttribute('aria-label', 'Give 4');
		const get = el('select', 'input trade__select');
		get.setAttribute('aria-label', 'Get 1');
		for (const r of offer) give.append(new Option(`4 ${r}`, r));
		for (const r of RESOURCES) get.append(new Option(`1 ${r}`, r));
		const firstOther = RESOURCES.find((r) => r !== offer[0]);
		if (firstOther) get.value = firstOther;
		const submit = button('Trade', null, 'button button--small');
		submit.type = 'submit';
		form.append(legend);
		if (offer.length === 0) {
			form.append(el('p', 'hint', 'You need 4 of one resource to trade.'));
			return form;
		}
		const row = el('div', 'trade__row');
		row.append(give, el('span', 'trade__for', 'for'), get, submit);
		form.append(row);
		form.addEventListener('submit', (event) => {
			event.preventDefault();
			void run({ type: 'TradeWithBank', player, give: give.value as Resource, get: get.value as Resource });
		});
		return form;
	}

	// ------------------------------------------------------------ players

	function playerRow(state: PlayState, player: string): HTMLElement {
		const seat = seatOf(state, player);
		const isCurrent = currentPlayer(state) === player && !state.winner;
		const row = el('article', `panel play-player seat-color--${seat}`);
		row.classList.toggle('play-player--current', isCurrent);
		row.classList.toggle('player--winner', state.winner === player);
		row.setAttribute('aria-label', `${player}${isCurrent ? ', playing now' : ''}`);

		const head = el('header', 'player__head');
		const badge = el('span', `seat seat--${seat}`, String(seat));
		badge.setAttribute('aria-hidden', 'true');
		const score = el('p', 'player__score');
		const vp = points(state, player);
		score.append(el('strong', undefined, String(vp)), el('span', undefined, ` of ${WINNING_POINTS} points`));
		head.append(badge, el('h3', 'player__name', player), score);

		const meter = el('div', 'meter');
		meter.setAttribute('role', 'meter');
		meter.setAttribute('aria-valuemin', '0');
		meter.setAttribute('aria-valuemax', String(WINNING_POINTS));
		meter.setAttribute('aria-valuenow', String(Math.min(vp, WINNING_POINTS)));
		meter.setAttribute('aria-label', `${player}'s progress to ${WINNING_POINTS} points`);
		for (let i = 0; i < WINNING_POINTS; i++) meter.append(el('span', i < vp ? 'meter__step meter__step--on' : 'meter__step'));

		const hand = state.hands[player] ?? emptyHand;
		const cards = el('dl', 'hand');
		cards.setAttribute('aria-label', `${player}'s resources`);
		for (const r of RESOURCES) {
			const item = el('div', `hand__item${hand[r] === 0 ? ' hand__item--none' : ''}`);
			const value = el('dd', 'hand__count');
			value.append(iconElement(RESOURCE_ICONS[r]), document.createTextNode(String(hand[r])));
			item.append(value, el('dt', 'hand__name', r));
			cards.append(item);
		}

		const left = piecesLeft(state, player);
		const supply = el('p', 'supply');
		supply.append(document.createTextNode('Left: '));
		for (const piece of ['road', 'settlement', 'city'] as const) {
			const item = el('span', 'supply__item');
			const name = left[piece] === 1 ? PIECE_NAMES[piece] : piece === 'city' ? 'cities' : `${PIECE_NAMES[piece]}s`;
			item.append(iconElement(PIECE_ICONS[piece]), document.createTextNode(`${left[piece]} ${name}`));
			supply.append(item);
		}

		const awards = el('ul', 'awards');
		if (state.winner === player) {
			const w = el('li', 'award award--winner');
			w.append(iconElement('crown'), document.createTextNode('Winner'));
			awards.append(w);
		}
		if (state.longestRoad === player) {
			const a = el('li', 'award');
			a.append(iconElement('trophy'), document.createTextNode(`Longest Road (${longestRoadLength(state, player)})`));
			awards.append(a);
		}

		row.append(head, meter, awards, cards, supply);
		return row;
	}

	// ------------------------------------------------------------ render

	async function render(): Promise<void> {
		const log = await store.load(GAME_ID);
		const state = replayPlay(log);
		if (!state.started || !state.board) return;
		show('play');

		renderBoard(board, state.board, boardList, overlay(state));
		boardHint.textContent = boardInstruction(state);
		turn.replaceChildren(...turnPanel(state));
		roster.replaceChildren(...state.players.map((p) => playerRow(state, p)));

		winner.hidden = state.winner === null;
		if (state.winner) {
			winner.querySelector('.notice__body')?.replaceChildren(
				el('p', 'notice__title', `${state.winner} wins with ${points(state, state.winner)} points.`),
				el('p', undefined, 'The game is over. Start a new game to play again.'),
			);
		}

		events.replaceChildren(
			...log
				.map((event, i) => describePlayEvent(event, replayPlay(log.slice(0, i + 1))))
				.reverse()
				.map((text) => el('li', undefined, text)),
		);
		eventCount.textContent = String(log.length);
		rolledJustNow = false;
	}

	document.addEventListener('keydown', (event) => {
		if (event.key === 'Escape' && mode && !section.hidden) {
			mode = null;
			void render().then(() => feedback.announce('Building cancelled.'));
		}
	});

	return {
		async isActive() {
			return (await loadPlay(store, GAME_ID)).started;
		},
		render,
		async start(players, seed) {
			const message = await run({ type: 'StartGame', players, seed });
			lastMessage = '';
			return message;
		},
		async players() {
			return (await loadPlay(store, GAME_ID)).players;
		},
		clear() {
			store.clear?.(GAME_ID);
			mode = null;
			lastMessage = '';
		},
	};
}
