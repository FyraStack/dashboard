import { defineConfig, devices } from '@playwright/test';

const isCI = Boolean(process.env.CI);
const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

export default defineConfig({
	forbidOnly: isCI,
	fullyParallel: true,
	projects: [
		{
			name: 'Chromium',
			use: {
				...devices['Desktop Chrome'],
				launchOptions: { executablePath: chromiumExecutable },
				headless: true
			}
		},
		{
			name: 'Mobile Chrome',
			use: {
				...devices['Pixel 5'],
				launchOptions: { executablePath: chromiumExecutable },
				headless: true
			}
		}
	],
	reporter: 'list',
	testDir: './tests',
	testMatch: /.*\.test\.ts/,
	// The timeout for the accessibility tests only.
	timeout: 180 * 1_000,
	webServer: [
		{
			command:
				'pnpm run build && ACCESSIBILITY_FIXTURES=1 CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgres://postgres:postgres@127.0.0.1:5432/postgres pnpm exec vite preview --host 127.0.0.1 --port 4173',
			reuseExistingServer: !isCI,
			// The timeout of the build and preview startup before the accessibility tests.
			timeout: 120 * 1_000,
			url: 'http://127.0.0.1:4173/login'
		}
	]
});
