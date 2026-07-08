import { Autumn } from 'autumn-js';
import { and, eq, isNull } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { initDrizzle } from '$lib/server/db';
import { member, organization, projectBillingCustomers, user } from '$lib/server/db/schema';
import { getRuntimeEnv } from '$lib/server/env';

export function isBillingConfigured() {
	const env = getRuntimeEnv();
	return env.AUTUMN_ENABLED !== 'false' && Boolean(env.AUTUMN_SECRET);
}

export function createAutumnClient() {
	const secretKey = getRuntimeEnv().AUTUMN_SECRET;
	if (!secretKey) throw new Error('AUTUMN_SECRET is not set');

	return new Autumn({ secretKey, failOpen: false });
}

function errorMessage(err: unknown) {
	return err instanceof Error ? err.message : String(err);
}

function autumnStatus(err: unknown) {
	return typeof err === 'object' && err !== null && 'statusCode' in err
		? Number(err.statusCode)
		: null;
}

function serverEntityFeatureId() {
	const featureId = getRuntimeEnv().AUTUMN_SERVER_ENTITY_FEATURE_ID;
	if (!featureId) throw new Error('AUTUMN_SERVER_ENTITY_FEATURE_ID is not set');

	return featureId;
}

function defaultPlanId() {
	return getRuntimeEnv().AUTUMN_DEFAULT_PLAN_ID;
}

function isActiveSubscription(subscription: {
	planId?: string | null;
	status?: string | null;
	pastDue?: boolean | null;
	canceledAt?: number | null;
	expiresAt?: number | null;
}) {
	const now = Date.now();

	return (
		subscription.status === 'active' &&
		!subscription.pastDue &&
		!subscription.canceledAt &&
		(!subscription.expiresAt || subscription.expiresAt > now)
	);
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

	if (!isBillingConfigured()) return;

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
	if (!isBillingConfigured()) return;

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

export async function attachDefaultProjectPlan(
	projectId: string,
	successUrl?: string,
	discountCode?: string
) {
	const planId = defaultPlanId();
	if (!planId) return null;

	await ensureProjectCustomer(projectId);
	if (!isBillingConfigured()) return null;

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
			if (!discountCode || autumnStatus(err) !== 400) throw err;

			return attachPlan(false);
		});

		invalidateProjectBillingState(projectId);
		return response.paymentUrl;
	} catch (err) {
		if (autumnStatus(err) === 409) return null;

		const db = initDrizzle();
		await db
			.update(projectBillingCustomers)
			.set({ syncStatus: 'failed', syncError: errorMessage(err), updatedAt: Date.now() })
			.where(eq(projectBillingCustomers.projectId, projectId));
		throw err;
	}
}

export async function cancelProjectBilling(projectId: string) {
	if (!isBillingConfigured()) return true;

	const planId = defaultPlanId();

	try {
		await createAutumnClient().billing.update({
			customerId: projectId,
			...(planId ? { planId } : {}),
			cancelAction: 'cancel_end_of_cycle'
		});
		return true;
	} catch (err) {
		if (autumnStatus(err) === 404) return true;

		const db = initDrizzle();
		await db
			.update(projectBillingCustomers)
			.set({ syncStatus: 'failed', syncError: errorMessage(err), updatedAt: Date.now() })
			.where(eq(projectBillingCustomers.projectId, projectId));
		return false;
	}
}

export async function retryOrphanedProjectBillingCancellations(limit = 100) {
	const db = initDrizzle();
	const orphans = await db
		.select({ projectId: projectBillingCustomers.projectId })
		.from(projectBillingCustomers)
		.leftJoin(organization, eq(organization.id, projectBillingCustomers.projectId))
		.where(isNull(organization.id))
		.limit(limit);

	let cancelled = 0;
	for (const { projectId } of orphans) {
		if (await cancelProjectBilling(projectId)) {
			await deleteLocalProjectBillingCustomer(projectId);
			cancelled += 1;
		}
	}

	return { orphaned: orphans.length, cancelled };
}

export async function validateProjectDiscountCode(projectId: string, discountCode: string) {
	const planId = defaultPlanId();
	if (!planId || !isBillingConfigured()) return;

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
	if (!isBillingConfigured()) error(501, 'Billing is not configured in this environment.');

	await ensureProjectCustomer(projectId);

	const response = await createAutumnClient().billing.setupPayment({
		customerId: projectId,
		successUrl
	});

	return response.url;
}

async function computeProjectBillingState(projectId: string) {
	if (!isBillingConfigured()) {
		return {
			status: 'active' as const,
			customer: null,
			planId: defaultPlanId() ?? null,
			syncError: null
		};
	}

	const db = initDrizzle();
	const localCustomer = await db.query.projectBillingCustomers.findFirst({
		where: eq(projectBillingCustomers.projectId, projectId)
	});

	if (!localCustomer) {
		return {
			status: 'not_setup' as const,
			customer: null,
			planId: defaultPlanId() ?? null,
			syncError: null
		};
	}

	if (localCustomer.syncStatus === 'failed') {
		return {
			status: 'failed' as const,
			customer: { autumnCustomerId: localCustomer.autumnCustomerId },
			planId: defaultPlanId() ?? null,
			syncError: localCustomer.syncError
		};
	}

	const planId = defaultPlanId();
	if (!planId) {
		return {
			status: 'active' as const,
			customer: { autumnCustomerId: localCustomer.autumnCustomerId },
			planId: null,
			syncError: null
		};
	}

	try {
		const customer = await createAutumnClient().customers.get({
			customerId: projectId
		});
		const subscription = customer.subscriptions.find((item) => item.planId === planId);

		if (subscription?.pastDue) {
			return {
				status: 'past_due' as const,
				customer: { autumnCustomerId: localCustomer.autumnCustomerId },
				planId,
				syncError: null
			};
		}

		return {
			status:
				subscription && isActiveSubscription(subscription)
					? ('active' as const)
					: ('payment_required' as const),
			customer: { autumnCustomerId: localCustomer.autumnCustomerId },
			planId,
			syncError: null
		};
	} catch (err) {
		const statusCode = autumnStatus(err);
		if (statusCode === 404) {
			return {
				status: 'not_setup' as const,
				customer: { autumnCustomerId: localCustomer.autumnCustomerId },
				planId,
				syncError: null
			};
		}

		if (statusCode === null || statusCode >= 500) {
			return {
				status: 'provider_unavailable' as const,
				customer: { autumnCustomerId: localCustomer.autumnCustomerId },
				planId,
				syncError: errorMessage(err)
			};
		}

		return {
			status: 'failed' as const,
			customer: { autumnCustomerId: localCustomer.autumnCustomerId },
			planId,
			syncError: errorMessage(err)
		};
	}
}

type ProjectBillingState = Awaited<ReturnType<typeof computeProjectBillingState>>;

const BILLING_STATE_TTL_MS = 60_000;
const billingStateCache = new Map<string, { state: ProjectBillingState; expiresAt: number }>();

export function invalidateProjectBillingState(projectId: string) {
	billingStateCache.delete(projectId);
}

export async function getProjectBillingState(
	projectId: string,
	options: { live?: boolean } = {}
): Promise<ProjectBillingState> {
	const now = Date.now();
	if (!options.live) {
		const cached = billingStateCache.get(projectId);
		if (cached && now < cached.expiresAt) return cached.state;
	}

	const state = await computeProjectBillingState(projectId);
	billingStateCache.set(projectId, { state, expiresAt: now + BILLING_STATE_TTL_MS });
	return state;
}

export async function isProjectBillingExempt(projectId: string) {
	const db = initDrizzle();
	const [exemptOwner] = await db
		.select({ userId: member.userId })
		.from(member)
		.innerJoin(user, eq(user.id, member.userId))
		.where(
			and(
				eq(member.organizationId, projectId),
				eq(member.role, 'owner'),
				eq(user.billingExempt, true)
			)
		)
		.limit(1);

	return Boolean(exemptOwner);
}

export async function requireProjectBillingActive(projectId: string) {
	if (await isProjectBillingExempt(projectId)) return;

	const state = await getProjectBillingState(projectId, { live: true });

	if (state.status !== 'active' && state.status !== 'provider_unavailable') {
		error(402, 'This project does not have active billing.');
	}
}

export async function openProjectBillingPortal(projectId: string, returnUrl: string) {
	if (!isBillingConfigured()) error(501, 'Billing is not configured in this environment.');

	await ensureProjectCustomer(projectId);

	const portal = await createAutumnClient().billing.openCustomerPortal({
		customerId: projectId,
		returnUrl
	});

	return portal.url;
}

export async function ensureProjectServerEntity(input: {
	projectId: string;
	serverId: string;
	name?: string | null;
	customerEnsured?: boolean;
}) {
	if (!isBillingConfigured()) return;

	if (!input.customerEnsured) {
		await ensureProjectCustomer(input.projectId);
	}
	const client = createAutumnClient();

	try {
		await client.entities.get({ customerId: input.projectId, entityId: input.serverId });
		return;
	} catch (err) {
		if (autumnStatus(err) !== 404) throw err;
	}

	try {
		await client.entities.create({
			customerId: input.projectId,
			entityId: input.serverId,
			featureId: serverEntityFeatureId(),
			name: input.name ?? input.serverId
		});
	} catch (err) {
		if (autumnStatus(err) !== 409) throw err;
	}
}

export async function deleteProjectServerEntity(projectId: string, serverId: string) {
	if (!isBillingConfigured()) return;

	try {
		await createAutumnClient().entities.delete({ customerId: projectId, entityId: serverId });
	} catch (err) {
		if (autumnStatus(err) !== 404) throw err;
	}
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
