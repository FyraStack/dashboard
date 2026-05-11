import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
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
