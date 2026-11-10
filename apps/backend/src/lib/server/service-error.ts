function stringifyErrorDetails(details: unknown): string {
	try {
		return JSON.stringify(details);
	} catch {
		return 'Unable to stringify details';
	}
}

export interface ServiceErrorOptions extends ErrorOptions {
	details: unknown;
	status: number;
}

export class ServiceError extends Error {
	readonly status: number;
	readonly details: unknown;

	constructor(message: string, options: ServiceErrorOptions) {
		const { status, details } = options;
		super(`${message} - ${status} - ${stringifyErrorDetails(details)}`, options);
		this.status = status;
		this.details = details;
	}
}
