import adapter from '@sveltejs/adapter-cloudflare';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		experimental: {
			async: true
		}
	},
	kit: {
		adapter: adapter({
			platformProxy: {
				configPath: 'wrangler.local.jsonc'
			}
		}),
		experimental: {
			remoteFunctions: true
		}
	}
};

export default config;
