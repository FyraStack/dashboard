import { RpcTarget } from 'cloudflare:workers';
import { context, inScope, type Scope } from '#lib/server/context.js';

export class Caller extends RpcTarget {
	readonly #scope: Scope;

	constructor(scope: Scope) {
		super();
		this.#scope = scope;
	}

	session() {
		return inScope(this.#scope, () => {
			const { session, user } = context().locals;
			return session && user ? { session, user } : null;
		});
	}
}
