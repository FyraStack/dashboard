import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';
import Icons from 'unplugin-icons/vite';
import { FileSystemIconLoader } from 'unplugin-icons/loaders';

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
		plugins: [
			tailwindcss(),
			sveltekit(),
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
		},
		build: {
			rollupOptions: {
				external: ['cloudflare:workers']
			}
		}
	};
});
