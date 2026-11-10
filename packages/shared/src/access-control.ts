import { createAccessControl } from 'better-auth/plugins/access';

const organizationStatement = {
	organization: ['update', 'delete'],
	member: ['create', 'update', 'delete'],
	invitation: ['create', 'cancel'],
	team: ['create', 'update', 'delete'],
	ac: ['create', 'read', 'update', 'delete'],
	project: ['read', 'write', 'admin', 'delete']
} as const;

export const ac = createAccessControl(organizationStatement);

const read = ac.newRole({
	project: ['read']
});

const readWrite = ac.newRole({
	project: ['read', 'write']
});

const admin = ac.newRole({
	organization: ['update'],
	member: ['create', 'update', 'delete'],
	invitation: ['create', 'cancel'],
	project: ['read', 'write', 'admin']
});

const owner = ac.newRole({
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
	read_write: readWrite,
	read
};
