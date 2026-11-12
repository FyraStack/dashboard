import { type } from 'arktype';
import { backend } from '#lib/server/backend.js';
import { command, query } from '$app/server';

export const listIpamPrefixes = query(() => backend((me) => me.admin().ipam().listPrefixes()));

const prefixFields = {
	name: 'string',
	cidr: 'string',
	whitelistStart: 'string?',
	whitelistEnd: 'string?',
	gatewayAddress: 'string?',
	bunnyDnsZone: 'string?',
	disabled: 'boolean?',
	ipv6UseTransitAddress: 'boolean?'
} as const;

export const createIpamPrefix = command(type(prefixFields), (input) =>
	backend((me) => me.admin().ipam().createPrefix(input))
);

const updatePrefixParams = type({ prefixId: 'string', ...prefixFields });

export const updateIpamPrefix = command(updatePrefixParams, (input) =>
	backend((me) => me.admin().ipam().updatePrefix(input))
);

const disabledParams = type({ prefixId: 'string', disabled: 'boolean' });

export const setIpamPrefixDisabled = command(disabledParams, (input) =>
	backend((me) => me.admin().ipam().setPrefixDisabled(input))
);

const deleteParams = type({ prefixId: 'string' });

export const deleteIpamPrefix = command(deleteParams, (input) =>
	backend((me) => me.admin().ipam().deletePrefix(input))
);

export const getIpamPtrDefaultFormats = query(() =>
	backend((me) => me.admin().ipam().ptrDefaultFormats())
);

const ptrDefaultsParams = type({
	defaultPtrFormatIpv4: 'string',
	defaultPtrFormatIpv6: 'string'
});

export const updateIpamPtrDefaultFormats = command(ptrDefaultsParams, (input) =>
	backend((me) => me.admin().ipam().updatePtrDefaultFormats(input))
);
