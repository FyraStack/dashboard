const COPIED_RESET_MS = 1500;

export class Clipboard {
	copiedKey = $state<string | null>(null);
	#resetTimeout: ReturnType<typeof setTimeout> | undefined;

	async copy(text: string, key: string = text): Promise<boolean> {
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			return false;
		}
		this.copiedKey = key;
		clearTimeout(this.#resetTimeout);
		this.#resetTimeout = setTimeout(() => {
			this.copiedKey = null;
		}, COPIED_RESET_MS);
		return true;
	}
}
