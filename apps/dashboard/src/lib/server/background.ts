import { waitUntil } from 'cloudflare:workers';
import { getRequestEvent } from '$app/server';
import { instrument } from '#lib/server/observability.js';

export function runInBackground(work: Promise<unknown>, label?: string) {
	const event = getRequestEvent();
	const guarded = instrument('background.waitUntil', () => work, {
		'background.label': label
	}).catch((error) => {
		console.error(`Background task${label ? ` (${label})` : ''} failed`, error);
	});

	event.locals.backgroundTasks ??= [];
	event.locals.backgroundTasks.push(guarded);
	waitUntil(guarded);
}
