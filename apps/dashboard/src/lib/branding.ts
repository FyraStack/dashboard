export type DashboardBrandId = 'stack' | 'ultramarine';

const requestedBrand = import.meta.env.PUBLIC_DASHBOARD_BRAND?.toLowerCase();
export const dashboardBrandId: DashboardBrandId =
	requestedBrand === 'ultramarine' ? 'ultramarine' : 'stack';

export const dashboardBrand = {
	id: dashboardBrandId,
	name: dashboardBrandId === 'ultramarine' ? 'Ultramarine' : 'Stack',
	title: dashboardBrandId === 'ultramarine' ? 'Ultramarine Server' : 'Stack',
	logo: dashboardBrandId === 'ultramarine' ? '/ultramarine-logo.svg' : '/logo.svg',
	favicon: dashboardBrandId === 'ultramarine' ? '/ultramarine-favicon.ico' : '/favicon.ico',
	favicon16:
		dashboardBrandId === 'ultramarine' ? '/ultramarine-favicon-16x16.png' : '/favicon-16x16.png',
	favicon32:
		dashboardBrandId === 'ultramarine' ? '/ultramarine-favicon-32x32.png' : '/favicon-32x32.png',
	appleTouchIcon:
		dashboardBrandId === 'ultramarine'
			? '/ultramarine-apple-touch-icon.png'
			: '/apple-touch-icon.png',
	isStandalone: dashboardBrandId === 'ultramarine',
	defaultProjectPath: dashboardBrandId === 'ultramarine' ? 'hosts' : 'servers',
	plausibleDomain: dashboardBrandId === 'ultramarine' ? null : 'dash.fyrastack.com'
} as const;

export function pageTitle(title: string) {
	return `${title} / ${dashboardBrand.title}`;
}
