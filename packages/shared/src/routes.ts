export const resetPasswordPath = '/reset-password';

export function projectBillingPath(projectId: string) {
	return `/projects/${projectId}/billing`;
}

export function createServerPath(projectId: string) {
	return `/projects/${projectId}/servers/create`;
}

export function supportTicketPath(ticketId: string) {
	return `/support/${encodeURIComponent(ticketId)}`;
}

export function adminSupportTicketPath(ticketId: string) {
	return `/admin/support/${encodeURIComponent(ticketId)}`;
}

export const supportAttachmentsPath = '/api/support/attachments';
export const supportAttachmentNameHeader = 'x-attachment-name';

export function supportAttachmentPath(attachmentId: string) {
	return `${supportAttachmentsPath}/${encodeURIComponent(attachmentId)}`;
}

export function isSupportAttachmentPath(pathname: string) {
	return pathname === supportAttachmentsPath || pathname.startsWith(`${supportAttachmentsPath}/`);
}

export const serialConsoleBasePath = '/api/console';

export function serialConsolePath(vmId: string) {
	return `${serialConsoleBasePath}/${encodeURIComponent(vmId)}`;
}

export function isSerialConsolePath(pathname: string) {
	return pathname.startsWith(`${serialConsoleBasePath}/`);
}
