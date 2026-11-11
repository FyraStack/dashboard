const mediumDate = new Intl.DateTimeFormat('en', { dateStyle: 'medium' });
const longDate = new Intl.DateTimeFormat('en', { dateStyle: 'long' });
const mediumDateTime = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });
const usd = new Intl.NumberFormat('en', { style: 'currency', currency: 'USD' });
const decimal = new Intl.NumberFormat('en', { maximumFractionDigits: 2 });

export function formatDate(value: number | Date): string {
	return mediumDate.format(new Date(value));
}

export function formatLongDate(value: number | Date): string {
	return longDate.format(new Date(value));
}

export function formatIsoDate(value: number | Date): string {
	return new Date(value).toISOString().slice(0, 10);
}

export function formatDateTime(value: number | Date): string {
	return mediumDateTime.format(new Date(value));
}

export function formatUsd(value: number): string {
	return usd.format(value);
}

export function formatCurrency(value: number, currency: string): string {
	const code = currency.toUpperCase();
	try {
		return new Intl.NumberFormat('en', { style: 'currency', currency: code }).format(value);
	} catch {
		return `${value} ${code}`;
	}
}

export function formatDecimal(value: number): string {
	return decimal.format(value);
}

export function formatPercent(fraction: number): string {
	return `${Math.round(fraction * 100)}%`;
}

export function formatBytes(bytes: number): string {
	if (!bytes) {
		return '0B';
	}
	const gb = bytes / 1024 ** 3;
	if (gb >= 1) {
		return `${gb.toFixed(0)}GB`;
	}
	return `${(bytes / 1024 ** 2).toFixed(0)}MB`;
}

export function formatFileSize(bytes: number): string {
	const mb = bytes / 1024 ** 2;
	if (mb >= 1024) {
		return `${(mb / 1024).toFixed(1)} GB`;
	}
	return `${mb.toFixed(0)} MB`;
}

export function formatMegabytes(megabytes: number): string {
	return formatBytes(megabytes * 1024 ** 2);
}

export function bytesToGib(bytes: number): number {
	return bytes / 1024 ** 3;
}

export function formatGibibytes(bytes: number): string {
	return `${bytesToGib(bytes).toFixed(1)} GiB`;
}

export function initials(name: string): string {
	return name
		.split(' ')
		.map((word) => word[0])
		.join('')
		.slice(0, 2)
		.toUpperCase();
}

export function formatUptime(seconds: number): string | null {
	if (seconds <= 0) {
		return null;
	}
	const days = Math.floor(seconds / 86_400);
	const hours = Math.floor((seconds % 86_400) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	return `${days}d ${hours}h ${minutes}m`;
}

type NetworkInterfaces = Record<string, { ipAddresses?: string[] | null }> | null | undefined;

function firstAddress(interfaces: NetworkInterfaces, match: (address: string) => boolean) {
	return (
		Object.values(interfaces ?? {})
			.flatMap((networkInterface) => networkInterface.ipAddresses ?? [])
			.find((address) => address && match(address)) ?? null
	);
}

export function firstIpv4(interfaces: NetworkInterfaces): string | null {
	return firstAddress(
		interfaces,
		(address) => !(address.startsWith('127.') || address.includes(':'))
	);
}

export function firstIpv6(interfaces: NetworkInterfaces): string | null {
	return firstAddress(interfaces, (address) => address.includes(':'));
}
