import { createRequire } from 'node:module';
import { sentrySvelteKit } from '@sentry/sveltekit/vite';
import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { FileSystemIconLoader } from 'unplugin-icons/loaders';
import Icons from 'unplugin-icons/vite';
import { defineConfig, loadEnv } from 'vite';

function shareDevRegistryWithBackend() {
	const wranglerEntry = createRequire(import.meta.url).resolve('wrangler');
	const miniflare = createRequire(wranglerEntry)('miniflare') as {
		getDefaultDevRegistryPath: () => string;
	};
	process.env.CLOUDFLARE_DEV_REGISTRY_PATH = miniflare.getDefaultDevRegistryPath();
}

export default defineConfig(({ command, mode }) => {
	const env = loadEnv(mode, process.cwd(), '');
	if (command === 'serve') {
		shareDevRegistryWithBackend();
	}

	return {
		server: {
			host: 'localhost'
		},
		plugins: [
			tailwindcss(),
			sentrySvelteKit({
				autoUploadSourceMaps: Boolean(env.SENTRY_AUTH_TOKEN),
				org: env.SENTRY_ORG,
				project: env.SENTRY_PROJECT,
				authToken: env.SENTRY_AUTH_TOKEN,
				// Bundles CJS deps like `pg` into the SSR output, which crashes under workerd
				// We should open an issue for this
				buildTimeInstrumentation: false
			}),

			sveltekit({
				compilerOptions: { experimental: { async: true } },
				adapter: adapter({ platformProxy: { configPath: 'wrangler.local.jsonc' } }),
				experimental: { remoteFunctions: true },
				tracing: { server: true }
			}),

			Icons({
				compiler: 'svelte',
				customCollections: {
					nucleo: FileSystemIconLoader('./src/lib/icons')
				},
				transform(svg, collection) {
					return collection === 'lucide'
						? svg.replace(/stroke-width="2"/g, 'stroke-width="1.5"')
						: svg;
				}
			})
		],
		ssr: {
			external: ['postcss']
		}
	};
});
