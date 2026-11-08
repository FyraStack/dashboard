import { cloudflare } from '@cloudflare/vite-plugin';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig, loadEnv } from 'vite';

function exposeHyperdriveLocalConnectionString(mode: string) {
	const name = 'CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE';
	const connectionString = loadEnv(mode, process.cwd(), '')[name];
	if (connectionString && !process.env[name]) {
		process.env[name] = connectionString;
	}
}

export default defineConfig(({ command, mode }) => {
	exposeHyperdriveLocalConnectionString(mode);

	return {
		server: { host: '127.0.0.1', port: 5174, strictPort: true },
		plugins: [
			svelte(),
			cloudflare({ configPath: command === 'serve' ? 'wrangler.local.jsonc' : 'wrangler.jsonc' })
		]
	};
});
