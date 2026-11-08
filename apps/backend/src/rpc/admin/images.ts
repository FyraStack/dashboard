import { RpcTarget } from 'cloudflare:workers';
import { inScope, type Scope } from '#lib/server/context.js';
import {
	type CreateImageInput,
	createImage,
	type DeleteImageInput,
	deleteImage,
	type GetProxmoxTaskStatusInput,
	getProxmoxTaskStatus,
	type ImportProxmoxImageFromUrlInput,
	importProxmoxImageFromUrl,
	listProxmoxImageImportTargets,
	listProxmoxImages,
	type ReorderImagesInput,
	reorderImages,
	type UpdateImageInput,
	updateImage
} from '#lib/server/handlers/images.js';

export class AdminImages extends RpcTarget {
	readonly #scope: Scope;

	constructor(scope: Scope) {
		super();
		this.#scope = scope;
	}

	create(input: CreateImageInput) {
		return inScope(this.#scope, () => createImage(input));
	}

	update(input: UpdateImageInput) {
		return inScope(this.#scope, () => updateImage(input));
	}

	reorder(input: ReorderImagesInput) {
		return inScope(this.#scope, () => reorderImages(input));
	}

	delete(input: DeleteImageInput) {
		return inScope(this.#scope, () => deleteImage(input));
	}

	listProxmox() {
		return inScope(this.#scope, () => listProxmoxImages());
	}

	listImportTargets() {
		return inScope(this.#scope, () => listProxmoxImageImportTargets());
	}

	importFromUrl(input: ImportProxmoxImageFromUrlInput) {
		return inScope(this.#scope, () => importProxmoxImageFromUrl(input));
	}

	taskStatus(input: GetProxmoxTaskStatusInput) {
		return inScope(this.#scope, () => getProxmoxTaskStatus(input));
	}
}
