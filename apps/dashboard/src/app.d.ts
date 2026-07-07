import type { User, Session } from 'better-auth';
import type { Fetcher, KVNamespace, SendEmail } from '@cloudflare/workers-types';
import type { Pool } from 'pg';
import type { Database } from '$lib/server/db';

type AppSession = Session & {
	activeOrganizationId?: string | null;
};

declare global {
	namespace App {
		interface Locals {
			user?: User & { role?: string | null; isAdmin?: boolean };
			session?: AppSession;
			activeProjectId?: string | null;
			db?: Database;
			dbPool?: Pool;
			backgroundTasks?: Promise<unknown>[];
			accessCache?: Map<string, Promise<unknown>>;
		}

		interface Platform {
			ctx: ExecutionContext;
			env: {
				ORIGIN: string;
				BETTER_AUTH_SECRET: string;
				VYOS_API_URL?: string;
				VYOS_API_KEY?: string;
				VYOS_VERIFY_SSL?: string;
				VYOS_USE_VPC?: string;
				VYOS_VPC_01?: Fetcher;
				VYOS_VPC_02?: Fetcher;
				EMAIL?: SendEmail;
				EMAIL_FROM_ADDRESS: string;
				EMAIL_FROM_NAME: string;
				EMAIL_REPLY_TO: string;
				STACK_TIMING_SPAM?: string;
				CLOUDFLARE_ACCOUNT_ID?: string;
				CLOUDFLARE_API_TOKEN?: string;
				CLOUDFLARE_EMAIL_API_TOKEN?: string;
				AUTUMN_SECRET?: string;
				AUTUMN_DEFAULT_PLAN_ID?: string;
				AUTUMN_SERVER_ENTITY_FEATURE_ID?: string;
				HYPERDRIVE: {
					connectionString: string;
				};
				FEATURE_FLAGS?: KVNamespace;
				BILLING_METER_SECRET?: string;
				GITHUB_CLIENT_ID?: string;
				GITHUB_CLIENT_SECRET?: string;
				PROXMOX_VPC?: Fetcher;
				PROXMOX_USE_VPC?: string;
				PROXMOX_API_URL?: string;
				PROXMOX_TOKEN_ID?: string;
				PROXMOX_TOKEN_SECRET?: string;
				SNIPPETS?: Fetcher;
				PROXMOX_SNIPPETS_USE_VPC?: string;
				PROXMOX_SNIPPETS_ENDPOINT_URL?: string;
				PROXMOX_SNIPPETS_ENDPOINT_USERNAME?: string;
				PROXMOX_SNIPPETS_ENDPOINT_PASSWORD?: string;
				PROXMOX_SNIPPETS_ENDPOINT_VERIFY_SSL?: string;
				PROXMOX_SNIPPETS_STORAGE?: string;
				PROXMOX_VM_FIREWALL_SECURITY_GROUP?: string;
			};
		}

		interface PageData {
			isAdmin?: boolean;
			featureFlags?: {
				colocation: boolean;
				firewall: boolean;
				images: boolean;
				volumes: boolean;
			};
		}
	}
}

export {};
