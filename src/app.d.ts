import type { User, Session } from 'better-auth';

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
			env: {
				ORIGIN: string;
				BETTER_AUTH_SECRET: string;
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
