import { RpcTarget } from 'cloudflare:workers';
import { inScope, type Scope } from '#lib/server/context.js';
import {
	type CreateProjectInput,
	createProject,
	listProjects
} from '#lib/server/handlers/projects.js';

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
