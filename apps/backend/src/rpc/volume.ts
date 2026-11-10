import { RpcTarget } from 'cloudflare:workers';
import type { Scope } from '#lib/server/context.js';
import {
	type AttachVolumeInput,
	attachVolume,
	deleteVolume,
	detachVolume
} from '#lib/server/handlers/volumes.js';
import { inScope } from '#lib/server/scope.js';

export class Volume extends RpcTarget {
	readonly #scope: Scope;
	readonly #id: string;

	constructor(scope: Scope, id: string) {
		super();
		this.#scope = scope;
		this.#id = id;
	}

	delete() {
		return inScope(this.#scope, () => deleteVolume({ volumeId: this.#id }));
	}

	attach(input: Omit<AttachVolumeInput, 'volumeId'>) {
		return inScope(this.#scope, () => attachVolume({ ...input, volumeId: this.#id }));
	}

	detach() {
		return inScope(this.#scope, () => detachVolume({ volumeId: this.#id }));
	}
}
