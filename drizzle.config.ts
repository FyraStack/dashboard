import { defineConfig } from 'drizzle-kit';

const raw =
	process.env.DATABASE_URL || process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE;

// node-postgres can't handle sslrootcert=system (a libpq-only feature) —
// it tries to open a file literally named "system".  Strip it; sslmode
// alone is enough for pg to enable TLS with the system CA bundle.
function sanitize(connStr: string): string {
	const u = new URL(connStr);
	u.searchParams.delete('sslrootcert');
	return u.toString();
}

const url = raw ? sanitize(raw) : undefined;

export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	dialect: 'postgresql',
	...(url && { dbCredentials: { url } }),
	verbose: true,
	strict: true
});
