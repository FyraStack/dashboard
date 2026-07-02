import { createAccessControl } from 'better-auth/plugins/access';

export const projectRoles = ['owner', 'admin', 'read_write', 'read'] as const;
export type ProjectRole = (typeof projectRoles)[number];
export type PermissionLevel = Exclude<ProjectRole, 'owner'>;

export const projectRoleRank: Record<ProjectRole, number> = {
	read: 0,
	read_write: 1,
	admin: 2,
	owner: 3
};

export const organizationStatement = {
	organization: ['update', 'delete'],
	member: ['create', 'update', 'delete'],
	invitation: ['create', 'cancel'],
	team: ['create', 'update', 'delete'],
	ac: ['create', 'read', 'update', 'delete'],
	project: ['read', 'write', 'admin', 'delete']
} as const;

export const ac = createAccessControl(organizationStatement);

export const read = ac.newRole({
	project: ['read']
});

export const read_write = ac.newRole({
	project: ['read', 'write']
});

export const admin = ac.newRole({
	organization: ['update'],
	member: ['create', 'update', 'delete'],
	invitation: ['create', 'cancel'],
	project: ['read', 'write', 'admin']
});

export const owner = ac.newRole({
	organization: ['update', 'delete'],
	member: ['create', 'update', 'delete'],
	invitation: ['create', 'cancel'],
	team: ['create', 'update', 'delete'],
	ac: ['create', 'read', 'update', 'delete'],
	project: ['read', 'write', 'admin', 'delete']
});

export const organizationRoles = {
	owner,
	admin,
	read_write,
	read
};

export function isProjectRole(role: string): role is ProjectRole {
	return projectRoles.includes(role as ProjectRole);
}

export function hasProjectRole(role: string, minLevel: PermissionLevel | 'owner'): boolean {
	if (!isProjectRole(role)) return false;
	return projectRoleRank[role] >= projectRoleRank[minLevel];
}
