// Promise-based replacement for window.confirm, rendered as a styled dialog.
// Deletes pass `confirmWord` to require typing the resource name before the
// action is enabled. A single <ConfirmDialog /> host (mounted in the app
// layout) reads this controller and drives the dialog with bind:open.

type ConfirmRequest = {
	title: string;
	description: string;
	confirmLabel: string;
	confirmWord?: string;
};

class ConfirmController {
	open = $state(false);
	request = $state<ConfirmRequest | null>(null);
	#resolve: ((ok: boolean) => void) | null = null;

	ask(opts: ConfirmRequest): Promise<boolean> {
		// Resolve any in-flight request as cancelled before replacing it.
		this.#resolve?.(false);
		return new Promise<boolean>((resolve) => {
			this.#resolve = resolve;
			this.request = opts;
			this.open = true;
		});
	}

	// Resolve the pending promise. Idempotent — the host also calls this when
	// the dialog is dismissed (Esc/overlay), by which point it may already be
	// resolved by a button click.
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
