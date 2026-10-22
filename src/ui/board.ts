/**
 * Draws a board into an <svg>. The geometry and text come from the tested
 * view model in src/lib/app/board-view.ts; this file only creates elements.
 * Used by every page that shows a board, so it is implemented once.
 */
import { boardView, cornerPoint } from '../lib/app/board-view';
import type { Board } from '../lib/games/catan/board';
import { TOPOLOGY } from '../lib/games/catan-play/topology';

/** Pieces and clickable spots drawn over the board in play mode. */
export interface BoardOverlay {
	/** `fresh` pieces were placed by the last action and get a short placing animation. */
	readonly buildings: readonly { vertex: number; seat: number; kind: 'settlement' | 'city'; label: string; fresh?: boolean }[];
	readonly roads: readonly { edge: number; seat: number; label: string; fresh?: boolean }[];
	/** Legal spots for the current action. Each is a keyboard-focusable button. */
	readonly targets?: {
		readonly kind: 'vertex' | 'edge';
		readonly ids: readonly number[];
		readonly label: (id: number) => string;
		readonly onPick: (id: number) => void;
	};
	/** Harbours on coastal edges: "any" (3:1) or a resource (2:1). */
	readonly harbours?: readonly { edge: number; kind: string; label: string }[];
	/** Hex key ("q,r") the robber stands on. */
	readonly robber?: string | null;
	/** Hexes the robber can move to, as keyboard-focusable buttons. */
	readonly hexTargets?: {
		readonly keys: readonly string[];
		readonly label: (key: string) => string;
		readonly onPick: (key: string) => void;
	};
}

const SIZE = 50;

const SVG = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(
	tag: K,
	attributes: Record<string, string | number>,
): SVGElementTagNameMap[K] {
	const node = document.createElementNS(SVG, tag);
	for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
	return node;
}

/** Replaces the contents of `target` with `board`, plus a text list for screen readers. */
export function renderBoard(
	target: SVGSVGElement,
	board: Board,
	list?: HTMLOListElement,
	overlay?: BoardOverlay,
): void {
	const view = boardView(board, SIZE);
	target.setAttribute('viewBox', view.viewBox);
	target.setAttribute('role', 'img');

	const sea = svg('polygon', { points: view.sea, class: 'board__sea' });
	const coast = svg('polygon', { points: view.coast, class: 'board__coast' });
	const tiles = view.hexes.map((hex) => {
		const group = svg('g', { class: `board__hex board__hex--${hex.terrain}` });
		const title = svg('title', {});
		title.textContent = hex.label;
		group.append(
			title,
			svg('polygon', { points: hex.points, class: 'board__tile' }),
			svg('polygon', { points: hex.inner, class: 'board__bevel' }),
		);
		group.append(svg('use', { href: `#terrain-${hex.terrain}`, x: hex.cx - 16, y: hex.cy - 38, width: 32, height: 20, class: 'board__glyph' }));
		if (hex.token !== null) {
			// A token is a small disc: a shadow, the face, and a fine inner ring.
			group.append(
				svg('circle', { cx: hex.cx, cy: hex.cy + 7.5, r: 19, class: 'board__token-shadow' }),
				svg('circle', { cx: hex.cx, cy: hex.cy + 6, r: 19, class: 'board__token' }),
				svg('circle', { cx: hex.cx, cy: hex.cy + 6, r: 16, class: 'board__token-ring' }),
			);
			const number = svg('text', {
				x: hex.cx,
				y: hex.cy + 9,
				class: hex.red ? 'board__number board__number--red' : 'board__number',
			});
			number.textContent = String(hex.token);
			group.append(number);
			const spread = (hex.pips - 1) * 2.6;
			for (let i = 0; i < hex.pips; i++) {
				group.append(
					svg('circle', {
						cx: hex.cx - spread + i * 5.2,
						cy: hex.cy + 17,
						r: 1.5,
						class: hex.red ? 'board__pip board__pip--red' : 'board__pip',
					}),
				);
			}
		}
		return group;
	});
	const centres = new Map(view.hexes.map((h) => [h.key, { x: h.cx, y: h.cy }]));
	target.replaceChildren(defs(), sea, coast, ...tiles, ...(overlay ? drawOverlay(overlay, centres) : []));

	if (list) {
		list.replaceChildren(
			...view.hexes.map((hex) => {
				const item = document.createElement('li');
				item.textContent = hex.label;
				return item;
			}),
		);
	}
}

const point = (vertex: number) => cornerPoint(TOPOLOGY.vertices[vertex] ?? { x: 0, y: 0 }, SIZE);

function titled<T extends SVGElement>(node: T, label: string): T {
	const title = svg('title', {});
	title.textContent = label;
	node.prepend(title);
	return node;
}

function makeButton(spot: SVGElement, label: string, pick: () => void, key: string): SVGElement {
	spot.setAttribute('role', 'button');
	spot.setAttribute('tabindex', '0');
	spot.setAttribute('aria-label', label);
	spot.dataset.spot = key;
	titled(spot, label);
	spot.addEventListener('click', pick);
	spot.addEventListener('keydown', (event) => {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			pick();
		}
	});
	return spot;
}

/** The robber: a dark pawn, drawn above the hex's number token. */
function robberPiece(x: number, y: number): SVGElement {
	const group = titled(svg('g', { class: 'robber', transform: `translate(${x} ${y - 20})` }), 'The robber');
	group.append(
		svg('ellipse', { cx: 0, cy: 9, rx: 8, ry: 2.6, class: 'robber__base' }),
		svg('path', { d: 'M-6 9C-6 2-4 -1-3-3A5 5 0 1 1 3-3C4-1 6 2 6 9Z', class: 'robber__body' }),
	);
	return group;
}

function drawOverlay(overlay: BoardOverlay, centres: Map<string, { x: number; y: number }>): SVGElement[] {
	const layer: SVGElement[] = [];

	for (const road of overlay.roads) {
		const [a, b] = (TOPOLOGY.edges[road.edge]?.ends ?? [0, 0]).map(point);
		if (!a || !b) continue;
		// Shorten each end so roads stop short of the corners, like the real pieces.
		const t = 0.17;
		const line = { x1: a.x + (b.x - a.x) * t, y1: a.y + (b.y - a.y) * t, x2: b.x + (a.x - b.x) * t, y2: b.y + (a.y - b.y) * t };
		const group = titled(
			svg('g', { class: `piece piece--road seat-color--${road.seat}${road.fresh ? ' piece--new' : ''}` }),
			road.label,
		);
		group.append(svg('line', { ...line, class: 'piece__road-edge' }), svg('line', { ...line, class: 'piece__road' }));
		layer.push(group);
	}

	const buildingLayer: SVGElement[] = [];
	for (const building of overlay.buildings) {
		const { x, y } = point(building.vertex);
		const shape =
			building.kind === 'city'
				? 'M-13 9H13V-3H3V-7L-5-14L-13-7Z'
				: 'M-9 8H9V-2L0-10L-9-2Z';
		const group = titled(
			svg('g', { class: `piece piece--${building.kind} seat-color--${building.seat}`, transform: `translate(${x} ${y})` }),
			building.label,
		);
		// The seat number on the piece means ownership never depends on colour alone.
		const inner = svg('g', { class: building.fresh ? 'piece__shape piece--new' : 'piece__shape' });
		const seat = svg('text', { x: 0, y: building.kind === 'city' ? 5.5 : 4.5, class: 'piece__seat' });
		seat.textContent = String(building.seat);
		inner.append(svg('path', { d: shape, class: 'piece__body' }), seat);
		group.append(inner);
		buildingLayer.push(group);
	}

	// Harbours sit just off the coast with two piers to the corners they serve.
	for (const harbour of overlay.harbours ?? []) {
		const [a, b] = (TOPOLOGY.edges[harbour.edge]?.ends ?? [0, 0]).map(point);
		if (!a || !b) continue;
		const mx = (a.x + b.x) / 2;
		const my = (a.y + b.y) / 2;
		const length = Math.hypot(mx, my) || 1;
		const wide = harbour.kind !== 'any';
		// Keep wide signs inside the sea frame at the far left and right.
		const limit = 250 - (wide ? 26 : 15);
		const hx = Math.max(-limit, Math.min(limit, mx + (mx / length) * 26));
		const hy = my + (my / length) * 26;
		const group = titled(svg('g', { class: `harbour harbour--${harbour.kind}` }), harbour.label);
		group.append(
			svg('line', { x1: a.x, y1: a.y, x2: hx, y2: hy, class: 'harbour__pier' }),
			svg('line', { x1: b.x, y1: b.y, x2: hx, y2: hy, class: 'harbour__pier' }),
		);
		// The resource is written on the sign, so it never depends on colour alone.
		const wording = harbour.kind === 'any' ? '3:1' : `2:1 ${harbour.kind}`;
		const width = wide ? 52 : 30;
		group.append(svg('rect', { x: hx - width / 2, y: hy - 9, width, height: 18, rx: 4, class: 'harbour__sign' }));
		const text = svg('text', { x: hx, y: hy + 3.5, class: 'harbour__rate' });
		text.textContent = wording;
		group.append(text);
		layer.push(group);
	}

	const robberAt = overlay.robber ? centres.get(overlay.robber) : undefined;
	if (robberAt) buildingLayer.push(robberPiece(robberAt.x, robberAt.y));

	if (overlay.hexTargets) {
		const group = svg('g', { class: 'board__targets' });
		for (const key of overlay.hexTargets.keys) {
			const centre = centres.get(key);
			if (!centre) continue;
			const ring = svg('circle', { cx: centre.x, cy: centre.y + 6, r: 24, class: 'board__target board__target--hex' });
			const targets = overlay.hexTargets;
			group.append(makeButton(ring, targets.label(key), () => targets.onPick(key), key));
		}
		return [...layer, ...buildingLayer, group];
	}

	const targets = overlay.targets;
	if (targets) {
		const group = svg('g', { class: 'board__targets' });
		for (const id of targets.ids) {
			let spot: SVGElement;
			if (targets.kind === 'vertex') {
				const { x, y } = point(id);
				spot = svg('circle', { cx: x, cy: y, r: 14, class: 'board__target' });
			} else {
				const [a, b] = (TOPOLOGY.edges[id]?.ends ?? [0, 0]).map(point);
				spot = svg('g', { class: 'board__target board__target--edge' });
				// A thin rectangle along the edge is the hit area (a bare line has no
				// width to click or to report as visible).
				// Stop short of the corners, like roads do, so pieces stay visible.
				const t = 0.2;
				const ax = (a?.x ?? 0) + ((b?.x ?? 0) - (a?.x ?? 0)) * t;
				const ay = (a?.y ?? 0) + ((b?.y ?? 0) - (a?.y ?? 0)) * t;
				const bx = (b?.x ?? 0) + ((a?.x ?? 0) - (b?.x ?? 0)) * t;
				const by = (b?.y ?? 0) + ((a?.y ?? 0) - (b?.y ?? 0)) * t;
				const length = Math.hypot(bx - ax, by - ay) || 1;
				const nx = (-(by - ay) / length) * 11;
				const ny = ((bx - ax) / length) * 11;
				const hit = [
					[ax + nx, ay + ny],
					[bx + nx, by + ny],
					[bx - nx, by - ny],
					[ax - nx, ay - ny],
				]
					.map(([x, y]) => `${Math.round((x ?? 0) * 100) / 100},${Math.round((y ?? 0) * 100) / 100}`)
					.join(' ');
				spot.append(
					svg('polygon', { points: hit, class: 'board__target-hit' }),
					svg('line', { x1: ax, y1: ay, x2: bx, y2: by, class: 'board__target-line' }),
				);
			}
			const label = targets.label(id);
			spot.setAttribute('role', 'button');
			spot.setAttribute('tabindex', '0');
			spot.setAttribute('aria-label', label);
			spot.dataset.spot = String(id);
			titled(spot, label);
			spot.addEventListener('click', () => targets.onPick(id));
			spot.addEventListener('keydown', (event) => {
				if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault();
					targets.onPick(id);
				}
			});
			group.append(spot);
		}
		// Edge spots go under the buildings; corner spots go on top of everything.
		return targets.kind === 'edge' ? [...layer, group, ...buildingLayer] : [...layer, ...buildingLayer, group];
	}
	return [...layer, ...buildingLayer];
}

/** Small terrain glyphs, drawn once and reused by every hex. */
function defs(): SVGDefsElement {
	const d = svg('defs', {});
	const glyph = (id: string, paths: string[]) => {
		const symbol = svg('symbol', { id, viewBox: '0 0 32 20' });
		for (const path of paths) symbol.append(svg('path', { d: path }));
		d.append(symbol);
	};
	glyph('terrain-forest', ['M8 18 3 18 8 6 13 18Z', 'M18 18 12 18 18 2 24 18Z', 'M27 18 23 18 27 9 31 18Z']);
	glyph('terrain-pasture', ['M4 16c2-4 4-4 6 0M12 16c2-5 5-5 7 0M21 16c2-4 4-4 7 0']);
	glyph('terrain-fields', ['M8 18V6M8 6c-2 1-3 3-3 5M8 6c2 1 3 3 3 5', 'M16 18V3M16 3c-2 1-3 3-3 5M16 3c2 1 3 3 3 5', 'M24 18V6M24 6c-2 1-3 3-3 5M24 6c2 1 3 3 3 5']);
	glyph('terrain-hills', ['M2 18c4-9 8-9 12 0Z', 'M12 18c5-12 11-12 16 0Z']);
	glyph('terrain-mountains', ['M2 18 11 4 20 18Z', 'M14 18 22 7 30 18Z']);
	glyph('terrain-desert', ['M3 15c4-3 8-3 12 0s8 3 14 0']);
	return d;
}
