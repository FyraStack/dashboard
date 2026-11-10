import { RpcTarget } from 'cloudflare:workers';
import type { Scope } from '#lib/server/context.js';
import {
	type CreateProjectInput,
	createProject,
	listProjects
} from '#lib/server/handlers/projects.js';
import { inScope } from '#lib/server/scope.js';

export class Projects extends RpcTarget {
	readonly #scope: Scope;

	constructor(scope: Scope) {
		super();
		this.#scope = scope;
	}

	list() {
		return inScope(this.#scope, () => listProjects());
	}

	create(input: CreateProjectInput) {
		return inScope(this.#scope, () => createProject(input));
	}
}
