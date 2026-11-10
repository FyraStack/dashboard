import { and, eq } from 'drizzle-orm';
import { projectBillingPath } from 'stack-shared/routes';
import BillingNoticeEmail from '#lib/emails/billing-notice.svelte';
import SecurityAlertEmail from '#lib/emails/security-alert.svelte';
import { member, user } from '#lib/server/db/auth.schema.js';
import { initDrizzle } from '#lib/server/db/index.js';
import { sendRenderedEmail } from '#lib/server/email.js';
import { getRuntimeEnv } from '#lib/server/env.js';

interface SecurityAlertEmailParams {
	actionUrl?: string | null;
	alertType: string;
	details?: string | null;
	message: string;
	timestamp?: string;
	to: string;
	userName?: string | null;
}

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
	return `${getRuntimeEnv().ORIGIN}${projectBillingPath(projectId)}`;
}

async function sendProjectBillingNotice(
	projectId: string,
	notice: { body: string; heading: string; preview: string; subject: string }
) {
	const owner = await getProjectOwnerRecipient(projectId);
	if (!owner) {
		return null;
	}

	await sendRenderedEmail({
		component: BillingNoticeEmail,
		props: {
			userName: owner.name,
			heading: notice.heading,
			preview: notice.preview,
			body: notice.body,
			actionUrl: projectBillingUrl(projectId),
			actionLabel: 'Update billing'
		},
		subject: notice.subject,
		to: owner.email
	});

	return owner.email;
}

export function sendProjectPastDueEmail(projectId: string, graceDays: number) {
	return sendProjectBillingNotice(projectId, {
		heading: 'Payment overdue',
		preview: 'Your Stack project has an overdue balance',
		body: `Your project has an overdue balance. Update your payment method within ${graceDays} days to avoid your servers being suspended.`,
		subject: 'Action required: overdue balance on your Stack project'
	});
}

export function sendProjectSuspendedEmail(projectId: string) {
	return sendProjectBillingNotice(projectId, {
		heading: 'Servers suspended',
		preview: 'Your Stack servers have been suspended',
		body: 'Your servers have been suspended because of an overdue balance. Update your payment method to restore access, then start your servers again.',
		subject: 'Your Stack servers have been suspended'
	});
}
