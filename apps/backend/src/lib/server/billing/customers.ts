import { eq, isNotNull, isNull, or } from 'drizzle-orm';
import { organization } from '#lib/server/db/auth.schema.js';
import { initDrizzle } from '#lib/server/db/index.js';
import { projectBillingCustomers } from '#lib/server/db/schema.js';
import { errorMessage } from '#lib/server/errors.js';
import { error } from '#lib/server/http.js';
import {
	type AutumnClient,
	autumnStatus,
	createAutumnClient,
	defaultPlanId,
	isBillingConfigured
} from './autumn.ts';
import { invalidateProjectBillingStatus } from './state.ts';

interface CustomerProfile {
	email: string | null;
	name: string;
}

async function getProjectCustomerProfile(projectId: string): Promise<CustomerProfile> {
	const db = initDrizzle();
	const project = await db.query.organization.findFirst({
		where: eq(organization.id, projectId),
		with: { members: { with: { user: true } } }
	});

	if (!project || project.deletedAt !== null) {
		error(404, `Project "${projectId}" not found`);
	}

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

	if (existing) {
		return existing;
	}

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

async function markCustomerSynced(projectId: string) {
	const now = Date.now();
	await initDrizzle()
		.update(projectBillingCustomers)
		.set({ syncStatus: 'synced', syncError: null, lastSyncedAt: now, updatedAt: now })
		.where(eq(projectBillingCustomers.projectId, projectId));
}

async function markCustomerSyncFailed(projectId: string, err: unknown) {
	await initDrizzle()
		.update(projectBillingCustomers)
		.set({ syncStatus: 'failed', syncError: errorMessage(err), updatedAt: Date.now() })
		.where(eq(projectBillingCustomers.projectId, projectId));
}

async function pushProjectCustomer(
	projectId: string,
	profile: CustomerProfile,
	send: (client: AutumnClient, input: CustomerPayload) => Promise<unknown>
) {
	try {
		await send(createAutumnClient(), {
			customerId: projectId,
			name: profile.name,
			email: profile.email,
			metadata: { projectId }
		});
		await markCustomerSynced(projectId);
	} catch (err) {
		await markCustomerSyncFailed(projectId, err);
		throw err;
	}
}

interface CustomerPayload {
	customerId: string;
	email: string | null;
	metadata: { projectId: string };
	name: string;
}

export async function ensureProjectCustomer(projectId: string) {
	if (!isBillingConfigured()) {
		await ensureLocalProjectBillingCustomer(projectId);
		return;
	}

	const profile = await getProjectCustomerProfile(projectId);
	await ensureLocalProjectBillingCustomer(projectId);
	await pushProjectCustomer(projectId, profile, (client, input) =>
		client.customers.getOrCreate(input)
	);
}

export async function refreshProjectBilling(projectId: string) {
	await ensureProjectCustomer(projectId).catch((err) => {
		console.warn(`Failed to refresh Autumn customer for project ${projectId}`, err);
	});
	invalidateProjectBillingStatus(projectId);
}

export async function updateProjectCustomer(projectId: string) {
	if (!isBillingConfigured()) {
		return;
	}

	const profile = await getProjectCustomerProfile(projectId);
	await pushProjectCustomer(projectId, profile, (client, input) => client.customers.update(input));
}

export async function attachDefaultProjectPlan(
	projectId: string,
	successUrl?: string,
	discountCode?: string
) {
	const planId = defaultPlanId();
	if (!planId) {
		return null;
	}

	await ensureProjectCustomer(projectId);
	if (!isBillingConfigured()) {
		return null;
	}

	const attachPlan = (withDiscount: boolean) =>
		createAutumnClient().billing.attach({
			customerId: projectId,
			planId,
			redirectMode: 'if_required',
			...(successUrl ? { successUrl } : {}),
			...(withDiscount && discountCode ? { discounts: [{ promotionCode: discountCode }] } : {})
		});

	try {
		const response = await attachPlan(true).catch((err) => {
			if (!discountCode || autumnStatus(err) !== 400) {
				throw err;
			}

			console.warn(
				`Autumn rejected the discount code for project ${projectId}; attaching the plan without it`,
				err
			);
			return attachPlan(false);
		});

		invalidateProjectBillingStatus(projectId);
		return response.paymentUrl;
	} catch (err) {
		if (autumnStatus(err) === 409) {
			return null;
		}

		await markCustomerSyncFailed(projectId, err);
		throw err;
	}
}

export async function cancelProjectBilling(projectId: string) {
	if (!isBillingConfigured()) {
		return true;
	}

	const planId = defaultPlanId();

	try {
		await createAutumnClient().billing.update({
			customerId: projectId,
			...(planId ? { planId } : {}),
			cancelAction: 'cancel_end_of_cycle'
		});
		return true;
	} catch (err) {
		if (autumnStatus(err) === 404) {
			return true;
		}

		await markCustomerSyncFailed(projectId, err);
		return false;
	}
}

export async function deleteLocalProjectBillingCustomer(projectId: string) {
	const db = initDrizzle();
	await db.delete(projectBillingCustomers).where(eq(projectBillingCustomers.projectId, projectId));
}

export async function retryOrphanedProjectBillingCancellations(limit = 100) {
	const db = initDrizzle();
	const orphans = await db
		.select({ projectId: projectBillingCustomers.projectId })
		.from(projectBillingCustomers)
		.leftJoin(organization, eq(organization.id, projectBillingCustomers.projectId))
		.where(or(isNull(organization.id), isNotNull(organization.deletedAt)))
		.limit(limit);

	let cancelled = 0;
	for (const { projectId } of orphans) {
		// biome-ignore lint/performance/noAwaitInLoops: orphan cancellations hit Autumn one at a time to stay within its rate limits
		if (await cancelProjectBilling(projectId)) {
			await deleteLocalProjectBillingCustomer(projectId);
			cancelled += 1;
		}
	}

	return { orphaned: orphans.length, cancelled };
}

export async function validateProjectDiscountCode(projectId: string, discountCode: string) {
	const planId = defaultPlanId();
	if (!(planId && isBillingConfigured())) {
		return;
	}

	await ensureProjectCustomer(projectId);

	try {
		await createAutumnClient().billing.previewAttach({
			customerId: projectId,
			planId,
			discounts: [{ promotionCode: discountCode }]
		});
	} catch (err) {
		if (autumnStatus(err) === 400) {
			error(400, 'This discount code is not valid.');
		}
		throw err;
	}
}

export async function setupProjectPayment(projectId: string, successUrl: string) {
	if (!isBillingConfigured()) {
		error(501, 'Billing is not configured in this environment.');
	}

	await ensureProjectCustomer(projectId);

	const response = await createAutumnClient().billing.setupPayment({
		customerId: projectId,
		successUrl
	});

	return response.url;
}

export async function openProjectBillingPortal(projectId: string, returnUrl: string) {
	if (!isBillingConfigured()) {
		error(501, 'Billing is not configured in this environment.');
	}

	await ensureProjectCustomer(projectId);

	const portal = await createAutumnClient().billing.openCustomerPortal({
		customerId: projectId,
		returnUrl
	});

	return portal.url;
}
