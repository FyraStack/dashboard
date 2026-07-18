import { command, getRequestEvent, query } from '$app/server';
import { error } from '@sveltejs/kit';
import { type } from 'arktype';
import { and, desc, eq } from 'drizzle-orm';
import { requireProjectAccess } from '$lib/server/auth-context';
import { initDrizzle } from '$lib/server/db';
import { managedHosts } from '$lib/server/db/schema';
import { createTetraClient, type AgentResponse } from '$lib/server/tetra/client';

export type ManagedHost = {
	id: string;
	displayName: string;
	ownerProjectId: string;
	hostKind: 'stack_vps' | 'external' | 'local';
	linkedVmId: string | null;
	connectionMode: 'direct_http' | 'websocket' | 'vsock_gateway' | 'offline';
	connectionState: 'online' | 'offline' | 'unknown';
	agentUrl: string | null;
	lastSeenAt: number | null;
	agentVersion: string | null;
	hostname: string | null;
	os: string | null;
	arch: string | null;
	capabilities: Record<string, unknown> | null;
	lastError: string | null;
	createdAt: number;
	updatedAt: number;
};

function requireUser() {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');
	return event.locals.user;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mapHost(row: typeof managedHosts.$inferSelect): ManagedHost {
	return {
		id: row.id,
		displayName: row.displayName,
		ownerProjectId: row.ownerProjectId,
		hostKind: row.hostKind,
		linkedVmId: row.linkedVmId,
		connectionMode: row.connectionMode,
		connectionState: row.connectionState,
		agentUrl: row.agentUrl,
		lastSeenAt: row.lastSeenAt,
		agentVersion: row.agentVersion,
		hostname: row.hostname,
		os: row.os,
		arch: row.arch,
		capabilities: row.capabilities,
		lastError: row.lastError,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt
	};
}

async function loadManagedHost(hostId: string) {
	const user = requireUser();
	const db = initDrizzle();
	const host = await db.query.managedHosts.findFirst({
		where: eq(managedHosts.id, hostId)
	});

	if (!host) error(404, 'Managed host not found');

	await requireProjectAccess(db, user.id, host.ownerProjectId);
	return { db, host };
}

async function refreshHostCapabilities(host: typeof managedHosts.$inferSelect) {
	const client = createTetraClient({
		connectionMode: host.connectionMode,
		agentUrl: host.agentUrl,
		bearerToken: host.bearerToken
	});

	await client.health();
	const capabilities = await client.capabilities();
	let system: AgentResponse | null = null;

	try {
		system = await client.dispatch({
			module: 'settings',
			action: 'get_system',
			payload: {}
		});
	} catch {
		system = null;
	}

	return {
		capabilities: isRecord(capabilities.payload) ? capabilities.payload : null,
		system: isRecord(system?.payload) ? system.payload : null
	};
}

const listParams = type({ projectId: 'string' });
export const listManagedHosts = query(listParams, async (params): Promise<ManagedHost[]> => {
	const user = requireUser();
	const db = initDrizzle();
	await requireProjectAccess(db, user.id, params.projectId);

	const rows = await db.query.managedHosts.findMany({
		where: eq(managedHosts.ownerProjectId, params.projectId),
		orderBy: [desc(managedHosts.createdAt)]
	});

	return rows.map(mapHost);
});

const getParams = type({ hostId: 'string' });
export const getManagedHost = query(getParams, async (params): Promise<ManagedHost> => {
	const { host } = await loadManagedHost(params.hostId);
	return mapHost(host);
});

const createParams = type({
	projectId: 'string',
	displayName: 'string',
	agentUrl: 'string',
	bearerToken: 'string?',
	linkedVmId: 'string?'
});
export const createManagedHost = command(createParams, async (params): Promise<ManagedHost> => {
	const user = requireUser();
	const db = initDrizzle();
	await requireProjectAccess(db, user.id, params.projectId, 'admin');

	const displayName = params.displayName.trim();
	if (!displayName) error(400, 'Display name is required');

	let agentUrl: string;
	try {
		agentUrl = new URL(params.agentUrl).toString().replace(/\/+$/, '');
	} catch {
		error(400, 'Agent URL must be a valid URL');
	}

	const [host] = await db
		.insert(managedHosts)
		.values({
			displayName,
			ownerProjectId: params.projectId,
			hostKind: params.linkedVmId ? 'stack_vps' : 'external',
			linkedVmId: params.linkedVmId ?? null,
			connectionMode: 'direct_http',
			connectionState: 'unknown',
			agentUrl,
			bearerToken: params.bearerToken?.trim() || null
		})
		.returning();

	return mapHost(host);
});

export const refreshManagedHostCapabilities = command(
	getParams,
	async (params): Promise<ManagedHost> => {
		const { db, host } = await loadManagedHost(params.hostId);

		try {
			const result = await refreshHostCapabilities(host);
			const now = Date.now();
			const [updated] = await db
				.update(managedHosts)
				.set({
					connectionState: 'online',
					lastSeenAt: now,
					capabilities: result.capabilities,
					os: typeof result.system?.os === 'string' ? result.system.os : host.os,
					arch: typeof result.system?.arch === 'string' ? result.system.arch : host.arch,
					lastError: null,
					updatedAt: now
				})
				.where(eq(managedHosts.id, host.id))
				.returning();

			return mapHost(updated);
		} catch (err) {
			const now = Date.now();
			const [updated] = await db
				.update(managedHosts)
				.set({
					connectionState: 'offline',
					lastError: err instanceof Error ? err.message : 'Failed to refresh host capabilities',
					updatedAt: now
				})
				.where(eq(managedHosts.id, host.id))
				.returning();

			return mapHost(updated);
		}
	}
);

const dispatchParams = type({
	hostId: 'string',
	module: 'string',
	action: 'string',
	payloadJson: 'string'
});
export const dispatchManagedHostCommand = command(dispatchParams, async (params) => {
	const user = requireUser();
	const { db, host } = await loadManagedHost(params.hostId);
	await requireProjectAccess(db, user.id, host.ownerProjectId, 'admin');

	let payload: Record<string, unknown>;
	try {
		const parsed = JSON.parse(params.payloadJson);
		payload = isRecord(parsed) ? parsed : {};
	} catch {
		error(400, 'Payload must be valid JSON');
	}

	const client = createTetraClient({
		connectionMode: host.connectionMode,
		agentUrl: host.agentUrl,
		bearerToken: host.bearerToken
	});
	const response = await client.dispatch({
		module: params.module.trim(),
		action: params.action.trim(),
		payload
	});

	await db
		.update(managedHosts)
		.set({
			connectionState: 'online',
			lastSeenAt: Date.now(),
			lastError: response.ok ? null : response.error || null,
			updatedAt: Date.now()
		})
		.where(and(eq(managedHosts.id, host.id), eq(managedHosts.ownerProjectId, host.ownerProjectId)));

	return response;
});
