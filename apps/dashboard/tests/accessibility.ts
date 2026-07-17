import AxeBuilder from '@axe-core/playwright';
import { test as base } from '@playwright/test';

type AxeFixture = {
	makeAxeBuilder: () => AxeBuilder;
};

export const localURL = 'http://127.0.0.1:4173';

export const publicPages = [
	{ label: 'login', path: '/login' },
	{ label: 'login verified state', path: '/login?verified=1' },
	{ label: 'register', path: '/register' },
	{ label: 'signup redirect', path: '/signup' }
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
