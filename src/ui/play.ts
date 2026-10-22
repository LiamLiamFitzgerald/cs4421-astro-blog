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
	describeHarbour,
	describeHex,
	describePlayEvent,
	describePlayViolation,
	describeRoll,
	describeStep,
	CARD_EFFECTS,
	CARD_NAMES,
	describeCardReason,
	PIECE_NAMES,
	tradeableResources,
} from '../lib/app/play-view';
import type { PlayCommand } from '../lib/games/catan-play/commands';
import type { PlayEvent } from '../lib/games/catan-play/events';
import { replayPlay } from '../lib/games/catan-play/evolve';
import {
	actingPlayer,
	buildOptions,
	currentPlayer,
	devCardOptions,
	hiddenPoints,
	legalRoads,
	tradeRate,
	visiblePoints,
	expectedStep,
	legalRobberHexes,
	legalSetupRoads,
	legalSetupSettlements,
	longestRoadLength,
	piecesLeft,
	points,
} from '../lib/games/catan-play/queries';
import { DEV_CARD_COST, emptyHand, type Hand, handSize, missing, type Piece, RESOURCES, type Resource } from '../lib/games/catan-play/resources';
import type { PlayState } from '../lib/games/catan-play/state';
import { TOPOLOGY } from '../lib/games/catan-play/topology';
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

/** A fair random integer from 0 to n − 1 from the browser's secure source. */
function randomBelow(n: number): number {
	if (n <= 1) return 0;
	const limit = Math.floor(0x100000000 / n) * n;
	const buffer = new Uint32Array(1);
	for (;;) {
		crypto.getRandomValues(buffer);
		const value = buffer[0] ?? 0;
		if (value < limit) return value % n;
	}
}

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
	/** What the last action changed, so the next render can show it briefly. */
	let fresh: { vertices: Set<number>; edges: Set<number>; gains: Record<string, Partial<Record<Resource, number>>> } = {
		vertices: new Set(),
		edges: new Set(),
		gains: {},
	};

	function changes(before: PlayState, after: PlayState) {
		const changedVertices = Object.keys(after.buildings)
			.map(Number)
			.filter((v) => before.buildings[v]?.kind !== after.buildings[v]?.kind);
		const newEdges = Object.keys(after.roads)
			.map(Number)
			.filter((e) => before.roads[e] === undefined);
		const gains: Record<string, Partial<Record<Resource, number>>> = {};
		for (const p of after.players) {
			for (const r of RESOURCES) {
				const gain = (after.hands[p]?.[r] ?? 0) - (before.hands[p]?.[r] ?? 0);
				if (gain > 0) gains[p] = { ...gains[p], [r]: gain };
			}
		}
		return { vertices: new Set(changedVertices), edges: new Set(newEdges), gains };
	}

	const seatOf = (state: PlayState, player: string) => state.players.indexOf(player) + 1;

	/** Runs a command; violations show beside the turn controls, failures get Try again. */
	async function run(command: PlayCommand): Promise<string | null> {
		if (busy) return null;
		busy = true;
		section.setAttribute('aria-busy', 'true');
		try {
			const before = replayPlay(await store.load(GAME_ID));
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
			fresh = changes(before, state);
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
		const next = actingPlayer(state);
		const step = expectedStep(state);
		if (state.winner) parts.push(`${state.winner} wins with ${points(state, state.winner)} points.`);
		else if (next && step && step !== 'roll' && step !== 'build-or-end' && step !== 'place-settlement' && step !== 'place-road') {
			parts.push(`${next}: ${describeStep(step)}`);
		}
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
			fresh: fresh.vertices.has(Number(vertex)),
		}));
		const roads = Object.entries(state.roads).map(([edge, owner]) => ({
			edge: Number(edge),
			seat: seatOf(state, owner),
			label: `${owner}'s road ${describeEdge(state.board, Number(edge))}`,
			fresh: fresh.edges.has(Number(edge)),
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
		} else if (step === 'place-free-road') {
			targets = edgeTargets(legalRoads(state, player), (edge) => ({ type: 'BuildRoad', player, edge }));
		} else if (step === 'build-or-end' && mode) {
			const option = buildOptions(state, player).find((o) => o.piece === mode);
			const spots = option?.allowed ? [...option.spots] : [];
			if (mode === 'road') targets = edgeTargets(spots, (edge) => ({ type: 'BuildRoad', player, edge }));
			if (mode === 'settlement') targets = vertexTargets(spots, 'Build a settlement', (vertex) => ({ type: 'BuildSettlement', player, vertex }));
			if (mode === 'city') targets = vertexTargets(spots, 'Upgrade to a city', (vertex) => ({ type: 'BuildCity', player, vertex }));
		}
		const hexTargets =
			step === 'move-robber'
				? {
						keys: legalRobberHexes(state),
						label: (key: string) => `Move the robber to ${describeHex(state.board, key)}`,
						onPick: (hex: string) => void run({ type: 'MoveRobber', player, hex }),
					}
				: undefined;
		const harbours = state.harbours.map((h) => ({ edge: h.edge, kind: h.kind, label: describeHarbour(h.kind) }));
		return { buildings, roads, targets, robber: state.robber, hexTargets, harbours };
	}

	function boardInstruction(state: PlayState): string {
		const step = expectedStep(state);
		if (step === 'place-settlement') return 'Choose a highlighted corner for the settlement.';
		if (step === 'place-road') return 'Choose a highlighted edge for the road.';
		if (step === 'move-robber') return 'Choose a highlighted hex for the robber. It cannot stay where it is.';
		if (step === 'place-free-road' && state.pending?.kind === 'place-free-road') {
			const n = state.pending.remaining;
			return `Choose a highlighted edge for a free road (${n} left).`;
		}
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
		const actor = actingPlayer(state) ?? player;
		const step = expectedStep(state);
		const seat = seatOf(state, actor);
		const parts: HTMLElement[] = [];

		const head = el('header', 'turn__head');
		const badge = el('span', `seat seat--${seat}`, String(seat));
		badge.setAttribute('aria-hidden', 'true');
		const title = el(
			'h2',
			'turn__title',
			state.winner
				? 'Game over'
				: step === 'discard'
					? `${actor} must discard`
					: step === 'respond-trade'
						? `${actor}, you have a trade offer`
						: `${player}'s turn`,
		);
		title.id = 'turn-title';
		head.append(badge, title);
		if (state.phase === 'setup') head.append(el('span', 'turn__phase', 'Setup'));
		parts.push(head);

		if (step) parts.push(el('p', 'turn__step', describeStep(step)));

		// Show this turn's roll; before rolling, the previous player's dice would only confuse.
		if (state.lastRoll && state.phase !== 'setup' && step !== 'roll') {
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
		if (step === 'discard' && state.pending?.kind === 'discard') {
			actions.append(discardForm(state, actor, state.pending.owed[actor] ?? 0));
		}
		if (step === 'steal' && state.pending?.kind === 'steal') {
			const group = el('div', 'steal');
			group.setAttribute('role', 'group');
			group.setAttribute('aria-label', 'Steal a card');
			for (const victim of state.pending.victims) {
				const cards = handSize(state.hands[victim] ?? emptyHand);
				const b = button(`Steal from ${victim} (${cards} card${cards === 1 ? '' : 's'})`, null, 'button');
				// The card is chosen at random here and checked by the rules (ADR-011).
				b.addEventListener('click', () => void run({ type: 'StealFrom', player, victim, pick: randomBelow(cards) }));
				group.append(b);
			}
			actions.append(group);
		}
		if (step === 'respond-trade' && state.pending?.kind === 'respond-trade') {
			actions.append(responsePanel(state, state.pending));
		}
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
			builds.append(buyCardButton(state, player));
			actions.append(builds, tradeForm(state, player), offerForm(state, player));
			const cards = devCardPanel(state, player);
			if (cards) actions.append(cards);
			const end = button('End turn', null, 'button button--primary turn__end');
			end.addEventListener('click', () => void run({ type: 'EndTurn', player }));
			actions.append(end);
		}
		if (step === 'roll') {
			// Cards can be played before rolling (a knight, say).
			const cards = devCardPanel(state, player);
			if (cards) actions.append(cards);
		}
		parts.push(actions);
		return parts;
	}

	function buyCardButton(state: PlayState, player: string): HTMLButtonElement {
		const b = el('button', 'button build');
		b.type = 'button';
		const label = el('span', 'build__label');
		label.append(iconElement('card'), document.createTextNode('Buy card'));
		const short = missing(state.hands[player] ?? emptyHand, DEV_CARD_COST);
		const reason =
			state.deck.length === 0
				? 'No cards left'
				: handSize(short) > 0
					? `Needs ${describeHand(short)}`
					: `${state.deck.length} left`;
		const note = el('span', 'build__note', reason);
		note.id = 'build-note-card';
		b.setAttribute('aria-describedby', note.id);
		b.append(label, costList(DEV_CARD_COST), note);
		b.disabled = state.deck.length === 0 || handSize(short) > 0;
		b.addEventListener('click', () => void run({ type: 'BuyDevelopmentCard', player }));
		return b;
	}

	/** The current player's development cards, each with Play (or why it cannot be played). */
	function devCardPanel(state: PlayState, player: string): HTMLElement | null {
		const options = devCardOptions(state, player);
		if (options.length === 0) return null;
		const section = el('section', 'cards');
		section.setAttribute('aria-label', `${player}'s development cards`);
		section.append(el('p', 'trade__title', 'Development cards'));
		for (const option of options) {
			const row = el('div', 'card-row');
			const name = el('div', 'card-row__name');
			name.append(iconElement(option.card === 'knight' ? 'knight' : 'card'), document.createTextNode(`${CARD_NAMES[option.card]}${option.held > 1 ? ` ×${option.held}` : ''}`));
			const text = el('p', 'card-row__text', CARD_EFFECTS[option.card]);
			const controls = el('div', 'card-row__controls');
			const choose = (labelText: string) => {
				const select = el('select', 'input trade__select');
				select.setAttribute('aria-label', labelText);
				for (const r of RESOURCES) select.append(new Option(r, r));
				return select;
			};
			let command: () => PlayCommand | null = () => null;
			if (option.card === 'knight') command = () => ({ type: 'PlayKnight', player });
			if (option.card === 'road-building') command = () => ({ type: 'PlayRoadBuilding', player });
			if (option.card === 'year-of-plenty') {
				const a = choose('First resource');
				const b = choose('Second resource');
				controls.append(a, b);
				command = () => ({ type: 'PlayYearOfPlenty', player, resources: [a.value as Resource, b.value as Resource] });
			}
			if (option.card === 'monopoly') {
				const r = choose('Resource to take');
				controls.append(r);
				command = () => ({ type: 'PlayMonopoly', player, resource: r.value as Resource });
			}
			if (option.card !== 'victory-point') {
				const play = button(`Play ${CARD_NAMES[option.card].toLowerCase()}`, null, 'button button--small');
				play.disabled = !option.allowed;
				play.addEventListener('click', () => {
					const c = command();
					if (c) void run(c);
				});
				controls.append(play);
			}
			row.append(name, text, controls);
			if (!option.allowed) row.append(el('p', 'build__note', describeCardReason(option.reason)));
			section.append(row);
		}
		return section;
	}

	/** Steppers for choosing which cards to discard after a 7. */
	function discardForm(state: PlayState, player: string, owed: number): HTMLElement {
		const form = el('form', 'discard');
		form.setAttribute('aria-label', `${player}: discard ${owed} cards`);
		const held = state.hands[player] ?? emptyHand;
		const chosen: Record<Resource, number> = { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
		const status = el('p', 'discard__status numeric');
		status.setAttribute('aria-live', 'polite');
		const submit = button('Discard', null, 'button button--primary');
		submit.type = 'submit';
		const rows = el('div', 'discard__rows');
		const update = () => {
			const total = RESOURCES.reduce((n, r) => n + chosen[r], 0);
			status.textContent = `${total} of ${owed} chosen`;
			submit.disabled = total !== owed;
			for (const r of RESOURCES) {
				rows.querySelector<HTMLOutputElement>(`[data-count="${r}"]`)!.textContent = String(chosen[r]);
				rows.querySelector<HTMLButtonElement>(`[data-less="${r}"]`)!.disabled = chosen[r] === 0;
				rows.querySelector<HTMLButtonElement>(`[data-more="${r}"]`)!.disabled = chosen[r] >= held[r] || total >= owed;
			}
		};
		for (const r of RESOURCES) {
			if (held[r] === 0) continue;
			const row = el('div', 'discard__row');
			const label = el('span', 'discard__name');
			label.append(iconElement(RESOURCE_ICONS[r]), document.createTextNode(`${r} (${held[r]})`));
			const less = button('−', null, 'button button--small');
			less.dataset.less = r;
			less.setAttribute('aria-label', `Discard one fewer ${r}`);
			const count = el('output', 'discard__count numeric', '0');
			count.dataset.count = r;
			const more = button('+', null, 'button button--small');
			more.dataset.more = r;
			more.setAttribute('aria-label', `Discard one more ${r}`);
			less.addEventListener('click', () => {
				chosen[r] -= 1;
				update();
			});
			more.addEventListener('click', () => {
				chosen[r] += 1;
				update();
			});
			row.append(label, less, count, more);
			rows.append(row);
		}
		form.append(rows, status, submit);
		form.addEventListener('submit', (event) => {
			event.preventDefault();
			void run({ type: 'DiscardCards', player, cards: { ...chosen } });
		});
		// Rows must exist before the first update.
		queueMicrotask(update);
		return form;
	}

	/** Up/down steppers for an amount of each resource. Returns the element and a reader. */
	function resourcePicker(label: string, limit: (r: Resource) => number, onChange: () => void) {
		const chosen: Record<Resource, number> = { lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
		const group = el('fieldset', 'picker');
		group.append(el('legend', 'picker__legend', label));
		for (const r of RESOURCES) {
			const max = limit(r);
			const row = el('div', 'discard__row');
			const name = el('span', 'discard__name');
			name.append(iconElement(RESOURCE_ICONS[r]), document.createTextNode(r));
			const less = button('−', null, 'button button--small');
			less.setAttribute('aria-label', `${label}: one fewer ${r}`);
			const count = el('output', 'discard__count numeric', '0');
			const more = button('+', null, 'button button--small');
			more.setAttribute('aria-label', `${label}: one more ${r}`);
			const sync = () => {
				count.textContent = String(chosen[r]);
				less.disabled = chosen[r] === 0;
				more.disabled = chosen[r] >= max;
			};
			less.addEventListener('click', () => {
				chosen[r] -= 1;
				sync();
				onChange();
			});
			more.addEventListener('click', () => {
				chosen[r] += 1;
				sync();
				onChange();
			});
			sync();
			row.append(name, less, count, more);
			group.append(row);
		}
		return { element: group, value: () => ({ ...chosen }) };
	}

	/** Offer a trade to another player; tucked away until opened (progressive disclosure). */
	function offerForm(state: PlayState, player: string): HTMLElement {
		const details = el('details', 'offer');
		details.append(el('summary', undefined, 'Offer a trade to another player'));
		const others = state.players.filter((p) => p !== player);
		const form = el('form', 'offer__form');
		const to = el('select', 'input trade__select');
		to.setAttribute('aria-label', 'Trade with');
		for (const p of others) to.append(new Option(p, p));
		const held = state.hands[player] ?? emptyHand;
		const submit = button('Offer trade', null, 'button button--small');
		submit.type = 'submit';
		const check = () => {
			const total = (h: Record<Resource, number>) => RESOURCES.reduce((n, r) => n + h[r], 0);
			submit.disabled = total(give.value()) === 0 || total(get.value()) === 0;
		};
		const give = resourcePicker('You give', (r) => held[r], check);
		const get = resourcePicker('You get', () => 19, check);
		const who = el('label', 'offer__to');
		who.append(document.createTextNode('Trade with '), to);
		form.append(who, give.element, get.element, submit);
		check();
		form.addEventListener('submit', (event) => {
			event.preventDefault();
			void run({ type: 'ProposeTrade', player, to: to.value, give: give.value(), get: get.value() });
		});
		details.append(form);
		return details;
	}

	/** The recipient sees the offer and answers it. */
	function responsePanel(state: PlayState, offer: { from: string; to: string; give: Hand; get: Hand }): HTMLElement {
		const panel = el('div', 'response');
		panel.append(
			el('p', 'response__terms', `${offer.from} offers ${describeHand(offer.give)} for your ${describeHand(offer.get)}.`),
		);
		const short = missing(state.hands[offer.to] ?? emptyHand, offer.get);
		const accept = button('Accept trade', 'check', 'button button--primary');
		accept.disabled = handSize(short) > 0;
		accept.addEventListener('click', () => void run({ type: 'AcceptTrade', player: offer.to }));
		const decline = button('Decline', 'close', 'button');
		decline.addEventListener('click', () => void run({ type: 'DeclineTrade', player: offer.to }));
		const buttons = el('div', 'response__buttons');
		buttons.append(accept, decline);
		panel.append(buttons);
		if (handSize(short) > 0) panel.append(el('p', 'build__note', `You need ${describeHand(short)} more to accept.`));
		return panel;
	}

	function tradeForm(state: PlayState, player: string): HTMLElement {
		const form = el('form', 'trade');
		form.setAttribute('aria-label', 'Trade with the bank');
		const rate = (r: Resource) => tradeRate(state, player, r);
		const offer = tradeableResources(state.hands[player] ?? emptyHand, rate);
		const best = Math.min(...RESOURCES.map(rate));
		const legend = el('p', 'trade__title', best < 4 ? 'Trade with the bank (your harbour rates)' : 'Trade 4 for 1 with the bank');
		const give = el('select', 'input trade__select');
		give.setAttribute('aria-label', 'Give');
		const get = el('select', 'input trade__select');
		get.setAttribute('aria-label', 'Get 1');
		for (const r of offer) give.append(new Option(`${rate(r)} ${r}`, r));
		for (const r of RESOURCES) get.append(new Option(`1 ${r}`, r));
		const firstOther = RESOURCES.find((r) => r !== offer[0]);
		if (firstOther) get.value = firstOther;
		const submit = button('Trade', null, 'button button--small');
		submit.type = 'submit';
		form.append(legend);
		if (offer.length === 0) {
			form.append(
				el('p', 'hint', best < 4 ? `You need ${best} or more of one resource to trade.` : 'You need 4 of one resource to trade. Harbours lower the rate.'),
			);
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
		const isCurrent = actingPlayer(state) === player && !state.winner;
		const row = el('article', `play-player seat-color--${seat}`);
		row.classList.toggle('play-player--current', isCurrent);
		row.classList.toggle('player--winner', state.winner === player);
		row.setAttribute('aria-label', `${player}${isCurrent ? ', playing now' : ''}`);

		const head = el('header', 'player__head');
		const badge = el('span', `seat seat--${seat}`, String(seat));
		badge.setAttribute('aria-hidden', 'true');
		const score = el('p', 'player__score');
		// Others see only visible points; the player whose input is needed also sees their hidden ones.
		const vp = visiblePoints(state, player);
		const hidden = isCurrent || state.winner === player ? hiddenPoints(state, player) : 0;
		score.append(el('strong', 'numeric', String(vp + hidden)), el('span', undefined, ` of ${WINNING_POINTS} points`));
		if (hidden > 0) score.append(el('span', 'player__hidden', ` (${hidden} from hidden cards)`));
		head.append(badge, el('h3', 'player__name', player), score);

		const meter = el('div', 'meter');
		meter.setAttribute('role', 'meter');
		meter.setAttribute('aria-valuemin', '0');
		meter.setAttribute('aria-valuemax', String(WINNING_POINTS));
		meter.setAttribute('aria-valuenow', String(Math.min(vp + hidden, WINNING_POINTS)));
		meter.setAttribute('aria-label', `${player}'s progress to ${WINNING_POINTS} points`);
		for (let i = 0; i < WINNING_POINTS; i++) meter.append(el('span', i < vp + hidden ? 'meter__step meter__step--on' : 'meter__step'));

		const hand = state.hands[player] ?? emptyHand;
		const cards = el('dl', 'hand');
		cards.setAttribute('aria-label', `${player}'s resources`);
		const gained = fresh.gains[player] ?? {};
		for (const r of RESOURCES) {
			const gain = gained[r] ?? 0;
			const item = el('div', `hand__item${hand[r] === 0 ? ' hand__item--none' : ''}${gain > 0 ? ' hand__item--gain' : ''}`);
			const value = el('dd', 'hand__count numeric');
			value.append(iconElement(RESOURCE_ICONS[r]), document.createTextNode(String(hand[r])));
			// The roll summary already announces gains, so the badge is visual only.
			if (gain > 0) {
				const badge = el('span', 'hand__gain', `+${gain}`);
				badge.setAttribute('aria-hidden', 'true');
				value.append(badge);
			}
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
		if (state.largestArmy === player) {
			const a = el('li', 'award');
			a.append(iconElement('army'), document.createTextNode(`Largest Army (${state.knightsPlayed[player] ?? 0})`));
			awards.append(a);
		}
		const cardCount = (state.devCards[player] ?? []).length;
		const knights = state.knightsPlayed[player] ?? 0;
		const extras = el('span', 'supply__item');
		extras.append(iconElement('card'), document.createTextNode(`${cardCount} card${cardCount === 1 ? '' : 's'}`));
		const army = el('span', 'supply__item');
		army.append(iconElement('knight'), document.createTextNode(`${knights} knight${knights === 1 ? '' : 's'} played`));
		supply.append(extras, army);

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
		for (const h of state.harbours) {
			const [a] = TOPOLOGY.edges[h.edge]?.ends ?? [0];
			boardList.append(el('li', undefined, `${describeHarbour(h.kind)} by ${describeCorner(state.board, a)}`));
		}
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
		fresh = { vertices: new Set(), edges: new Set(), gains: {} };
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
