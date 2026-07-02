import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { RequestEvent } from '@sveltejs/kit';
import { dev } from '$app/environment';
import * as schema from './schema';
import { getRequestEvent } from '$app/server';
import { getRuntimeEnv } from '$lib/server/env';
import { instrument, summarizeStatement, timingLog } from '$lib/server/observability';

export type Database = ReturnType<typeof drizzle<typeof schema>>;

let devPool: Pool | null = null;
let devDb: Database | null = null;

function createPool(connectionString: string) {
	const started = performance.now();
	const url = new URL(connectionString);
	const useSystemSsl = url.searchParams.get('sslrootcert') === 'system';
	url.searchParams.delete('sslrootcert');

	timingLog('db.createPool.start', {
		'db.connection_source': connectionString.includes('hyperdrive') ? 'hyperdrive' : 'direct',
		'db.ssl_system': useSystemSsl
	});

	const pool = new Pool({
		connectionString: url.toString(),
		max: 5,
		...(useSystemSsl ? { ssl: { rejectUnauthorized: true } } : {})
	});
	pool.on('error', (error) => {
		console.error('Unexpected error on idle PostgreSQL client', error);
	});

	timingLog('db.createPool.end', {
		duration_ms: Math.round((performance.now() - started) * 100) / 100
	});

	return withQueryTracing(pool);
}

function withQueryTracing(pool: Pool): Pool {
	const runQuery = pool.query.bind(pool) as (...args: unknown[]) => unknown;

	pool.query = function instrumentedQuery(...args: unknown[]) {
		if (typeof args[args.length - 1] === 'function') return runQuery(...args);

		const first = args[0];
		const statement =
			typeof first === 'string' ? first : (first as { text?: string } | undefined)?.text;

		return instrument('db.query', () => runQuery(...args) as Promise<unknown>, {
			'db.statement': summarizeStatement(statement)
		});
	} as typeof pool.query;

	return pool;
}

function resolveConnectionString() {
	const { DATABASE_URL, HYPERDRIVE } = getRuntimeEnv();
	const connectionString = HYPERDRIVE?.connectionString ?? DATABASE_URL;

	if (!connectionString) {
		throw new Error(
			'No database connection string is available. Configure the HYPERDRIVE binding for Workers or DATABASE_URL for local non-Wrangler development.'
		);
	}

	return connectionString;
}

export function initDrizzle(): Database {
	const started = performance.now();
	const event = getRequestEvent();

	if (event.locals.db) {
		timingLog('db.initDrizzle.reuse', {
			duration_ms: Math.round((performance.now() - started) * 100) / 100
		});
		return event.locals.db;
	}

	timingLog('db.initDrizzle.start', { 'app.dev': dev });

	if (dev) {
		devDb ??= drizzle((devPool ??= createPool(resolveConnectionString())), { schema });
		event.locals.db = devDb;
		timingLog('db.initDrizzle.end', {
			'app.dev': dev,
			duration_ms: Math.round((performance.now() - started) * 100) / 100
		});
		return devDb;
	}

	const pool = createPool(resolveConnectionString());
	const db = drizzle(pool, { schema });
	event.locals.dbPool = pool;
	event.locals.db = db;

	timingLog('db.initDrizzle.end', {
		'app.dev': dev,
		duration_ms: Math.round((performance.now() - started) * 100) / 100
	});

	return db;
}

export function closeRequestDb(event: RequestEvent) {
	const pool = event.locals.dbPool;
	if (!pool) {
		timingLog('db.closeRequestDb.skip');
		return;
	}

	event.locals.dbPool = undefined;
	event.locals.db = undefined;

	timingLog('db.closeRequestDb.waitUntil.start');
	const backgroundTasks = event.locals.backgroundTasks ?? [];
	event.locals.backgroundTasks = undefined;
	const ending = Promise.allSettled(backgroundTasks)
		.then(() => instrument('db.pool.end', () => pool.end()))
		.catch((error) => {
			console.error('Error closing PostgreSQL pool', error);
		});

	const ctx = event.platform?.ctx;
	if (ctx) {
		ctx.waitUntil(ending);
		timingLog('db.closeRequestDb.waitUntil.scheduled');
	}
}
