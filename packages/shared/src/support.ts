export const ticketCategories = ['technical', 'billing', 'account', 'abuse', 'other'] as const;

export type TicketCategory = (typeof ticketCategories)[number];

export const ticketCategoryLabels: Record<TicketCategory, string> = {
	technical: 'Technical',
	billing: 'Billing',
	account: 'Account',
	abuse: 'Abuse report',
	other: 'Something else'
};

export const ticketStatuses = ['open', 'pending', 'closed'] as const;

export type TicketStatus = (typeof ticketStatuses)[number];

export const ticketPriorities = ['low', 'normal', 'high', 'urgent'] as const;

export type TicketPriority = (typeof ticketPriorities)[number];

export const ticketPriorityLabels: Record<TicketPriority, string> = {
	low: 'Low',
	normal: 'Normal',
	high: 'High',
	urgent: 'Urgent'
};

export const MAX_TICKET_SUBJECT_LENGTH = 200;
export const MAX_TICKET_MESSAGE_LENGTH = 20_000;
export const MAX_TICKET_ATTACHMENTS = 10;
export const MAX_TICKET_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_TICKET_ATTACHMENT_NAME_LENGTH = 255;
