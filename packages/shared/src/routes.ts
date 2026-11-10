export const resetPasswordPath = '/reset-password';

export function projectBillingPath(projectId: string) {
	return `/projects/${projectId}/billing`;
}

export function createServerPath(projectId: string) {
	return `/projects/${projectId}/servers/create`;
}
