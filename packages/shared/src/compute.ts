export const networkingModes = ['both', 'ipv6'] as const;

export type NetworkingMode = (typeof networkingModes)[number];

export const metricsTimeframes = ['hour', 'day', 'week', 'month', 'year'] as const;

export type MetricsTimeframe = (typeof metricsTimeframes)[number];

export const checksumAlgorithms = ['md5', 'sha1', 'sha224', 'sha256', 'sha384', 'sha512'] as const;

export type ChecksumAlgorithm = (typeof checksumAlgorithms)[number];

export const defaultIsa = 'x86' as const;
