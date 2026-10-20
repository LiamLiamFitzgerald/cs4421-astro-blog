/**
 * Sends unexpected browser errors to /api/client-errors so they reach the
 * server's JSON log. Reporting must never break the page, so every failure
 * here is caught; the error is always written to the console as well.
 */

const MAX_REPORTS_PER_PAGE = 10;
let sent = 0;

export function reportError(error: unknown, context: string): void {
	console.error(`[${context}]`, error);
	if (sent >= MAX_REPORTS_PER_PAGE) return;
	sent += 1;
	const body = JSON.stringify({
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
