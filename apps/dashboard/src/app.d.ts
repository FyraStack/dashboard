/// <reference types="unplugin-icons/types/svelte" />
/// <reference types="@cloudflare/workers-types" />

import type { Fetcher, KVNamespace, SendEmail } from '@cloudflare/workers-types';
import type { Session, User } from 'better-auth';
import type { Pool } from 'pg';
import type { Database } from '#lib/server/db/index.js';

type AppSession = Session & {
	activeOrganizationId?: string | null;
};

declare global {
	namespace App {
		interface Locals {
			accessCache?: Map<string, Promise<unknown>>;
			activeProjectId?: string | null;
			backgroundTasks?: Promise<unknown>[];
			db?: Database;
			dbPool?: Pool;
			session?: AppSession;
			user?: User & { role?: string | null; isAdmin?: boolean };
		}

		interface PageData {
			featureFlags?: {
				colocation: boolean;
				firewall: boolean;
				images: boolean;
				volumes: boolean;
			};
			isAdmin?: boolean;
		}
	}

	namespace Cloudflare {
		interface Env {
			AUTUMN_CREDITS_FEATURE_ID?: string;
			AUTUMN_DEFAULT_PLAN_ID?: string;
			AUTUMN_ENABLED?: string;
			AUTUMN_SECRET?: string;
			AUTUMN_SERVER_ENTITY_FEATURE_ID?: string;
			BETTER_AUTH_SECRET: string;
			BUNNY_API_KEY?: string;
			CLOUDFLARE_ACCOUNT_ID?: string;
			CLOUDFLARE_API_TOKEN?: string;
			CLOUDFLARE_EMAIL_API_TOKEN?: string;
			EMAIL?: SendEmail;
			EMAIL_FROM_ADDRESS: string;
			EMAIL_FROM_NAME: string;
			EMAIL_REPLY_TO: string;
			FEATURE_FLAGS?: KVNamespace;
			GITHUB_CLIENT_ID?: string;
			GITHUB_CLIENT_SECRET?: string;
			HYPERDRIVE: {
				connectionString: string;
			};
			INTERNAL_CRON_SECRET?: string;
			ORIGIN: string;
			PROXMOX_API_SECRET?: string;
			PROXMOX_API_URL?: string;
			PROXMOX_EXCLUDED_NODES?: string;
			PROXMOX_SNIPPETS_ENDPOINT_PASSWORD?: string;
			PROXMOX_SNIPPETS_ENDPOINT_URL?: string;
			PROXMOX_SNIPPETS_ENDPOINT_USERNAME?: string;
			PROXMOX_SNIPPETS_ENDPOINT_VERIFY_SSL?: string;
			PROXMOX_SNIPPETS_STORAGE?: string;
			PROXMOX_SNIPPETS_USE_VPC?: string;
			PROXMOX_TOKEN_ID?: string;
			PROXMOX_TOKEN_SECRET?: string;
			PROXMOX_USE_VPC?: string;
			PROXMOX_VM_CPU_TYPE?: string;
			PROXMOX_VM_FIREWALL_SECURITY_GROUP?: string;
			PROXMOX_VPC?: Fetcher;
			PUBLIC_POSTHOG_HOST?: string;
			PUBLIC_POSTHOG_KEY?: string;
			PUBLIC_SENTRY_DSN?: string;
			SNIPPETS?: Fetcher;
			STACK_TIMING_SPAM?: string;
			VYOS_API_KEY?: string;
			VYOS_API_URL?: string;
			VYOS_USE_VPC?: string;
			VYOS_VERIFY_SSL?: string;
			VYOS_VPC_01?: Fetcher;
			VYOS_VPC_02?: Fetcher;
		}
	}
}
