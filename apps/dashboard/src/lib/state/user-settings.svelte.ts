import type { ReadonlyURL } from '$app/state';

export type UserSettingsTab = 'profile' | 'security' | 'keys' | 'api' | 'appearance';

const queryParam = 'user-settings';

export function parseUserSettingsTab(value: string | null): UserSettingsTab | null {
	switch (value) {
		case 'profile':
		case 'account':
			return 'profile';
		case 'security':
		case 'password':
		case 'change-password':
			return 'security';
		case 'keys':
		case 'ssh':
		case 'ssh-keys':
			return 'keys';
		case 'api':
		case 'api-tokens':
			return 'api';
		case 'appearance':
		case 'theme':
			return 'appearance';
		default:
			return null;
	}
}

export function userSettingsHref(tab: UserSettingsTab, url: ReadonlyURL): string {
	const next = new URL(url.href);
	next.searchParams.set(queryParam, tab);
	return `${next.pathname}${next.search}${next.hash}`;
}

export function clearUserSettingsHref(url: ReadonlyURL): string {
	const next = new URL(url.href);
	next.searchParams.delete(queryParam);
	return `${next.pathname}${next.search}${next.hash}`;
}

export class UserSettingsState {
	open = $state(false);
	tab = $state<UserSettingsTab>('profile');

	show(tab: UserSettingsTab = 'profile') {
		this.tab = tab;
		this.open = true;
	}

	hide() {
		this.open = false;
	}

	syncFromUrl(url: ReadonlyURL) {
		const tab = parseUserSettingsTab(url.searchParams.get(queryParam));
		if (!tab) {
			return;
		}

		this.show(tab);
	}

	urlHasSettingsTab(url: ReadonlyURL) {
		return parseUserSettingsTab(url.searchParams.get(queryParam)) !== null;
	}
}
