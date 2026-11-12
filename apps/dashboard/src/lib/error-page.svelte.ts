import { trackNotFound } from '#lib/analytics/plausible.js';
import { page } from '$app/state';

export function useErrorPage() {
	const isNotFound = $derived(page.status === 404);
	const isServerError = $derived(page.status >= 500);

	$effect(() => {
		if (isNotFound) {
			trackNotFound(page.url.href);
		}
	});

	const heading = $derived.by(() => {
		if (isNotFound) {
			return 'Page not found';
		}
		return isServerError ? 'Something went wrong' : 'Error';
	});

	const detail = $derived.by(() => {
		if (isNotFound) {
			return "We couldn't find the page you're looking for.";
		}
		if (isServerError) {
			return 'Something went wrong on our end. Please try again in a moment.';
		}
		return page.error?.message ?? 'Something went wrong';
	});

	return {
		get status() {
			return page.status;
		},
		get isNotFound() {
			return isNotFound;
		},
		get heading() {
			return heading;
		},
		get detail() {
			return detail;
		}
	};
}
