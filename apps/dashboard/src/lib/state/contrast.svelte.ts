import { MediaQuery } from 'svelte/reactivity';

// An inline script in src/app.html resolves this preference before first paint; keep it in sync.
export type ContrastPreference = 'auto' | 'on' | 'off';

export const contrastPreferenceStorageKey = 'contrast-preference';
const contrastAttribute = 'data-contrast';

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

	get systemPrefersMore() {
		return this.#system.current;
	}

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

	apply() {
		const root = document.documentElement;
		if (this.enabled) {
			root.setAttribute(contrastAttribute, 'more');
		} else {
			root.removeAttribute(contrastAttribute);
		}
	}

	syncFromStorage(event: StorageEvent) {
		if (event.key === contrastPreferenceStorageKey && isContrastPreference(event.newValue)) {
			this.preference = event.newValue;
		}
	}
}

export const contrast = new ContrastState();
