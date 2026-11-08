import { and, eq } from 'drizzle-orm';
import { hasProjectRole, type PermissionLevel } from '#lib/auth/organization-permissions.js';
import { context } from '#lib/server/context.js';
import { member, organization, user } from '#lib/server/db/auth.schema.js';
import type { Database } from '#lib/server/db/index.js';
import { error } from '#lib/server/http.js';

export function hasAdminRole(role: string | null | undefined): boolean {
	return role?.split(',').includes('admin') ?? false;
}

function cachedLookup<T>(key: string, compute: () => Promise<T>): Promise<T> {
	const { locals } = context();
	locals.accessCache ??= new Map();
	const cache = locals.accessCache;
	const existing = cache.get(key) as Promise<T> | undefined;
	if (existing) {
		return existing;
	}

	const lookup = compute();
	cache.set(key, lookup);
	return lookup;
}

type ProjectAccess = {
	projectId: string;
	role: string | null;
	disabled: boolean;
	deletedAt: number | null;
} | null;

function loadProjectAccess(
	db: Database,
	userId: string,
	projectId: string
): Promise<ProjectAccess> {
	return cachedLookup(`project-access:${userId}:${projectId}`, async () => {
		const [projectAccess] = await db
			.select({
				projectId: organization.id,
				role: member.role,
				disabled: organization.disabled,
				deletedAt: organization.deletedAt
			})
			.from(organization)
			.leftJoin(member, and(eq(member.organizationId, organization.id), eq(member.userId, userId)))
			.where(eq(organization.id, projectId))
			.limit(1);

		return (projectAccess ?? null) as ProjectAccess;
	});
}

export async function requireAdmin(db: Database, userId: string): Promise<void> {
	const isAdmin = await cachedLookup(`is-admin:${userId}`, async () => {
		const currentUser = await db.query.user.findFirst({
			where: eq(user.id, userId)
		});

		if (hasAdminRole(currentUser?.role)) {
			return true;
		}

		if (currentUser?.isAdmin) {
			await db.update(user).set({ role: 'admin' }).where(eq(user.id, userId));
			return true;
		}

		return false;
	});

	if (!isAdmin) {
		error(403, 'Admin permission required');
	}
}

export async function requireProjectAccess(
	db: Database,
	userId: string,
	projectId: string,
	minLevel: PermissionLevel | 'owner' = 'read'
): Promise<void> {
	const projectAccess = await loadProjectAccess(db, userId, projectId);

	if (!projectAccess || projectAccess.deletedAt !== null) {
		error(404, `Project "${projectId}" not found`);
	}

	if (projectAccess.disabled) {
		error(403, 'This project has been disabled');
	}

	if (!(projectAccess.role && hasProjectRole(projectAccess.role, minLevel))) {
		error(403, 'Insufficient project permissions');
	}
}

export async function getProjectMemberRole(
	db: Database,
	userId: string,
	projectId: string
): Promise<string | null> {
	const projectAccess = await loadProjectAccess(db, userId, projectId);
	return projectAccess?.role ?? null;
}
