export type PostHogRegion = 'us' | 'eu';

export function posthogRegion(host: string | undefined): PostHogRegion {
	return host?.includes('eu.') ? 'eu' : 'us';
}
