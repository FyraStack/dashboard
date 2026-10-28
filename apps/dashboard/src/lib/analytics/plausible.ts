import { browser } from '$app/env';

type PlausibleTracker = typeof import('@plausible-analytics/tracker');

let tracker: Promise<PlausibleTracker> | undefined;

export function initPlausible() {
	if (!browser) {
		return;
	}
	tracker ??= import('@plausible-analytics/tracker').then((plausible) => {
		plausible.init({
			domain: 'dash.fyrastack.com',
			endpoint: 'https://plausible.fyralabs.com/api/event',
			outboundLinks: true
		});
		return plausible;
	});
	return tracker;
}

export async function trackNotFound(url: string) {
	const plausible = await initPlausible();
	plausible?.track('404', { url });
}
