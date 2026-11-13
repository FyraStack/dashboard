export const resetPasswordPath = '/reset-password';

export function projectBillingPath(projectId: string) {
	return `/projects/${projectId}/billing`;
}

export function createServerPath(projectId: string) {
	return `/projects/${projectId}/servers/create`;
}

export const serialConsoleBasePath = '/api/console';

export function serialConsolePath(vmId: string) {
	return `${serialConsoleBasePath}/${encodeURIComponent(vmId)}`;
}

export function isSerialConsolePath(pathname: string) {
	return pathname.startsWith(`${serialConsoleBasePath}/`);
}
