/**
 * The project's one icon set: 24×24 stroke icons, drawn in currentColor.
 * Icon.astro (server) and iconElement (browser) both read these paths, so
 * every page uses the same drawings. No emoji stand in for icons.
 */
export const ICONS = {
	settlement: ['M4 20V11l8-6 8 6v9Z', 'M10 20v-5h4v5'],
	city: ['M3 20V10l5-4 5 4v10', 'M13 20V8h8v12', 'M3 20h18', 'M16 11h2M16 14h2M7 14h2'],
	road: ['M8 3 5 21', 'M16 3l3 18', 'M12 5v2M12 11v2M12 17v2'],
	knight: ['M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6Z'],
	card: ['M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z', 'M12 8l1.2 2.5 2.8.4-2 1.9.5 2.7L12 14.2l-2.5 1.3.5-2.7-2-1.9 2.8-.4Z'],
	army: ['M4 4l10 10M4 4h3v3M14 14l-2 2 4 4 2-2Z', 'M20 4 10 14M20 4h-3v3M10 14l2 2-4 4-2-2Z'],
	trophy: ['M8 4h8v5a4 4 0 0 1-8 0Z', 'M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4', 'M12 13v4M8 20h8M10 17h4'],
	crown: ['M3 8l4 4 5-7 5 7 4-4-2 11H5Z'],
	alert: ['M12 3 2 20h20Z', 'M12 10v4M12 17v.5'],
	check: ['M4 12.5 9 17.5 20 6.5'],
	retry: ['M20 11a8 8 0 1 0-2.3 5.7', 'M20 5v6h-6'],
	plus: ['M12 5v14M5 12h14'],
	dice: ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z', 'M8.5 8.5h.01M15.5 15.5h.01M12 12h.01M15.5 8.5h.01M8.5 15.5h.01'],
	info: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', 'M12 11v6M12 7.5v.5'],
	close: ['M6 6l12 12M18 6 6 18'],
	code: ['M8 7 3 12l5 5M16 7l5 5-5 5M14 4l-4 16'],
	// Resources
	lumber: ['M12 3 6 12h3l-4 6h14l-4-6h3Z', 'M12 18v3'],
	brick: ['M3 7h18v10H3Z', 'M3 12h18M9 7v5M15 12v5'],
	wool: ['M7 16a3 3 0 0 1-.5-6A4 4 0 0 1 14 8.5 3.5 3.5 0 0 1 18 15a2.5 2.5 0 0 1-1 1Z', 'M8 16v3M16 16v3'],
	grain: ['M12 21V8', 'M12 8c-2-1-3-3-3-5 2 0 3 2 3 5ZM12 8c2-1 3-3 3-5-2 0-3 2-3 5Z', 'M12 13c-2-1-4-2-4-5 2 0 4 2 4 5ZM12 13c2-1 4-2 4-5-2 0-4 2-4 5Z'],
	ore: ['M4 18 8 9l5-3 6 4 1 8Z', 'M8 9l3 4 2-7M11 13l9 5'],
} as const;

export type IconName = keyof typeof ICONS;

/** Builds an icon for scripts that create DOM. Decorative unless given a label. */
export function iconElement(name: IconName, label?: string): SVGSVGElement {
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('class', `icon icon--${name}`);
	if (label) {
		svg.setAttribute('role', 'img');
		svg.setAttribute('aria-label', label);
	} else {
		svg.setAttribute('aria-hidden', 'true');
	}
	for (const d of ICONS[name]) {
		const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
		path.setAttribute('d', d);
		svg.append(path);
	}
	return svg;
}
