import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { hasProjectRole, type PermissionLevel } from '$lib/auth/organization-permissions';
import { member, organization, user } from '$lib/server/db/schema';

export function hasAdminRole(role: string | null | undefined): boolean {
	return role?.split(',').includes('admin') ?? false;
}

export async function requireAdmin(db: any, userId: string): Promise<void> {
	const currentUser = await db.query.user.findFirst({
		where: eq(user.id, userId)
	});

	if (hasAdminRole(currentUser?.role)) return;

	if (currentUser?.isAdmin) {
		await db.update(user).set({ role: 'admin' }).where(eq(user.id, userId));
		return;
	}

	error(403, 'Admin permission required');
}

export async function requireProjectAccess(
	db: any,
	userId: string,
	projectId: string,
	minLevel: PermissionLevel | 'owner' = 'read'
): Promise<void> {
	const project = await db.query.organization.findFirst({
		where: eq(organization.id, projectId)
	});

	if (!project) {
		error(404, `Project "${projectId}" not found`);
	}

	const projectMember = await db.query.member.findFirst({
		where: and(eq(member.organizationId, projectId), eq(member.userId, userId))
	});

	if (!projectMember || !hasProjectRole(projectMember.role, minLevel)) {
		error(403, 'Insufficient project permissions');
	}
}
