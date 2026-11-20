import { supportAttachmentNameHeader, supportAttachmentsPath } from 'stack-shared/routes';
import {
	MAX_TICKET_ATTACHMENT_BYTES,
	MAX_TICKET_ATTACHMENTS,
	type TicketPriority,
	type TicketStatus
} from 'stack-shared/support';
import { statusBadgeClass } from '#lib/vm-status.js';
import { resolve } from '$app/paths';

interface StatusPresentation {
	badgeClass: string;
	label: string;
}

export const customerTicketStatus: Record<TicketStatus, StatusPresentation> = {
	open: { label: 'Awaiting support', badgeClass: statusBadgeClass.info },
	pending: { label: 'Awaiting your reply', badgeClass: statusBadgeClass.warning },
	closed: { label: 'Closed', badgeClass: statusBadgeClass.muted }
};

export const staffTicketStatus: Record<TicketStatus, StatusPresentation> = {
	open: { label: 'Needs reply', badgeClass: statusBadgeClass.warning },
	pending: { label: 'Waiting on customer', badgeClass: statusBadgeClass.info },
	closed: { label: 'Closed', badgeClass: statusBadgeClass.muted }
};

export const ticketPriorityBadgeClass: Record<TicketPriority, string> = {
	low: statusBadgeClass.muted,
	normal: statusBadgeClass.muted,
	high: statusBadgeClass.warning,
	urgent: statusBadgeClass.danger
};

export const accountScope = 'account';

export function supportHref(
	page = '',
	scope: { projectId?: string | null; vmId?: string | null } = {}
) {
	const search = new URLSearchParams();
	if (scope.projectId) {
		search.set('project', scope.projectId);
	}
	if (scope.vmId) {
		search.set('vm', scope.vmId);
	}
	const pathname = page ? `${resolve('support')}/${page}` : resolve('support');
	return search.size > 0 ? `${pathname}?${search}` : pathname;
}

export function formatAttachmentSize(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	const kilobytes = bytes / 1024;
	if (kilobytes < 1024) {
		return `${kilobytes.toFixed(0)} KB`;
	}
	return `${Number((kilobytes / 1024).toFixed(1))} MB`;
}

async function uploadAttachment(file: File) {
	const response = await fetch(supportAttachmentsPath, {
		method: 'POST',
		headers: {
			'content-type': 'application/octet-stream',
			[supportAttachmentNameHeader]: encodeURIComponent(file.name)
		},
		body: file
	});
	if (!response.ok) {
		throw new Error((await response.text()) || `Failed to upload ${file.name}`);
	}
	const { id } = (await response.json()) as { id: string };
	return id;
}

export function uploadAttachments(files: readonly File[]) {
	return Promise.all(files.map(uploadAttachment));
}

export function attachmentProblem(existing: readonly File[], added: readonly File[]) {
	if (existing.length + added.length > MAX_TICKET_ATTACHMENTS) {
		return `You can attach up to ${MAX_TICKET_ATTACHMENTS} files per message`;
	}
	const oversized = added.find((file) => file.size > MAX_TICKET_ATTACHMENT_BYTES);
	if (oversized) {
		return `${oversized.name} is larger than ${formatAttachmentSize(MAX_TICKET_ATTACHMENT_BYTES)}`;
	}
	return null;
}
