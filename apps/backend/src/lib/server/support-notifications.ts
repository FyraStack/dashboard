import { env } from 'cloudflare:workers';
import { and, eq, exists, inArray, or, sql } from 'drizzle-orm';
import { adminSupportTicketPath, supportTicketPath } from 'stack-shared/routes';
import { type TicketCategory, ticketCategoryLabels } from 'stack-shared/support';
import SupportTicketNotificationEmail from '#lib/emails/support-ticket-notification.svelte';
import { adminUserCondition } from '#lib/server/auth-context.js';
import { member, user } from '#lib/server/db/auth.schema.js';
import type { Database } from '#lib/server/db/index.js';
import { supportTicketMessages } from '#lib/server/db/schema.js';
import { renderEmail, sendEmail } from '#lib/server/email.js';
import { getRuntimeEnv } from '#lib/server/env.js';

const EXCERPT_LENGTH = 500;
const DISCORD_AUTHOR_NAME_LIMIT = 256;

export interface NotifiedTicket {
	category: TicketCategory;
	id: string;
	number: number;
	projectId: string | null;
	projectName: string | null;
	requesterId: string | null;
	subject: string;
	vmName: string | null;
}

function onOneLine(value: string) {
	return value.replace(/\s+/g, ' ').trim();
}

function describeTicket(ticket: NotifiedTicket, message: string) {
	const excerpt = onOneLine(message);
	return {
		subject: onOneLine(ticket.subject),
		details: [
			`#${ticket.number}`,
			ticketCategoryLabels[ticket.category],
			ticket.projectName ?? 'Account-level',
			ticket.vmName
		]
			.filter(Boolean)
			.join(' · '),
		excerpt: excerpt.length > EXCERPT_LENGTH ? `${excerpt.slice(0, EXCERPT_LENGTH)}…` : excerpt
	};
}

async function sendTicketNotification(
	ticket: NotifiedTicket,
	recipients: string[],
	notification: { actionPath: string; message: string; subjectPrefix: string; summary: string }
) {
	if (recipients.length === 0) {
		return;
	}

	const { subject, details, excerpt } = describeTicket(ticket, notification.message);
	const { html, text } = await renderEmail(SupportTicketNotificationEmail, {
		heading: subject,
		summary: notification.summary,
		details,
		excerpt,
		actionUrl: `${getRuntimeEnv().ORIGIN}${notification.actionPath}`
	});
	const emailSubject = `[Support #${ticket.number}] ${notification.subjectPrefix}: ${subject}`;

	await Promise.all(recipients.map((to) => sendEmail({ subject: emailSubject, to, html, text })));
}

async function postToStaffDiscord(ticket: NotifiedTicket, summary: string, message: string) {
	const webhookUrl = env.SUPPORT_DISCORD_WEBHOOK_URL;
	if (!webhookUrl) {
		return;
	}

	const { subject, details, excerpt } = describeTicket(ticket, message);
	const response = await fetch(webhookUrl, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			allowed_mentions: { parse: [] },
			embeds: [
				{
					author: { name: summary.slice(0, DISCORD_AUTHOR_NAME_LIMIT) },
					title: `#${ticket.number} ${subject}`,
					url: `${getRuntimeEnv().ORIGIN}${adminSupportTicketPath(ticket.id)}`,
					description: excerpt,
					footer: { text: details }
				}
			]
		})
	});
	if (!response.ok) {
		throw new Error(`Discord webhook responded with ${response.status}`);
	}
}

async function listStaffEmails(db: Database) {
	const staff = await db
		.select({ email: user.email })
		.from(user)
		.where(and(adminUserCondition, sql`${user.banned} is not true`));
	return staff.map(({ email }) => email);
}

async function listCustomerEmails(db: Database, ticket: NotifiedTicket) {
	const repliers = db
		.select({ userId: supportTicketMessages.authorUserId })
		.from(supportTicketMessages)
		.where(
			and(eq(supportTicketMessages.ticketId, ticket.id), eq(supportTicketMessages.staff, false))
		);
	const involved = or(
		ticket.requesterId ? eq(user.id, ticket.requesterId) : undefined,
		inArray(user.id, repliers)
	);
	const stillMember =
		ticket.projectId === null
			? undefined
			: exists(
					db
						.select({ id: member.id })
						.from(member)
						.where(and(eq(member.userId, user.id), eq(member.organizationId, ticket.projectId)))
				);

	const customers = await db
		.select({ email: user.email })
		.from(user)
		.where(and(involved, stillMember, sql`${user.banned} is not true`));
	return customers.map(({ email }) => email);
}

export async function notifyStaffOfCustomerMessage(
	db: Database,
	ticket: NotifiedTicket,
	authorName: string,
	authorEmail: string,
	event: 'opened' | 'replied',
	message: string
) {
	const summary = `${authorName} (${authorEmail}) ${event === 'opened' ? 'opened a ticket' : 'replied'}.`;
	await Promise.all([
		postToStaffDiscord(ticket, summary, message),
		sendTicketNotification(ticket, await listStaffEmails(db), {
			message,
			summary,
			subjectPrefix: event === 'opened' ? 'New ticket' : 'New reply',
			actionPath: adminSupportTicketPath(ticket.id)
		})
	]);
}

export async function notifyCustomersOfStaffMessage(
	db: Database,
	ticket: NotifiedTicket,
	staffName: string,
	event: 'opened' | 'replied',
	message: string
) {
	await sendTicketNotification(ticket, await listCustomerEmails(db, ticket), {
		message,
		subjectPrefix: event === 'opened' ? 'New ticket from staff' : 'New reply',
		summary:
			event === 'opened'
				? `${staffName} (Staff) opened a support ticket for you.`
				: `${staffName} (Staff) replied to your support ticket.`,
		actionPath: supportTicketPath(ticket.id)
	});
}
