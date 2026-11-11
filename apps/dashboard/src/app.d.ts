/// <reference types="unplugin-icons/types/svelte" />
/// <reference types="@cloudflare/workers-types" />
/// <reference path="../../backend/worker-configuration.d.ts" />

import type { Api } from 'stack-backend';
import type { AppSession, AppUser } from 'stack-backend/types';
import type { FeatureFlags } from 'stack-shared/feature-flags';

declare global {
	namespace App {
		interface Locals {
			activeProjectId?: string | null;
			backend?: Promise<Awaited<ReturnType<Service<Api>['as']>>>;
			session?: AppSession;
			user?: AppUser;
		}

		interface PageData {
			featureFlags?: FeatureFlags;
			isAdmin?: boolean;
		}
	}

	namespace Cloudflare {
		interface Env {
			BACKEND: Service<Api>;
			PUBLIC_POSTHOG_HOST?: string;
			PUBLIC_POSTHOG_KEY?: string;
			PUBLIC_SENTRY_DSN?: string;
		}
	}
}
