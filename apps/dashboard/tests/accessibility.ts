import AxeBuilder from '@axe-core/playwright';
import { test as base } from '@playwright/test';

type AxeFixture = {
	makeAxeBuilder: () => AxeBuilder;
};

export const localURL = 'http://127.0.0.1:4173';

export const pages = [
	{ label: 'login', path: '/login' },
	{ label: 'login verified state', path: '/login?verified=1' },
	{ label: 'register', path: '/register' },
	{ label: 'signup redirect', path: '/signup' },
	{ label: 'project dashboard', path: '/' },
	{ label: 'server list', path: '/projects/accessibility-project/servers' },
	{ label: 'server detail', path: '/projects/accessibility-project/servers/accessibility-server' },
	{ label: 'project settings', path: '/projects/accessibility-project/settings' },
	{ label: 'project billing', path: '/projects/accessibility-project/billing' },
	{ label: 'admin users', path: '/admin/users' },
	{ label: 'admin projects', path: '/admin/projects' },
	{ label: 'admin vms', path: '/admin/vms' },
	{ label: 'admin vm types', path: '/admin/vm-types' },
	{ label: 'admin images', path: '/admin/images' },
	{ label: 'admin ipam', path: '/admin/ipam' },
	{ label: 'admin emails', path: '/admin/emails' },
	{ label: 'admin features', path: '/admin/features' }
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
