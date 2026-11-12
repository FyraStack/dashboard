interface ConfirmRequest {
	confirmLabel: string;
	confirmWord?: string;
	description: string;
	title: string;
}

class ConfirmController {
	open = $state(false);
	request = $state<ConfirmRequest | null>(null);
	#resolve: ((ok: boolean) => void) | null = null;

	ask(opts: ConfirmRequest): Promise<boolean> {
		this.#resolve?.(false);
		return new Promise<boolean>((resolve) => {
			this.#resolve = resolve;
			this.request = opts;
			this.open = true;
		});
	}

	resolve(ok: boolean) {
		const resolve = this.#resolve;
		this.#resolve = null;
		resolve?.(ok);
	}
}

export const confirmController = new ConfirmController();

export function confirmDestructive(opts: {
	title: string;
	description: string;
	confirmLabel?: string;
	confirmWord?: string;
}): Promise<boolean> {
	return confirmController.ask({ confirmLabel: 'Delete', ...opts });
}
