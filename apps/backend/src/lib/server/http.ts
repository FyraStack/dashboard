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
