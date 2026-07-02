import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { RemoteQuery } from '@sveltejs/kit';

type ClientTimingAttributes = Record<string, string | number | boolean | undefined>;

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

function roundMs(value: number): number {
	return Math.round(value * 100) / 100;
}

export function clientTimingLog(name: string, attributes?: ClientTimingAttributes) {
	if (typeof window === 'undefined') return;

	console.info({
		message: `[timing] ${name}`,
		timing: {
			name,
			timestamp: new Date().toISOString(),
			'client.now_ms': roundMs(performance.now()),
			...attributes
		}
	});
}

export async function runQuery<T>(query: RemoteQuery<T>, label = 'remote.query'): Promise<T> {
	const started = performance.now();
	clientTimingLog('remote.query.refresh.start', { 'remote.query': label });
	await query.refresh();
	clientTimingLog('remote.query.refresh.end', {
		'remote.query': label,
		duration_ms: roundMs(performance.now() - started)
	});

	const awaitStarted = performance.now();
	const result = await query;
	clientTimingLog('remote.query.await.end', {
		'remote.query': label,
		duration_ms: roundMs(performance.now() - awaitStarted),
		total_duration_ms: roundMs(performance.now() - started)
	});
	return result;
}

export function getErrorMessage(err: unknown, fallback: string): string {
	if (typeof err === 'string') return err;
	if (err instanceof Error) return err.message;
	if (typeof err === 'object' && err !== null) {
		if ('message' in err) return String((err as { message: unknown }).message);
		if (
			'body' in err &&
			typeof (err as { body: unknown }).body === 'object' &&
			(err as { body: unknown }).body !== null
		) {
			const body = (err as { body: Record<string, unknown> }).body;
			if ('message' in body) return String(body.message);
		}
	}
	return fallback;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChild<T> = T extends { child?: any } ? Omit<T, 'child'> : T;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChildren<T> = T extends { children?: any } ? Omit<T, 'children'> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };
