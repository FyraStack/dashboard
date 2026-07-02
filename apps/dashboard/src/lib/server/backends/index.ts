import { dev } from '$app/environment';
import type { VmBackend } from './types';
import { ProxmoxBackend } from './proxmox';
import { ProxmoxClient } from './proxmox/client';
import { getBackendEnv } from './env';
import { timingLog } from '$lib/server/observability';

export type {
	BackendImage,
	BackendImageImportTarget,
	BackendImageImportParams,
	VmBackend,
	VmInfo,
	VmMetricsHistorySample,
	VmMetricsTimeframe,
	VmCreateParams,
	VmCreateResult,
	VmStatus
} from './types';

let cached: { key: string; backend: VmBackend } | null = null;

function createProxmox(): ProxmoxBackend {
	const started = performance.now();
	const env = getBackendEnv();

	if (!env.PROXMOX_API_URL || !env.PROXMOX_TOKEN_ID || !env.PROXMOX_TOKEN_SECRET) {
		throw new Error(
			'Proxmox backend requires PROXMOX_API_URL, PROXMOX_TOKEN_ID, and PROXMOX_TOKEN_SECRET'
		);
	}

	if (
		!env.PROXMOX_SNIPPETS_ENDPOINT_URL ||
		!env.PROXMOX_SNIPPETS_ENDPOINT_USERNAME ||
		!env.PROXMOX_SNIPPETS_ENDPOINT_PASSWORD
	) {
		throw new Error(
			'Proxmox backend requires PROXMOX_SNIPPETS_ENDPOINT_URL, PROXMOX_SNIPPETS_ENDPOINT_USERNAME, and PROXMOX_SNIPPETS_ENDPOINT_PASSWORD'
		);
	}

	const proxmoxHost = new URL(env.PROXMOX_API_URL).host;
	timingLog('backend.proxmox.create.start', {
		'proxmox.host': proxmoxHost,
		'proxmox.use_vpc': env.PROXMOX_USE_VPC !== 'false'
	});

	const client = new ProxmoxClient({
		baseUrl: env.PROXMOX_API_URL,
		tokenId: env.PROXMOX_TOKEN_ID,
		tokenSecret: env.PROXMOX_TOKEN_SECRET,
		verifySsl: !dev,
		vpc: env.PROXMOX_USE_VPC === 'false' ? undefined : env.PROXMOX_VPC
	});

	const backend = new ProxmoxBackend(client, {
		snippetsVpc: env.PROXMOX_SNIPPETS_USE_VPC === 'false' ? undefined : env.SNIPPETS,
		snippetsEndpointUrl: env.PROXMOX_SNIPPETS_ENDPOINT_URL,
		snippetsEndpointUsername: env.PROXMOX_SNIPPETS_ENDPOINT_USERNAME,
		snippetsEndpointPassword: env.PROXMOX_SNIPPETS_ENDPOINT_PASSWORD,
		snippetsEndpointVerifySsl: env.PROXMOX_SNIPPETS_ENDPOINT_VERIFY_SSL !== 'false',
		snippetsStorage: env.PROXMOX_SNIPPETS_STORAGE,
		firewallSecurityGroup: env.PROXMOX_VM_FIREWALL_SECURITY_GROUP
	});

	timingLog('backend.proxmox.create.end', {
		'proxmox.host': proxmoxHost,
		duration_ms: Math.round((performance.now() - started) * 100) / 100
	});

	return backend;
}

export function getBackend(name: string): VmBackend {
	// Skip cache in dev — module-level state survives HMR and goes stale
	const started = performance.now();
	const cacheHit = !dev && cached?.key === name;
	timingLog('backend.get.start', { 'backend.name': name, 'backend.cache_hit': cacheHit });
	if (!dev && cached?.key === name) {
		const backend = cached.backend;
		timingLog('backend.get.end', {
			'backend.name': name,
			'backend.cache_hit': true,
			duration_ms: Math.round((performance.now() - started) * 100) / 100
		});
		return backend;
	}

	let backend: VmBackend;

	switch (name) {
		case 'proxmox':
			backend = createProxmox();
			break;
		default:
			throw new Error(`Unknown VM backend: "${name}"`);
	}

	cached = { key: name, backend };
	timingLog('backend.get.end', {
		'backend.name': name,
		'backend.cache_hit': false,
		duration_ms: Math.round((performance.now() - started) * 100) / 100
	});
	return backend;
}
