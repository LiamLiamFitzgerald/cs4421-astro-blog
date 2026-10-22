/**
 * Shared feedback for both modes of /catan: screen-reader announcements and
 * the unexpected-failure notice with Try again. One implementation, so both
 * modes report and recover from errors the same way (ADR-006, ADR-007).
 */
import { describeFailure } from '../lib/app/scoreboard';
import { iconElement } from './icons';

/** Called with every failure the rules did not expect. */
export type FailureReporter = (error: unknown, context: string) => void;

export interface Feedback {
	announce(text: string): void;
	/** Shows a failure with a retry, and reports it. */
	fail(error: unknown, context: string, retry: () => Promise<void>): void;
	clearFailure(): void;
}

export function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className?: string,
	text?: string,
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

export function required<T extends Element>(selector: string): T {
	const node = document.querySelector<T>(selector);
	if (!node) throw new Error(`Page markup is missing ${selector}`);
	return node;
}

export function createFeedback(announcer: HTMLElement, failure: HTMLElement, report: FailureReporter): Feedback {
	return {
		announce(text) {
			// Clear first so repeating the same message is still read out.
			announcer.textContent = '';
			requestAnimationFrame(() => (announcer.textContent = text));
		},
		fail(error, context, retry) {
			report(error, context);
			const message = describeFailure(error);
			const body = el('div', 'notice__body');
			body.append(el('p', 'notice__title', message.title), el('p', undefined, message.advice));
			const details = el('details', 'failure__details');
			details.append(el('summary', undefined, 'Technical details'), el('code', undefined, message.detail));
			const button = el('button', 'button button--small');
			button.type = 'button';
			button.append(iconElement('retry'), document.createTextNode('Try again'));
			button.addEventListener('click', () => {
				failure.hidden = true;
				void retry();
			});
			body.append(details, button);
			failure.replaceChildren(iconElement('alert'), body);
			failure.hidden = false;
			button.focus();
		},
		clearFailure() {
			failure.hidden = true;
		},
	};
}
