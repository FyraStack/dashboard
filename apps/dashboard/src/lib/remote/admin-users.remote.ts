import { type } from 'arktype';
import type { AdminUser } from 'stack-backend/types';
import {
	accessibilityFixtureAdminUsers,
	accessibilityFixtureEnabled
} from '#lib/server/accessibility-fixtures.js';
import { backend } from '#lib/server/backend.js';
import { command, query } from '$app/server';

export type {
	AdminUser,
	UserAccount,
	UserApiToken,
	UserOrganization,
	UserSession,
	UserSshKey
} from 'stack-backend/types';

export const listAdminUsers = query(async (): Promise<AdminUser[]> => {
	if (accessibilityFixtureEnabled) {
		return accessibilityFixtureAdminUsers;
	}
	return await backend((me) => me.admin().users().list());
});

const setAdminParams = type({ userId: 'string', isAdmin: 'boolean' });
export const setUserAdmin = command(setAdminParams, (input) =>
	backend((me) => me.admin().users().setAdmin(input))
);

const setDisabledParams = type({ userId: 'string', disabled: 'boolean' });
export const setUserDisabled = command(setDisabledParams, (input) =>
	backend((me) => me.admin().users().setDisabled(input))
);

const setBillingExemptParams = type({ userId: 'string', billingExempt: 'boolean' });
export const setUserBillingExempt = command(setBillingExemptParams, (input) =>
	backend((me) => me.admin().users().setBillingExempt(input))
);

const setTwoFactorParams = type({ userId: 'string', twoFactorEnabled: 'boolean' });
export const setUserTwoFactor = command(setTwoFactorParams, (input) =>
	backend((me) => me.admin().users().setTwoFactor(input))
);

const setRoleParams = type({ userId: 'string', role: 'string' });
export const setUserRole = command(setRoleParams, (input) =>
	backend((me) => me.admin().users().setRole(input))
);

const beginDeleteUserParams = type({ userId: 'string' });
export const beginDeleteUser = command(beginDeleteUserParams, (input) =>
	backend((me) => me.admin().users().beginDelete(input))
);

const deleteUserParams = type({ userId: 'string', method: 'string', code: 'string?' });
export const deleteUserWithVerification = command(deleteUserParams, (input) =>
	backend((me) => me.admin().users().deleteWithVerification(input))
);

const getUserResourcesParams = type({ userId: 'string' });
export const getUserResources = query(getUserResourcesParams, (input) =>
	backend((me) => me.admin().users().resources(input))
);

const getOrgResourcesParams = type({ orgId: 'string' });
export const getOrganizationResources = query(getOrgResourcesParams, (input) =>
	backend((me) => me.admin().projects().resources(input))
);
