import { Autumn } from 'autumn-js';
import { and, eq } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { initDrizzle } from '$lib/server/db';
import { member, organization, projectBillingCustomers, user } from '$lib/server/db/schema';
import { getRuntimeEnv } from '$lib/server/env';

function createAutumnClient() {
	const env = getRuntimeEnv();

	return new Autumn({ secretKey: env.AUTUMN_SECRET });
}

function errorMessage(err: unknown) {
	return err instanceof Error ? err.message : String(err);
}

async function getProjectCustomerData(projectId: string) {
	const db = initDrizzle();
	const project = await db.query.organization.findFirst({
		where: eq(organization.id, projectId),
		with: { members: { with: { user: true } } }
	});

	if (!project) error(404, `Project "${projectId}" not found`);

	const owner = project.members.find((item) => item.role === 'owner') ?? project.members[0];

	return {
		name: project.name,
		email: owner?.user?.email ?? null
	};
}

export async function ensureLocalProjectBillingCustomer(projectId: string) {
	const db = initDrizzle();
	const now = Date.now();
	const existing = await db.query.projectBillingCustomers.findFirst({
		where: eq(projectBillingCustomers.projectId, projectId)
	});

	if (existing) return existing;

	const [inserted] = await db
		.insert(projectBillingCustomers)
		.values({
			projectId,
			autumnCustomerId: projectId,
			createdAt: now,
			updatedAt: now
		})
		.returning();

	return inserted;
}

export async function ensureProjectCustomer(projectId: string) {
	const db = initDrizzle();
	const now = Date.now();
	await ensureLocalProjectBillingCustomer(projectId);

	try {
		const customer = await getProjectCustomerData(projectId);
		await createAutumnClient().customers.getOrCreate({
			customerId: projectId,
			name: customer.name,
			email: customer.email,
			metadata: { projectId }
		});

		await db
			.update(projectBillingCustomers)
			.set({ syncStatus: 'synced', syncError: null, lastSyncedAt: now, updatedAt: now })
			.where(eq(projectBillingCustomers.projectId, projectId));
	} catch (err) {
		await db
			.update(projectBillingCustomers)
			.set({ syncStatus: 'failed', syncError: errorMessage(err), updatedAt: now })
			.where(eq(projectBillingCustomers.projectId, projectId));

		throw err;
	}
}

export async function updateProjectCustomer(projectId: string) {
	const db = initDrizzle();
	const now = Date.now();
	const customer = await getProjectCustomerData(projectId);

	try {
		await createAutumnClient().customers.update({
			customerId: projectId,
			name: customer.name,
			email: customer.email,
			metadata: { projectId }
		});

		await db
			.update(projectBillingCustomers)
			.set({ syncStatus: 'synced', syncError: null, lastSyncedAt: now, updatedAt: now })
			.where(eq(projectBillingCustomers.projectId, projectId));
	} catch (err) {
		await db
			.update(projectBillingCustomers)
			.set({ syncStatus: 'failed', syncError: errorMessage(err), updatedAt: now })
			.where(eq(projectBillingCustomers.projectId, projectId));
		throw err;
	}
}

export async function openProjectBillingPortal(projectId: string, returnUrl: string) {
	await ensureProjectCustomer(projectId);

	const portal = await createAutumnClient().billing.openCustomerPortal({
		customerId: projectId,
		returnUrl
	});

	return portal.url;
}

export async function deleteLocalProjectBillingCustomer(projectId: string) {
	const db = initDrizzle();
	await db.delete(projectBillingCustomers).where(eq(projectBillingCustomers.projectId, projectId));
}

export async function getProjectBillingOwner(projectId: string) {
	const db = initDrizzle();
	const [owner] = await db
		.select({ email: user.email })
		.from(member)
		.innerJoin(user, eq(user.id, member.userId))
		.where(and(eq(member.organizationId, projectId), eq(member.role, 'owner')))
		.limit(1);

	return owner?.email ?? null;
}

export function formatAutumnError(err: unknown) {
	return errorMessage(err);
}
