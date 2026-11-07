import type { IncomingMessage } from 'node:http';
import { cloudflare } from '@cloudflare/vite-plugin';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { Agent, fetch as undiciFetch } from 'undici';
import { defineConfig, loadEnv, type Plugin } from 'vite';

const host = '127.0.0.1';
const port = 5174;
const insecureFetchPath = '/__dev/insecure-fetch';
const hopByHopHeaders = [
	'host',
	'connection',
	'content-length',
	'transfer-encoding',
	'x-target-url'
];
const decodedResponseHeaders = ['content-encoding', 'content-length', 'transfer-encoding'];

async function readBody(req: IncomingMessage) {
	const chunks: Buffer[] = [];
	for await (const chunk of req) {
		chunks.push(chunk as Buffer);
	}
	return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

function insecureFetchProxy(): Plugin {
	const agent = new Agent({ connect: { rejectUnauthorized: false } });
	return {
		name: 'insecure-fetch-proxy',
		apply: 'serve',
		configureServer(server) {
			server.middlewares.use(insecureFetchPath, async (req, res) => {
				const target = req.headers['x-target-url'];
				if (typeof target !== 'string') {
					res.statusCode = 400;
					res.end('Missing x-target-url');
					return;
				}
				const headers = Object.entries(req.headers).flatMap(([name, value]) =>
					hopByHopHeaders.includes(name) || value === undefined
						? []
						: [[name, Array.isArray(value) ? value.join(', ') : value] as [string, string]]
				);
				try {
					const upstream = await undiciFetch(target, {
						method: req.method,
						headers,
						body: await readBody(req),
						dispatcher: agent
					});
					res.statusCode = upstream.status;
					for (const [name, value] of upstream.headers) {
						if (!decodedResponseHeaders.includes(name)) {
							res.setHeader(name, value);
						}
					}
					res.end(Buffer.from(await upstream.arrayBuffer()));
				} catch (cause) {
					res.statusCode = 502;
					res.end(cause instanceof Error ? cause.message : String(cause));
				}
			});
		}
	};
}

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
		server: { host, port, strictPort: true },
		define: {
			__INSECURE_FETCH_URL__: JSON.stringify(`http://${host}:${port}${insecureFetchPath}`)
		},
		plugins: [
			insecureFetchProxy(),
			svelte(),
			cloudflare({ configPath: command === 'serve' ? 'wrangler.local.jsonc' : 'wrangler.jsonc' })
		]
	};
});
