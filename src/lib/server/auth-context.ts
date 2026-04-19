import { eq, and } from 'drizzle-orm';
import { projects, projectPermissions } from '$lib/server/db/schema';
import { error } from '@sveltejs/kit';

type PermissionLevel = 'read' | 'read_write' | 'admin';

const permissionRank: Record<PermissionLevel, number> = {
	read: 0,
	read_write: 1,
	admin: 2
};

export async function requireAdmin(db: any, userId: string): Promise<void> {
	const ownedProject = await db.query.projects.findFirst({
		where: eq(projects.ownerUserId, userId)
	});

	if (ownedProject) return;

	const adminPerm = await db.query.projectPermissions.findFirst({
		where: and(eq(projectPermissions.userId, userId), eq(projectPermissions.permissions, 'admin'))
	});

	if (adminPerm) return;

	error(403, 'Admin permission required');
}

export async function requireProjectAccess(
	db: any,
	userId: string,
	projectId: string,
	minLevel: PermissionLevel = 'read'
): Promise<void> {
	const project = await db.query.projects.findFirst({
		where: eq(projects.id, projectId)
	});

	if (!project) {
		error(404, `Project "${projectId}" not found`);
	}

	if (project.ownerUserId === userId) return;

	const perm = await db.query.projectPermissions.findFirst({
		where: and(eq(projectPermissions.projectId, projectId), eq(projectPermissions.userId, userId))
	});

	if (!perm || permissionRank[perm.permissions as PermissionLevel] < permissionRank[minLevel]) {
		error(403, 'Insufficient project permissions');
	}
}
