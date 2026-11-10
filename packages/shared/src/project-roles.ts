export const projectRoles = ['owner', 'admin', 'read_write', 'read'] as const;
export type ProjectRole = (typeof projectRoles)[number];
export type PermissionLevel = Exclude<ProjectRole, 'owner'>;

export const projectRoleLabels: Record<ProjectRole, string> = {
	owner: 'Owner',
	admin: 'Admin',
	read_write: 'Read & Write',
	read: 'Read'
};

const projectRoleRank: Record<ProjectRole, number> = {
	read: 0,
	read_write: 1,
	admin: 2,
	owner: 3
};

export function isProjectRole(role: string): role is ProjectRole {
	return projectRoles.includes(role as ProjectRole);
}

export function hasProjectRole(role: string, minLevel: PermissionLevel | 'owner'): boolean {
	if (!isProjectRole(role)) {
		return false;
	}
	return projectRoleRank[role] >= projectRoleRank[minLevel];
}
