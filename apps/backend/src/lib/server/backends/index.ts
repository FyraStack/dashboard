import { env } from 'cloudflare:workers';
import { createVpcFetch } from '#lib/server/vpc.js';
import { ProxmoxClient } from './proxmox/client.ts';
import { ProxmoxBackend } from './proxmox/index.ts';

export type { VmCreateParams, VmInfo, VmPowerAction } from './types.ts';

let cached: ProxmoxBackend | null = null;

function parseNodeList(value: string | undefined): string[] {
	if (!value) {
		return [];
	}
	return value
		.split(',')
		.map((node) => node.trim())
		.filter(Boolean);
}

function createProxmox(): ProxmoxBackend {
	const tokenSecret = env.PROXMOX_TOKEN_SECRET ?? env.PROXMOX_API_SECRET;

	if (!(env.PROXMOX_API_URL && env.PROXMOX_TOKEN_ID && tokenSecret)) {
		throw new Error(
			'Proxmox backend requires PROXMOX_API_URL, PROXMOX_TOKEN_ID, and PROXMOX_TOKEN_SECRET'
		);
	}

	if (
		!(
			env.PROXMOX_SNIPPETS_ENDPOINT_URL &&
			env.PROXMOX_SNIPPETS_ENDPOINT_USERNAME &&
			env.PROXMOX_SNIPPETS_ENDPOINT_PASSWORD
		)
	) {
		throw new Error(
			'Proxmox backend requires PROXMOX_SNIPPETS_ENDPOINT_URL, PROXMOX_SNIPPETS_ENDPOINT_USERNAME, and PROXMOX_SNIPPETS_ENDPOINT_PASSWORD'
		);
	}

	const client = new ProxmoxClient({
		baseUrl: env.PROXMOX_API_URL,
		tokenId: env.PROXMOX_TOKEN_ID,
		tokenSecret,
		fetch: createVpcFetch([env.PROXMOX_VPC], env.PROXMOX_USE_VPC)
	});

	return new ProxmoxBackend(client, {
		snippetsFetch: createVpcFetch([env.SNIPPETS], env.PROXMOX_SNIPPETS_USE_VPC),
		snippetsEndpointUrl: env.PROXMOX_SNIPPETS_ENDPOINT_URL,
		snippetsEndpointUsername: env.PROXMOX_SNIPPETS_ENDPOINT_USERNAME,
		snippetsEndpointPassword: env.PROXMOX_SNIPPETS_ENDPOINT_PASSWORD,
		snippetsStorage: env.PROXMOX_SNIPPETS_STORAGE,
		firewallSecurityGroup: env.PROXMOX_VM_FIREWALL_SECURITY_GROUP,
		vmCpuType: env.PROXMOX_VM_CPU_TYPE,
		excludedNodes: parseNodeList(env.PROXMOX_EXCLUDED_NODES)
	});
}

export function proxmox(): ProxmoxBackend {
	if (cached && !import.meta.env.DEV) {
		return cached;
	}
	cached = createProxmox();
	return cached;
}
