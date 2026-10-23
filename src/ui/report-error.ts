/**
 * Sends unexpected browser errors to /api/client-errors so they reach the
 * server's JSON log. Reporting must never break the page, so every failure
 * here is caught; the error is always written to the console as well.
 */

import { buildGameContext, type GameContext } from '../lib/observability/client-error';
import { PLAY_LOG_VERSION } from '../lib/games/catan-play/integrity';

const MAX_REPORTS_PER_PAGE = 10;
let sent = 0;

/** What the page is playing right now, so errors can carry the game (ADR-014). */
export type GameSource = () => { gameId: string; events: readonly unknown[] } | null;

let currentGame: GameSource = () => null;

/** The play screen registers where to find the game being played. */
export function setGameSource(source: GameSource): void {
	currentGame = source;
}

/**
 * Reports an error. The game being played is attached unless `game` is given,
 * which a caller uses when the interesting log is not the current one (a save
 * that was cut back).
 */
export function reportError(error: unknown, context: string, game?: GameContext): void {
	console.error(`[${context}]`, error);
	// The static site (ADR-018) has no server to receive reports; the console entry stays.
	if (import.meta.env.PUBLIC_STATIC_SITE === true) return;
	if (sent >= MAX_REPORTS_PER_PAGE) return;
	sent += 1;
	let attached = game;
	if (!attached) {
		try {
			const current = currentGame();
			if (current) attached = buildGameContext(current.gameId, PLAY_LOG_VERSION, current.events);
		} catch {
			// Never let finding the game break reporting.
		}
	}
	const body = JSON.stringify({
		...(attached ? { game: attached } : {}),
		context: context.slice(0, 100),
		name: (error instanceof Error ? error.name : typeof error).slice(0, 100) || 'Error',
		message: (error instanceof Error ? error.message : String(error)).slice(0, 500) || 'No message',
		page: location.pathname.slice(0, 200),
	});
	try {
		void fetch('/api/client-errors', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body,
			keepalive: true,
		}).catch(() => undefined);
	} catch {
		// The network or fetch itself is unavailable; the console entry above remains.
	}
}

/** Catches errors nothing else handled, on every page. */
export function reportUncaughtErrors(): void {
	window.addEventListener('error', (event) => reportError(event.error ?? event.message, 'window.error'));
	window.addEventListener('unhandledrejection', (event) => reportError(event.reason, 'unhandledrejection'));
}
