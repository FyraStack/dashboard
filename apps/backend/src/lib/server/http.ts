export const HTTP_ERROR_PREFIX = 'stack-http-error:';

export class HttpError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = 'HttpError';
		this.status = status;
	}
}

export function error(status: number, message: string): never {
	throw new HttpError(status, message);
}

export function isHttpError(value: unknown): value is HttpError {
	return value instanceof HttpError;
}

export function encodeHttpError({ status, message }: HttpError): Error {
	return new Error(`${HTTP_ERROR_PREFIX}${JSON.stringify({ status, message })}`);
}

export function decodeHttpError(value: unknown): { status: number; message: string } | null {
	if (!(value instanceof Error)) {
		return null;
	}

	const start = value.message.indexOf(HTTP_ERROR_PREFIX);
	if (start === -1) {
		return null;
	}

	try {
		const decoded: unknown = JSON.parse(value.message.slice(start + HTTP_ERROR_PREFIX.length));
		if (
			typeof decoded === 'object' &&
			decoded !== null &&
			'status' in decoded &&
			'message' in decoded &&
			typeof decoded.status === 'number' &&
			typeof decoded.message === 'string'
		) {
			return { status: decoded.status, message: decoded.message };
		}
	} catch {
		return null;
	}

	return null;
}
