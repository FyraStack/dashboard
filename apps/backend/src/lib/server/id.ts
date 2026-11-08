import { ulid as generateUlid } from 'ulid';

export function ulid(): string {
	return generateUlid();
}
