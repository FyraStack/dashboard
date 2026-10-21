import { MediaQuery } from 'svelte/reactivity';

/**
 * High contrast preference.
 *
 * - `auto` follows the OS/browser `prefers-contrast: more` setting (default)
 * - `on` / `off` force it
 *
 * The effective value is reflected as `data-contrast="more"` on `<html>`, which
 * the CSS (and the `high-contrast:` variant) keys off. An inline script in
 * `src/app.html` resolves it before first paint; keep it in sync with this file.
 */
export type ContrastPreference = 'auto' | 'on' | 'off';

export const contrastPreferenceStorageKey = 'contrast-preference';
export const contrastAttribute = 'data-contrast';

function isContrastPreference(value: unknown): value is ContrastPreference {
	return value === 'auto' || value === 'on' || value === 'off';
}

function readPreference(): ContrastPreference {
	if (typeof localStorage === 'undefined') {
		return 'auto';
	}
	try {
		const stored = localStorage.getItem(contrastPreferenceStorageKey);
		return isContrastPreference(stored) ? stored : 'auto';
	} catch {
		return 'auto';
	}
}

class ContrastState {
	readonly #system = new MediaQuery('prefers-contrast: more', false);

	preference = $state<ContrastPreference>(readPreference());

	/** Whether the system currently asks for more contrast. */
	get systemPrefersMore() {
		return this.#system.current;
	}

	/** Whether high contrast is actually in effect. */
	get enabled() {
		return this.preference === 'on' || (this.preference === 'auto' && this.#system.current);
	}

	setPreference(preference: ContrastPreference) {
		this.preference = preference;
		try {
			localStorage.setItem(contrastPreferenceStorageKey, preference);
		} catch {
			// Storage unavailable (private mode etc.); preference lasts for this session.
		}
	}

	/** Reflect the effective value onto the document. Call from an effect. */
	apply() {
		const root = document.documentElement;
		if (this.enabled) {
			root.setAttribute(contrastAttribute, 'more');
		} else {
			root.removeAttribute(contrastAttribute);
		}
	}

	/** Pick up preference changes made in other tabs. */
	syncFromStorage(event: StorageEvent) {
		if (event.key === contrastPreferenceStorageKey && isContrastPreference(event.newValue)) {
			this.preference = event.newValue;
		}
	}
}

export const contrast = new ContrastState();
