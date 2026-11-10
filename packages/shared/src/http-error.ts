const HTTP_ERROR_PREFIX = 'stack-http-error:';

export interface HttpErrorPayload {
	message: string;
	status: number;
}

export function encodeHttpError({ status, message }: HttpErrorPayload): Error {
	return new Error(`${HTTP_ERROR_PREFIX}${JSON.stringify({ status, message })}`);
}

export function decodeHttpError(value: unknown): HttpErrorPayload | null {
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
