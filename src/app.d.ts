import type { User, Session } from 'better-auth';
import type { KVNamespace, SendEmail } from '@cloudflare/workers-types';

type AppSession = Session & {
	activeOrganizationId?: string | null;
};

declare global {
	namespace App {
		interface Locals {
			user?: User;
			session?: AppSession;
			activeProjectId?: string | null;
		}

		interface Platform {
			ctx: ExecutionContext;
			env: {
				ORIGIN: string;
				BETTER_AUTH_SECRET: string;
				NETBOX_API_TOKEN: string;
				NETBOX_API_URL: string;
				EMAIL?: SendEmail;
				EMAIL_FROM_ADDRESS: string;
				EMAIL_FROM_NAME: string;
				EMAIL_REPLY_TO: string;
				CLOUDFLARE_ACCOUNT_ID?: string;
				CLOUDFLARE_API_TOKEN?: string;
				CLOUDFLARE_EMAIL_API_TOKEN?: string;
				AUTUMN_SECRET: string;
				AUTUMN_DEFAULT_PLAN_ID?: string;
				AUTUMN_SERVER_ENTITY_FEATURE_ID?: string;
				HYPERDRIVE: {
					connectionString: string;
				};
				FEATURE_FLAGS?: KVNamespace;
				PROXMOX_CACHE?: KVNamespace;
				BILLING_METER_SECRET?: string;
				// OAuth (set as Cloudflare Worker secrets)
				GITHUB_CLIENT_ID?: string;
				GITHUB_CLIENT_SECRET?: string;
				GOOGLE_CLIENT_ID?: string;
				GOOGLE_CLIENT_SECRET?: string;
				// Proxmox VE backend
				PROXMOX_API_URL?: string;
				PROXMOX_TOKEN_ID?: string;
				PROXMOX_TOKEN_SECRET?: string;
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
		// interface PageState {}
	}
}

export {};
