import { and, eq } from 'drizzle-orm';
import BillingNoticeEmail from '$lib/emails/billing-notice.svelte';
import BillingReminderEmail from '$lib/emails/billing-reminder.svelte';
import SecurityAlertEmail from '$lib/emails/security-alert.svelte';
import { initDrizzle } from '$lib/server/db';
import { member, user } from '$lib/server/db/schema';
import { sendRenderedEmail } from '$lib/server/email';
import { getRuntimeEnv } from '$lib/server/env';

type SecurityAlertEmailParams = {
	to: string;
	userName?: string | null;
	alertType: string;
	message: string;
	timestamp?: string;
	details?: string | null;
	actionUrl?: string | null;
};

type BillingReminderEmailParams = {
	to: string;
	userName?: string | null;
	amount: string;
	dueDate: string;
	invoiceUrl: string;
	planName?: string | null;
};

type ProjectBillingReminderEmailParams = Omit<BillingReminderEmailParams, 'to' | 'userName'> & {
	projectId: string;
};

function formatEmailTimestamp(date = new Date()) {
	return `${new Intl.DateTimeFormat('en', {
		dateStyle: 'medium',
		timeStyle: 'short',
		timeZone: 'UTC'
	}).format(date)} UTC`;
}

export function sendSecurityAlertEmail({
	to,
	userName,
	alertType,
	message,
	timestamp = formatEmailTimestamp(),
	details = null,
	actionUrl = null
}: SecurityAlertEmailParams) {
	return sendRenderedEmail({
		component: SecurityAlertEmail,
		props: { userName, alertType, message, timestamp, details, actionUrl },
		subject: `Security alert: ${alertType}`,
		to
	});
}

export function sendBillingReminderEmail({
	to,
	userName,
	amount,
	dueDate,
	invoiceUrl,
	planName = null
}: BillingReminderEmailParams) {
	return sendRenderedEmail({
		component: BillingReminderEmail,
		props: { userName, amount, dueDate, invoiceUrl, planName },
		subject: `Stack invoice ready: ${amount}`,
		to
	});
}

export async function sendProjectBillingReminderEmail({
	projectId,
	amount,
	dueDate,
	invoiceUrl,
	planName = null
}: ProjectBillingReminderEmailParams) {
	const db = initDrizzle();
	const [owner] = await db
		.select({ email: user.email, name: user.name })
		.from(member)
		.innerJoin(user, eq(user.id, member.userId))
		.where(and(eq(member.organizationId, projectId), eq(member.role, 'owner')))
		.limit(1);

	if (!owner) {
		throw new Error(`Project "${projectId}" does not have a billing owner.`);
	}

	return sendBillingReminderEmail({
		to: owner.email,
		userName: owner.name,
		amount,
		dueDate,
		invoiceUrl,
		planName
	});
}

async function getProjectOwnerRecipient(projectId: string) {
	const db = initDrizzle();
	const [owner] = await db
		.select({ email: user.email, name: user.name })
		.from(member)
		.innerJoin(user, eq(user.id, member.userId))
		.where(and(eq(member.organizationId, projectId), eq(member.role, 'owner')))
		.limit(1);

	return owner ?? null;
}

function projectBillingUrl(projectId: string) {
	const origin = getRuntimeEnv().ORIGIN ?? '';

	return `${origin}/projects/${projectId}/billing`;
}

export async function sendProjectPastDueEmail(projectId: string, graceDays: number) {
	const owner = await getProjectOwnerRecipient(projectId);
	if (!owner) return null;

	await sendRenderedEmail({
		component: BillingNoticeEmail,
		props: {
			userName: owner.name,
			heading: 'Payment overdue',
			preview: 'Your Stack project has an overdue balance',
			body: `Your project has an overdue balance. Update your payment method within ${graceDays} days to avoid your servers being suspended.`,
			actionUrl: projectBillingUrl(projectId),
			actionLabel: 'Update billing'
		},
		subject: 'Action required: overdue balance on your Stack project',
		to: owner.email
	});

	return owner.email;
}

export async function sendProjectSuspendedEmail(projectId: string) {
	const owner = await getProjectOwnerRecipient(projectId);
	if (!owner) return null;

	await sendRenderedEmail({
		component: BillingNoticeEmail,
		props: {
			userName: owner.name,
			heading: 'Servers suspended',
			preview: 'Your Stack servers have been suspended',
			body: 'Your servers have been suspended because of an overdue balance. Update your payment method to restore access, then start your servers again.',
			actionUrl: projectBillingUrl(projectId),
			actionLabel: 'Update billing'
		},
		subject: 'Your Stack servers have been suspended',
		to: owner.email
	});

	return owner.email;
}
