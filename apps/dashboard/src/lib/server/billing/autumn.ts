import { error } from '@sveltejs/kit';
import { Autumn } from 'autumn-js';
import { and, eq, isNotNull, isNull, lt, ne, or } from 'drizzle-orm';
import { member, organization, user } from '#lib/server/db/auth.schema.js';
import { initDrizzle } from '#lib/server/db/index.js';
import { projectBillingCustomers, projectCreditPurchases } from '#lib/server/db/schema.js';
import { getRuntimeEnv } from '#lib/server/env.js';
import type { CapPeriod } from './caps';

export function isBillingConfigured() {
	const env = getRuntimeEnv();
	return env.AUTUMN_ENABLED !== 'false' && Boolean(env.AUTUMN_SECRET);
}

export function createAutumnClient() {
	const secretKey = getRuntimeEnv().AUTUMN_SECRET;
	if (!secretKey) {
		throw new Error('AUTUMN_SECRET is not set');
	}

	return new Autumn({ secretKey, failOpen: false });
}

function errorMessage(err: unknown) {
	return err instanceof Error ? err.message : String(err);
}

export function autumnStatus(err: unknown) {
	return typeof err === 'object' && err !== null && 'statusCode' in err
		? Number(err.statusCode)
		: null;
}

function serverEntityFeatureId() {
	const featureId = getRuntimeEnv().AUTUMN_SERVER_ENTITY_FEATURE_ID;
	if (!featureId) {
		throw new Error('AUTUMN_SERVER_ENTITY_FEATURE_ID is not set');
	}

	return featureId;
}

function defaultPlanId() {
	return getRuntimeEnv().AUTUMN_DEFAULT_PLAN_ID;
}

export function creditsFeatureId() {
	return getRuntimeEnv().AUTUMN_CREDITS_FEATURE_ID || null;
}

function isActiveSubscription(subscription: {
	planId?: string | null;
	status?: string | null;
	pastDue?: boolean | null;
	expiresAt?: number | null;
}) {
	const now = Date.now();

	return (
		subscription.status === 'active' &&
		!subscription.pastDue &&
		(!subscription.expiresAt || subscription.expiresAt > now)
	);
}

async function getProjectCustomerData(projectId: string) {
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

	await db
		.insert(projectBillingCustomers)
		.values({
			projectId,
			autumnCustomerId: projectId,
			createdAt: now,
			updatedAt: now
		})
		.onConflictDoNothing({ target: projectBillingCustomers.projectId });

	const customer = await db.query.projectBillingCustomers.findFirst({
		where: eq(projectBillingCustomers.projectId, projectId)
	});
	if (!customer) {
		throw new Error(`Billing customer for project ${projectId} could not be created`);
	}

	return customer;
}

async function markProjectCustomerSynced(projectId: string) {
	const db = initDrizzle();
	const now = Date.now();
	await db
		.update(projectBillingCustomers)
		.set({ syncStatus: 'synced', syncError: null, lastSyncedAt: now, updatedAt: now })
		.where(eq(projectBillingCustomers.projectId, projectId));
}

async function markProjectCustomerSyncFailed(
	projectId: string,
	err: unknown,
	attemptStart: number
) {
	const db = initDrizzle();
	await db
		.update(projectBillingCustomers)
		.set({ syncStatus: 'failed', syncError: errorMessage(err), updatedAt: Date.now() })
		.where(
			and(
				eq(projectBillingCustomers.projectId, projectId),
				or(
					isNull(projectBillingCustomers.lastSyncedAt),
					lt(projectBillingCustomers.lastSyncedAt, attemptStart)
				)
			)
		);
}

async function getOrCreateAutumnCustomer(
	projectId: string,
	customer: { name: string; email: string | null }
) {
	const client = createAutumnClient();
	try {
		await client.customers.getOrCreate(
			{
				customerId: projectId,
				name: customer.name,
				email: customer.email,
				metadata: { projectId }
			},
			{ headers: { 'Idempotency-Key': `customer:${projectId}` } }
		);
	} catch (err) {
		if (autumnStatus(err) !== 409) {
			throw err;
		}

		await client.customers.get({ customerId: projectId });
	}
}

export async function ensureProjectCustomer(projectId: string) {
	const attemptStart = Date.now();

	if (!isBillingConfigured()) {
		await ensureLocalProjectBillingCustomer(projectId);
		return;
	}

	const customer = await getProjectCustomerData(projectId);
	await ensureLocalProjectBillingCustomer(projectId);

	try {
		await getOrCreateAutumnCustomer(projectId, customer);
		await markProjectCustomerSynced(projectId);
	} catch (err) {
		await markProjectCustomerSyncFailed(projectId, err, attemptStart);
		throw err;
	}
}

export async function updateProjectCustomer(projectId: string) {
	if (!isBillingConfigured()) {
		return;
	}

	const attemptStart = Date.now();
	const customer = await getProjectCustomerData(projectId);

	try {
		await createAutumnClient().customers.update({
			customerId: projectId,
			name: customer.name,
			email: customer.email,
			metadata: { projectId }
		});
		await markProjectCustomerSynced(projectId);
	} catch (err) {
		await markProjectCustomerSyncFailed(projectId, err, attemptStart);
		throw err;
	}
}

const SETUP_NONCE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function attachIdempotencyKey(projectId: string, planId: string, setupNonce?: string | null) {
	const base = `attach:${projectId}:${planId}`;
	return setupNonce && SETUP_NONCE_PATTERN.test(setupNonce) ? `${base}:${setupNonce}` : base;
}

export async function attachDefaultProjectPlan(
	projectId: string,
	successUrl?: string,
	discountCode?: string,
	setupNonce?: string | null
) {
	const planId = defaultPlanId();
	if (!planId) {
		return null;
	}

	await ensureProjectCustomer(projectId);
	if (!isBillingConfigured()) {
		return null;
	}

	const idempotencyKey = attachIdempotencyKey(projectId, planId, setupNonce);
	const attachPlan = (withDiscount: boolean) =>
		createAutumnClient().billing.attach(
			{
				customerId: projectId,
				planId,
				redirectMode: 'if_required',
				...(successUrl ? { successUrl } : {}),
				...(withDiscount && discountCode ? { discounts: [{ promotionCode: discountCode }] } : {})
			},
			{
				headers: {
					'Idempotency-Key':
						withDiscount && discountCode ? idempotencyKey : `${idempotencyKey}:nodiscount`
				}
			}
		);

	try {
		const response = await attachPlan(true).catch((err) => {
			if (!discountCode || autumnStatus(err) !== 400) {
				throw err;
			}

			return attachPlan(false);
		});

		invalidateProjectBillingState(projectId);
		return response.paymentUrl;
	} catch (err) {
		if (autumnStatus(err) === 409) {
			return null;
		}

		const db = initDrizzle();
		await db
			.update(projectBillingCustomers)
			.set({ syncStatus: 'failed', syncError: errorMessage(err), updatedAt: Date.now() })
			.where(eq(projectBillingCustomers.projectId, projectId));
		throw err;
	}
}

export async function cancelProjectBilling(projectId: string) {
	if (!isBillingConfigured()) {
		return true;
	}

	const planId = defaultPlanId();

	try {
		await createAutumnClient().billing.update(
			{
				customerId: projectId,
				...(planId ? { planId } : {}),
				cancelAction: 'cancel_end_of_cycle'
			},
			{ headers: { 'Idempotency-Key': `cancel:${projectId}:${planId ?? 'all'}` } }
		);
		return true;
	} catch (err) {
		const status = autumnStatus(err);
		if (status === 404 || status === 409) {
			return true;
		}

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
		if (cached && now < cached.expiresAt) {
			return cached.state;
		}
	}

	const state = await computeProjectBillingState(projectId);
	billingStateCache.set(projectId, { state, expiresAt: now + BILLING_STATE_TTL_MS });
	return state;
}

export async function isProjectBillingExempt(projectId: string) {
	const db = initDrizzle();

	const [project] = await db
		.select({ billingExempt: organization.billingExempt })
		.from(organization)
		.where(eq(organization.id, projectId))
		.limit(1);
	if (project?.billingExempt) {
		return true;
	}

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
	if (await isProjectBillingExempt(projectId)) {
		return;
	}

	const state = await getProjectBillingState(projectId, { live: true });

	if (state.status !== 'active' && state.status !== 'provider_unavailable') {
		error(402, 'This project does not have active billing.');
	}
}

export async function getProjectCreditsBalance(projectId: string) {
	const featureId = creditsFeatureId();
	if (!(featureId && isBillingConfigured())) {
		return null;
	}

	try {
		const customer = await createAutumnClient().customers.get({ customerId: projectId });
		const balance = customer.balances?.[featureId];
		if (!balance) {
			return null;
		}

		const breakdowns = balance.breakdown ?? [];
		const overage = breakdowns.find((item) => item.price?.billingMethod === 'usage_based');
		const prepaid = breakdowns.find((item) => item.price?.billingMethod === 'prepaid');
		const overagePrice = overage?.price;
		const overageRate =
			overagePrice && typeof overagePrice.amount === 'number' && overagePrice.billingUnits > 0
				? overagePrice.amount / overagePrice.billingUnits
				: null;
		const overageUsage = overage?.usage ?? 0;

		return {
			featureId,
			remaining: balance.remaining ?? 0,
			usage: balance.usage ?? 0,
			overageUsage,
			overageRate,
			estimatedOverageCost:
				overageRate === null ? null : Number((overageUsage * overageRate).toFixed(2)),
			prepaidPrice: prepaid?.price
				? { amount: prepaid.price.amount ?? null, billingUnits: prepaid.price.billingUnits }
				: null,
			nextResetAt: balance.nextResetAt ?? null
		};
	} catch {
		return null;
	}
}

const AUTUMN_IDEMPOTENCY_WINDOW_MS = 24 * 3_600_000;

async function claimCreditPurchase(projectId: string, purchaseId: string, credits: number) {
	const db = initDrizzle();
	const now = Date.now();

	await db
		.insert(projectCreditPurchases)
		.values({ purchaseId, projectId, credits, createdAt: now, updatedAt: now })
		.onConflictDoNothing({ target: projectCreditPurchases.purchaseId });

	const purchase = await db.query.projectCreditPurchases.findFirst({
		where: eq(projectCreditPurchases.purchaseId, purchaseId)
	});
	if (!purchase) {
		throw new Error(`Credit purchase ${purchaseId} could not be recorded`);
	}
	if (purchase.projectId !== projectId || purchase.credits !== credits) {
		error(409, 'This purchase does not match an earlier request. Reopen top-up and try again.');
	}

	return purchase;
}

async function completeCreditPurchase(purchaseId: string, paymentUrl: string | null) {
	const db = initDrizzle();
	await db
		.update(projectCreditPurchases)
		.set({ status: 'completed', paymentUrl, error: null, updatedAt: Date.now() })
		.where(eq(projectCreditPurchases.purchaseId, purchaseId));
}

async function settleAcceptedCreditPurchase(purchaseId: string) {
	const db = initDrizzle();
	await db
		.update(projectCreditPurchases)
		.set({ status: 'completed', error: null, updatedAt: Date.now() })
		.where(
			and(
				eq(projectCreditPurchases.purchaseId, purchaseId),
				ne(projectCreditPurchases.status, 'completed')
			)
		);

	const purchase = await db.query.projectCreditPurchases.findFirst({
		where: eq(projectCreditPurchases.purchaseId, purchaseId),
		columns: { paymentUrl: true }
	});
	return purchase?.paymentUrl ?? null;
}

async function failCreditPurchase(purchaseId: string, err: unknown) {
	const db = initDrizzle();
	await db
		.update(projectCreditPurchases)
		.set({ status: 'failed', error: errorMessage(err), updatedAt: Date.now() })
		.where(
			and(
				eq(projectCreditPurchases.purchaseId, purchaseId),
				ne(projectCreditPurchases.status, 'completed')
			)
		);
}

export async function purchaseProjectCredits(
	projectId: string,
	credits: number,
	purchaseId: string
) {
	const featureId = creditsFeatureId();
	const planId = defaultPlanId();
	if (!(isBillingConfigured() && featureId && planId)) {
		error(501, 'Credit purchases are not configured in this environment.');
	}

	const purchase = await claimCreditPurchase(projectId, purchaseId, credits);
	if (purchase.status === 'completed') {
		return purchase.paymentUrl;
	}
	if (Date.now() - purchase.createdAt >= AUTUMN_IDEMPOTENCY_WINDOW_MS) {
		error(
			409,
			'This top-up could not be confirmed in time. Check your billing page before starting a new one.'
		);
	}

	await ensureProjectCustomer(projectId);

	try {
		const response = await createAutumnClient().billing.update(
			{
				customerId: projectId,
				planId,
				featureQuantities: [{ featureId, quantity: credits }],
				redirectMode: 'if_required'
			},
			{ headers: { 'Idempotency-Key': `credits:${projectId}:${purchaseId}` } }
		);

		const paymentUrl = response.paymentUrl ?? null;
		await completeCreditPurchase(purchaseId, paymentUrl);
		invalidateProjectBillingState(projectId);
		return paymentUrl;
	} catch (err) {
		if (autumnStatus(err) === 409) {
			invalidateProjectBillingState(projectId);
			return settleAcceptedCreditPurchase(purchaseId);
		}

		await failCreditPurchase(purchaseId, err);
		throw err;
	}
}

const ISSUED_INVOICE_STATUSES = new Set(['open', 'paid', 'uncollectible']);

function isIssuedInvoice(invoice: { status: string }) {
	return ISSUED_INVOICE_STATUSES.has(invoice.status.toLowerCase());
}

export async function getProjectInvoices(projectId: string) {
	if (!isBillingConfigured()) {
		return [];
	}

	try {
		const customer = await createAutumnClient().customers.get({
			customerId: projectId,
			expand: ['invoices']
		});

		return (customer.invoices ?? []).filter(isIssuedInvoice).map((invoice) => ({
			stripeId: invoice.stripeId,
			status: invoice.status,
			total: invoice.total,
			currency: invoice.currency,
			createdAt: invoice.createdAt,
			hostedInvoiceUrl: invoice.hostedInvoiceUrl ?? null
		}));
	} catch {
		return [];
	}
}

export type ProjectBillingPeriodLookup =
	| { customer: 'found'; anchor: CapPeriod | null }
	| { customer: 'missing' };

async function findAutumnCustomer(projectId: string) {
	try {
		return await createAutumnClient().customers.get({ customerId: projectId });
	} catch (err) {
		if (autumnStatus(err) === 404) {
			return null;
		}
		throw err;
	}
}

export async function lookupProjectBillingPeriod(
	projectId: string
): Promise<ProjectBillingPeriodLookup> {
	if (!isBillingConfigured()) {
		return { customer: 'found', anchor: null };
	}

	const customer = await findAutumnCustomer(projectId);
	if (!customer) {
		return { customer: 'missing' };
	}

	const planId = defaultPlanId();
	const subscription = planId
		? customer.subscriptions.find((item) => item.planId === planId)
		: undefined;
	if (!(subscription?.currentPeriodStart && subscription.currentPeriodEnd)) {
		return { customer: 'found', anchor: null };
	}

	return {
		customer: 'found',
		anchor: { start: subscription.currentPeriodStart, end: subscription.currentPeriodEnd }
	};
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

export async function ensureProjectServerEntity(input: {
	projectId: string;
	serverId: string;
	name?: string | null;
	customerEnsured?: boolean;
}) {
	if (!isBillingConfigured()) {
		return;
	}

	if (!input.customerEnsured) {
		await ensureProjectCustomer(input.projectId);
	}
	const client = createAutumnClient();

	try {
		await client.entities.get({ customerId: input.projectId, entityId: input.serverId });
		return;
	} catch (err) {
		if (autumnStatus(err) !== 404) {
			throw err;
		}
	}

	try {
		await client.entities.create({
			customerId: input.projectId,
			entityId: input.serverId,
			featureId: serverEntityFeatureId(),
			name: input.name ?? input.serverId
		});
	} catch (err) {
		if (autumnStatus(err) !== 409) {
			throw err;
		}
	}
}

export async function deleteProjectServerEntity(projectId: string, serverId: string) {
	if (!isBillingConfigured()) {
		return;
	}

	try {
		await createAutumnClient().entities.delete({ customerId: projectId, entityId: serverId });
	} catch (err) {
		if (autumnStatus(err) !== 404) {
			throw err;
		}
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
