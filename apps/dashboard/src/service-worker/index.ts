// Copied from https://svelte.dev/docs/kit/service-workers with slight modifications

import { version } from '$app/env';
import { assets, immutable } from '$app/manifest';
import { resolve } from '$app/paths';
import { self } from '$app/service-worker';

const CACHE = `cache-${version}`;

// `immutable`/`assets` paths from `$app/manifest` are relative to the
// base path, so resolve them to absolute pathnames that can be matched
// against `url.pathname` in the `fetch` handler
const ASSETS = [
	...immutable.map((asset) => resolve(asset.path)),
	...assets.map((asset) => resolve(asset.path))
];

self.addEventListener('install', (event) => {
	async function addFilesToCache() {
		const cache = await caches.open(CACHE);
		await cache.addAll(ASSETS);
	}

	event.waitUntil(addFilesToCache());
});

self.addEventListener('activate', (event) => {
	async function deleteOldCaches() {
		await Promise.all(
			(await caches.keys())
				.filter((key) => key !== CACHE)
				.map(async (key) => await caches.delete(key))
		);
	}

	event.waitUntil(deleteOldCaches());
});

self.addEventListener('fetch', (event) => {
	if (event.request.method !== 'GET') {
		return;
	}

	async function respond() {
		const url = new URL(event.request.url);
		const cache = await caches.open(CACHE);

		if (ASSETS.includes(url.pathname)) {
			const response = await cache.match(url.pathname);

			if (response) {
				return response;
			}
		}

		try {
			const response = await fetch(event.request);

			if (response.status === 200 && !response.headers.get('cache-control')?.includes('no-store')) {
				cache.put(event.request, response.clone());
			}

			return response;
		} catch (error) {
			const response = await cache.match(event.request);

			if (response) {
				return response;
			}

			throw error;
		}
	}

	event.respondWith(respond());
});
