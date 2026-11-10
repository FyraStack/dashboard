import { initAuth } from '#lib/server/auth.js';
import { runInBackground } from '#lib/server/background.js';
import {
	ensureLocalProjectBillingCustomer,
	ensureProjectCustomer
} from '#lib/server/billing/autumn.js';
import { context } from '#lib/server/context.js';
import { error } from '#lib/server/http.js';

export function toProjectName(name: string) {
	return name.trim() || 'Untitled Project';
}

function toSlug(name: string) {
	const slug = name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 42);

	return `${slug || 'project'}-${Date.now().toString(36)}`;
}

export async function createOwnedProject(
	name: string,
	ownerUserId?: string
): Promise<{ id: string }> {
	const auth = initAuth();
	const slug = toSlug(name);
	const org = await auth.api.createOrganization({
		headers: ownerUserId ? undefined : context().request.headers,
		body: { name, slug, userId: ownerUserId }
	});
	if (!org) {
		error(502, 'Failed to create project');
	}

	await ensureLocalProjectBillingCustomer(org.id);
	runInBackground(ensureProjectCustomer(org.id), `sync autumn customer for project ${org.id}`);

	return { id: org.id };
}
