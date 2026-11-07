import type { FullAutoFill } from 'svelte/elements';

/** Autocomplete tokens for fields a password manager should fill. */
const credentialTokens = new Set([
	'username',
	'current-password',
	'new-password',
	'one-time-code',
	'webauthn'
]);

/**
 * Attributes that keep password managers away from a field, unless its
 * `autocomplete` marks it as a sign-in credential or `allow` is set. Most
 * dashboard fields name things (servers, volumes, networks, images), and
 * 1Password, Bitwarden, LastPass and Dashlane otherwise offer to fill a
 * person's name or a saved login into them.
 *
 * `allow` is for fields a password manager should fill but that have no
 * matching `autocomplete` token, like SSH public keys
 * (https://www.1password.dev/ssh/public-key-autofill).
 *
 * - 1Password: `data-1p-ignore` (https://www.1password.dev/web/compatible-website-design)
 * - Bitwarden: `data-bwignore`
 * - LastPass: `data-lpignore`
 * - Dashlane: `data-form-type="other"`
 */
export function autofillAttributes(
	autocomplete?: FullAutoFill | null,
	{ allow = false }: { allow?: boolean } = {}
) {
	const isCredential =
		typeof autocomplete === 'string' &&
		autocomplete.split(/\s+/).some((token) => credentialTokens.has(token));
	if (allow || isCredential) return { autocomplete: autocomplete ?? undefined };
	return {
		autocomplete: autocomplete ?? ('off' as const),
		'data-1p-ignore': '',
		'data-bwignore': '',
		'data-lpignore': 'true',
		'data-form-type': 'other'
	};
}
