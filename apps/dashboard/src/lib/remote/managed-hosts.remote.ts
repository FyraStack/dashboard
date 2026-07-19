import { command, getRequestEvent, query } from '$app/server';
import { error } from '@sveltejs/kit';
import { type } from 'arktype';
import { and, desc, eq } from 'drizzle-orm';
import { requireProjectAccess } from '$lib/server/auth-context';
import { initDrizzle } from '$lib/server/db';
import { managedHosts } from '$lib/server/db/schema';
import { createTetraClient, type AgentResponse } from '$lib/server/tetra/client';
import {
	accessibilityFixtureEnabled,
	accessibilityFixtureManagedHosts
} from '$lib/server/accessibility-fixtures';

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

export type ManagedHostPodmanResource = 'containers' | 'images' | 'volumes' | 'networks';

export type ManagedHostPodmanResult = {
	command: string | null;
	data: unknown[];
	stdout: string;
	stderr: string;
};

function requireUser() {
	const event = getRequestEvent();
	if (!event?.locals.user) error(401, 'Authentication required');
	return event.locals.user;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getStringField(value: Record<string, unknown> | null | undefined, keys: string[]) {
	for (const key of keys) {
		const field = value?.[key];
		if (typeof field === 'string' && field.trim()) return field.trim();
	}

	return null;
}

function getSystemOs(system: Record<string, unknown> | null | undefined, fallback: string | null) {
	return (
		getStringField(system, ['pretty_name', 'prettyName', 'distro', 'distribution', 'os_name', 'osName']) ??
		getStringField(system, ['id', 'os']) ??
		fallback
	);
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

function mapPodmanResponse(response: AgentResponse): ManagedHostPodmanResult {
	if (!response.ok) {
		throw new Error(response.error || 'Podman command failed');
	}

	const payload = isRecord(response.payload) ? response.payload : {};
	const data = Array.isArray(payload.data) ? payload.data : [];

	return {
		command: typeof payload.command === 'string' ? payload.command : null,
		data,
		stdout: typeof payload.stdout === 'string' ? payload.stdout : '',
		stderr: typeof payload.stderr === 'string' ? payload.stderr : ''
	};
}

function fixturePodmanResult(resource: ManagedHostPodmanResource): ManagedHostPodmanResult {
	const fixtures: Record<ManagedHostPodmanResource, unknown[]> = {
		containers: [
			{
				Id: '8f9a1d2c3b4a',
				Names: ['demo-web'],
				Image: 'ghcr.io/example/demo-web:latest',
				State: 'running',
				Status: 'Up 2 hours'
			},
			{
				Id: '1a2b3c4d5e6f',
				Names: ['demo-worker'],
				Image: 'ghcr.io/example/demo-worker:latest',
				State: 'exited',
				Status: 'Exited 0 yesterday'
			}
		],
		images: [
			{
				Id: 'sha256:111122223333',
				Repository: 'ghcr.io/example/demo-web',
				Tag: 'latest',
				Size: '182 MB'
			}
		],
		volumes: [
			{
				Name: 'demo-data',
				Driver: 'local',
				Mountpoint: '/var/lib/containers/storage/volumes/demo-data/_data'
			}
		],
		networks: [
			{
				Name: 'podman',
				Driver: 'bridge',
				NetworkInterface: 'podman0'
			}
		]
	};

	return {
		command: `podman ${resource}`,
		data: fixtures[resource],
		stdout: '',
		stderr: ''
	};
}

async function dispatchHostCommand(
	host: typeof managedHosts.$inferSelect,
	command: { module: string; action: string; payload: Record<string, unknown> }
) {
	const client = createTetraClient({
		connectionMode: host.connectionMode,
		agentUrl: host.agentUrl,
		bearerToken: host.bearerToken
	});
	return client.dispatch(command);
}

async function markHostDispatchResult(
	db: ReturnType<typeof initDrizzle>,
	host: typeof managedHosts.$inferSelect,
	response: AgentResponse
) {
	const now = Date.now();
	await db
		.update(managedHosts)
		.set({
			connectionState: 'online',
			lastSeenAt: now,
			lastError: response.ok ? null : response.error || null,
			updatedAt: now
		})
		.where(and(eq(managedHosts.id, host.id), eq(managedHosts.ownerProjectId, host.ownerProjectId)));
}

const listParams = type({ projectId: 'string' });
export const listManagedHosts = query(listParams, async (params): Promise<ManagedHost[]> => {
	const user = requireUser();
	if (accessibilityFixtureEnabled) {
		return accessibilityFixtureManagedHosts.filter((host) => host.ownerProjectId === params.projectId);
	}

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
	if (accessibilityFixtureEnabled) {
		const host = accessibilityFixtureManagedHosts.find((item) => item.id === params.hostId);
		if (!host) error(404, 'Managed host not found');
		return host;
	}

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

export const deleteManagedHost = command(getParams, async (params) => {
	if (accessibilityFixtureEnabled) return;

	const user = requireUser();
	const { db, host } = await loadManagedHost(params.hostId);
	await requireProjectAccess(db, user.id, host.ownerProjectId, 'admin');

	await db.delete(managedHosts).where(eq(managedHosts.id, host.id));
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
					os: getSystemOs(result.system, host.os),
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

	const response = await dispatchHostCommand(host, {
		module: params.module.trim(),
		action: params.action.trim(),
		payload
	});

	await markHostDispatchResult(db, host, response);

	return response;
});

const podmanListParams = type({
	hostId: 'string',
	resource: 'string'
});
export const listManagedHostPodman = command(
	podmanListParams,
	async (params): Promise<ManagedHostPodmanResult> => {
		if (!['containers', 'images', 'volumes', 'networks'].includes(params.resource)) {
			error(400, 'Unsupported Podman resource');
		}

		const resource = params.resource as ManagedHostPodmanResource;
		if (accessibilityFixtureEnabled) return fixturePodmanResult(resource);

		const user = requireUser();
		const { db, host } = await loadManagedHost(params.hostId);
		await requireProjectAccess(db, user.id, host.ownerProjectId);

		const response = await dispatchHostCommand(host, {
			module: 'podman',
			action: resource,
			payload: {}
		});
		await markHostDispatchResult(db, host, response);
		return mapPodmanResponse(response);
	}
);

const podmanLogsParams = type({
	hostId: 'string',
	name: 'string',
	lines: 'number'
});
export const getManagedHostPodmanLogs = command(podmanLogsParams, async (params) => {
	if (accessibilityFixtureEnabled) return '2026-01-01T00:00:00Z demo-web started\n';

	const user = requireUser();
	const { db, host } = await loadManagedHost(params.hostId);
	await requireProjectAccess(db, user.id, host.ownerProjectId);

	const response = await dispatchHostCommand(host, {
		module: 'podman',
		action: 'logs',
		payload: {
			name: params.name,
			lines: Math.max(1, Math.min(1000, Math.trunc(params.lines)))
		}
	});
	await markHostDispatchResult(db, host, response);

	if (!response.ok) throw new Error(response.error || 'Failed to load container logs');
	const payload = isRecord(response.payload) ? response.payload : {};
	return typeof payload.stdout === 'string' ? payload.stdout : '';
});

const podmanActionParams = type({
	hostId: 'string',
	name: 'string',
	action: 'string'
});
export const runManagedHostPodmanContainerAction = command(podmanActionParams, async (params) => {
	if (!['start', 'stop', 'restart', 'remove'].includes(params.action)) {
		error(400, 'Unsupported Podman container action');
	}

	if (accessibilityFixtureEnabled) {
		return {
			id: 'fixture-podman-action',
			ok: true,
			payload: { command: `podman ${params.action} ${params.name}`, status: 0 }
		} satisfies AgentResponse;
	}

	const user = requireUser();
	const { db, host } = await loadManagedHost(params.hostId);
	await requireProjectAccess(db, user.id, host.ownerProjectId, 'admin');

	const response = await dispatchHostCommand(host, {
		module: 'podman',
		action: params.action,
		payload: { name: params.name }
	});
	await markHostDispatchResult(db, host, response);

	if (!response.ok) throw new Error(response.error || 'Podman container action failed');
	return response;
});
