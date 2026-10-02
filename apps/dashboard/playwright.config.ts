import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env['CI'];

export default defineConfig({
	forbidOnly: isCI,
	fullyParallel: true,
	projects: [
		{
			name: 'Chrome',
			use: {
				...devices['Desktop Chrome'],
				channel: isCI ? 'chrome' : undefined,
				headless: true
			}
		},
		{
			name: 'Mobile Chrome',
			use: {
				...devices['Pixel 5'],
				channel: isCI ? 'chrome' : undefined,
				headless: true
			}
		}
	],
	reporter: 'list',
	testDir: './tests',
	testMatch: /.*\.test\.ts/,
	// The timeout for the accessibility tests only.
	timeout: 180 * 1000,
	webServer: [
		{
			command:
				'pnpm run build && CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgres://postgres:postgres@127.0.0.1:5432/postgres pnpm exec wrangler dev -c wrangler.local.jsonc --local-protocol http --ip 127.0.0.1 --port 4173 --var ACCESSIBILITY_FIXTURES:1',
			reuseExistingServer: !isCI,
			// The timeout of the build and preview startup before the accessibility tests.
			timeout: 120 * 1000,
			url: 'http://127.0.0.1:4173/login'
		}
	]
});
