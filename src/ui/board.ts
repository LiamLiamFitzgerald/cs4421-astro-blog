/**
 * Draws a board into an <svg>. The geometry and text come from the tested
 * view model in src/lib/app/board-view.ts; this file only creates elements.
 * Used by every page that shows a board, so it is implemented once.
 */
import { boardView } from '../lib/app/board-view';
import type { Board } from '../lib/games/catan/board';

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
export function renderBoard(target: SVGSVGElement, board: Board, list?: HTMLOListElement): void {
	const view = boardView(board, 50);
	target.setAttribute('viewBox', view.viewBox);
	target.setAttribute('role', 'img');

	const sea = svg('polygon', { points: view.sea, class: 'board__sea' });
	const tiles = view.hexes.map((hex) => {
		const group = svg('g', { class: `board__hex board__hex--${hex.terrain}` });
		const title = svg('title', {});
		title.textContent = hex.label;
		group.append(title, svg('polygon', { points: hex.points, class: 'board__tile' }));
		group.append(svg('use', { href: `#terrain-${hex.terrain}`, x: hex.cx - 16, y: hex.cy - 38, width: 32, height: 20, class: 'board__glyph' }));
		if (hex.token !== null) {
			group.append(svg('circle', { cx: hex.cx, cy: hex.cy + 6, r: 19, class: 'board__token' }));
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
	target.replaceChildren(defs(), sea, ...tiles);

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
