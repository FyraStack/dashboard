export function isIpv6(address: string) {
	return address.includes(':');
}

export function expandIpv6Groups(address: string): string[] | null {
	const bare = address.split('/')[0].trim().toLowerCase();
	if (!bare || bare.includes('.')) return null;

	const doubleColonSplit = bare.split('::');
	if (doubleColonSplit.length > 2) return null;

	const parseGroups = (part: string) => (part === '' ? [] : part.split(':'));
	const head = parseGroups(doubleColonSplit[0]);
	const tail = doubleColonSplit.length === 2 ? parseGroups(doubleColonSplit[1]) : [];
	const missing = 8 - head.length - tail.length;
	if (doubleColonSplit.length === 2 ? missing < 1 : missing !== 0) return null;

	const groups = [
		...head,
		...Array(doubleColonSplit.length === 2 ? missing : 0).fill('0'),
		...tail
	];
	if (groups.length !== 8) return null;
	if (!groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) return null;

	return groups.map((group) => group.padStart(4, '0'));
}

export function parseIpv4Octets(address: string): number[] | null {
	const bare = address.split('/')[0].trim();
	const octets = bare.split('.');
	if (octets.length !== 4) return null;

	const parsed = octets.map((octet) => (/^\d{1,3}$/.test(octet) ? Number(octet) : NaN));
	if (parsed.some((octet) => Number.isNaN(octet) || octet > 255)) return null;

	return parsed;
}

function addressToBigInt(address: string): bigint | null {
	if (isIpv6(address)) {
		const groups = expandIpv6Groups(address);
		if (!groups) return null;
		return BigInt(`0x${groups.join('')}`);
	}

	const octets = parseIpv4Octets(address);
	if (!octets) return null;
	return octets.reduce((value, octet) => (value << 8n) + BigInt(octet), 0n);
}

export function sameAddress(a: string, b: string): boolean {
	if (isIpv6(a) !== isIpv6(b)) return false;
	const aValue = addressToBigInt(a);
	const bValue = addressToBigInt(b);
	return aValue !== null && aValue === bValue;
}

export function addressInCidr(address: string, cidr: string): boolean {
	const [base, prefixLengthRaw] = cidr.trim().split('/');
	const prefixLength = Number(prefixLengthRaw);
	if (!base || !Number.isInteger(prefixLength)) return false;
	if (isIpv6(base) !== isIpv6(address)) return false;

	const bits = isIpv6(base) ? 128 : 32;
	if (prefixLength < 0 || prefixLength > bits) return false;

	const baseValue = addressToBigInt(base);
	const addressValue = addressToBigInt(address);
	if (baseValue === null || addressValue === null) return false;

	const shift = BigInt(bits - prefixLength);
	return baseValue >> shift === addressValue >> shift;
}

function ipv6Nibbles(address: string): string[] | null {
	const groups = expandIpv6Groups(address);
	if (!groups) return null;
	return groups.join('').split('');
}

export function reverseDnsZoneForCidr(cidr: string): string | null {
	const [address, prefixLengthRaw] = cidr.trim().split('/');
	const prefixLength = Number(prefixLengthRaw);
	if (!address || !Number.isInteger(prefixLength)) return null;

	if (isIpv6(address)) {
		if (prefixLength < 1 || prefixLength > 128) return null;
		const nibbles = ipv6Nibbles(address);
		if (!nibbles) return null;
		const zoneNibbles = nibbles.slice(0, Math.ceil(prefixLength / 4));
		return `${zoneNibbles.reverse().join('.')}.ip6.arpa`;
	}

	if (prefixLength < 1 || prefixLength > 32) return null;
	const octets = parseIpv4Octets(address);
	if (!octets) return null;
	const zoneOctets = octets.slice(0, Math.min(Math.ceil(prefixLength / 8), 3));
	return `${zoneOctets.reverse().join('.')}.in-addr.arpa`;
}

export function reverseDnsNameForIp(address: string): string | null {
	if (isIpv6(address)) {
		const nibbles = ipv6Nibbles(address);
		if (!nibbles) return null;
		return `${nibbles.reverse().join('.')}.ip6.arpa`;
	}

	const octets = parseIpv4Octets(address);
	if (!octets) return null;
	return `${octets.reverse().join('.')}.in-addr.arpa`;
}

function ptrTemplatePlaceholders(address: string): Map<string, string> | null {
	if (isIpv6(address)) {
		const groups = expandIpv6Groups(address);
		if (!groups) return null;
		return new Map(
			groups.flatMap((group, index) => [
				[`{group${index + 1}}`, group],
				[`{octet${index + 1}}`, group]
			])
		);
	}

	const octets = parseIpv4Octets(address);
	if (!octets) return null;
	return new Map(octets.map((octet, index) => [`{octet${index + 1}}`, String(octet)]));
}

export function applyPtrTemplate(template: string, address: string): string | null {
	const trimmed = template.trim();
	if (!trimmed) return null;

	const placeholders = ptrTemplatePlaceholders(address);
	if (!placeholders) return null;

	let result = trimmed;
	for (const [placeholder, value] of placeholders) {
		result = result.replaceAll(placeholder, value);
	}

	return isValidPtrHostname(result) ? result : null;
}

export function isValidPtrHostname(value: string) {
	if (value.length < 1 || value.length > 253) return false;
	return value.split('.').every((label) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
}
