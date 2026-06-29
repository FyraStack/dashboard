import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), '');
	const hyperdriveLocalConnectionString =
		env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE;

	if (
		hyperdriveLocalConnectionString &&
		!process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE
	) {
		process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE =
			hyperdriveLocalConnectionString;
	}

	return {
		plugins: [tailwindcss(), sveltekit()],
		build: {
			rollupOptions: {
				external: ['cloudflare:workers']
			}
		}
	};
});
