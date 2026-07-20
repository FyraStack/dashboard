import AxeBuilder from '@axe-core/playwright';
import { test as base } from '@playwright/test';

type AxeFixture = {
	makeAxeBuilder: () => AxeBuilder;
};

export const localURL = 'http://127.0.0.1:4173';

export const activeBrand =
	process.env['PUBLIC_DASHBOARD_BRAND']?.toLowerCase() === 'ultramarine' ? 'ultramarine' : 'stack';

export const pages = [
	{ label: 'login', path: '/login' },
	{ label: 'login verified state', path: '/login?verified=1' },
	{ label: 'register', path: '/register' },
	{ label: 'signup redirect', path: '/signup' },
	{ label: 'project dashboard', path: '/' },
	{ label: 'server list', path: '/projects/accessibility-project/servers' },
	{ label: 'server detail', path: '/projects/accessibility-project/servers/accessibility-server' },
	{ label: 'host overview', path: '/projects/accessibility-project/hosts' },
	{ label: 'host registration', path: '/projects/accessibility-project/hosts/create' },
	{ label: 'host detail', path: '/projects/accessibility-project/hosts/accessibility-host' },
	{ label: 'host podman', path: '/projects/accessibility-project/hosts/accessibility-host/podman' },
	{
		label: 'host podman container',
		path: '/projects/accessibility-project/hosts/accessibility-host/podman/demo-web'
	},
	{ label: 'host quadlets', path: '/projects/accessibility-project/hosts/accessibility-host/quadlets' },
	{
		label: 'host quadlet detail',
		path: '/projects/accessibility-project/hosts/accessibility-host/quadlets/demo-web.container'
	},
	{
		label: 'host quadlet create',
		path: '/projects/accessibility-project/hosts/accessibility-host/quadlets/create'
	},
	{ label: 'project settings', path: '/projects/accessibility-project/settings' }
];

export const test = base.extend<AxeFixture>({
	makeAxeBuilder: async ({ page }, use) => {
		const makeAxeBuilder = () =>
			new AxeBuilder({ page }).withTags([
				'wcag2a',
				'wcag21a',
				'wcag2aa',
				'wcag21aa',
				'wcag22aa',
				'best-practice'
			]);

		await use(makeAxeBuilder);
	}
});

export { expect } from '@playwright/test';
