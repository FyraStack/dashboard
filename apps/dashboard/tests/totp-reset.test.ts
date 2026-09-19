import { expect, test } from '@playwright/test';
import {
	TOTP_RESET_CODE_LENGTH,
	TOTP_RESET_CODE_TTL_MS,
	TOTP_RESET_GRANT_TTL_MS,
	generateTotpResetCode,
	hashTotpResetCode,
	normalizeTotpResetChoice,
	normalizeTotpResetCode,
	totpResetCodeIdentifier,
	totpResetGrantIdentifier
} from '../src/lib/server/totp-reset';
import {
	TOTP_RESET_FLOW_STEP_COUNT,
	TOTP_RESET_UI_CHOICES,
	totpResetStepLabel,
	totpResetStepNumber
} from '../src/lib/totp-reset-flow';

test('totp reset code length and lifetimes match the email code conventions', () => {
	expect(TOTP_RESET_CODE_LENGTH).toBe(6);
	expect(TOTP_RESET_CODE_TTL_MS).toBe(10 * 60 * 1000);
	expect(TOTP_RESET_GRANT_TTL_MS).toBe(10 * 60 * 1000);
});

test('totp reset codes normalize to digits only', () => {
	expect(normalizeTotpResetCode('123 456')).toBe('123456');
	expect(normalizeTotpResetCode('a1b2c3')).toBe('123');
	expect(normalizeTotpResetCode('')).toBe('');
});

test('totp reset choices accept reset and disable spellings', () => {
	expect(normalizeTotpResetChoice('reset')).toBe('reset');
	expect(normalizeTotpResetChoice('reset-totp')).toBe('reset');
	expect(normalizeTotpResetChoice('disable')).toBe('disable');
	expect(normalizeTotpResetChoice('disable-totp')).toBe('disable');
	expect(normalizeTotpResetChoice('totp')).toBeNull();
	expect(normalizeTotpResetChoice('')).toBeNull();
});

test('totp reset storage identifiers are scoped per user and purpose', () => {
	expect(totpResetCodeIdentifier('user-1')).toBe('totp-reset:user-1');
	expect(totpResetGrantIdentifier('user-1')).toBe('totp-reset-verified:user-1');
	expect(totpResetCodeIdentifier('user-1')).not.toBe(totpResetCodeIdentifier('user-2'));
	expect(totpResetCodeIdentifier('user-1')).not.toBe(totpResetGrantIdentifier('user-1'));
});

test('totp reset code hashes are stable per user and opaque', async () => {
	const first = await hashTotpResetCode('user-1', '123456');
	const second = await hashTotpResetCode('user-1', '123456');

	expect(first).toBe(second);
	expect(first).toMatch(/^[0-9a-f]{64}$/);
	expect(first).not.toContain('123456');
	expect(await hashTotpResetCode('user-2', '123456')).not.toBe(first);
	expect(await hashTotpResetCode('user-1', '654321')).not.toBe(first);
});

test('generated totp reset codes are six digits', () => {
	for (let i = 0; i < 25; i += 1) {
		expect(generateTotpResetCode()).toMatch(/^[0-9]{6}$/);
	}
});

test('totp reset ui choices round-trip through server normalization', () => {
	expect(TOTP_RESET_UI_CHOICES).toEqual(['reset-totp', 'disable-totp']);
	expect(TOTP_RESET_UI_CHOICES.map(normalizeTotpResetChoice)).toEqual(['reset', 'disable']);
});

test('totp reset flow exposes email, choice, and finish steps in order', () => {
	const steps = ['email', 'choice', 'reset', 'setup', 'disable'] as const;

	expect(TOTP_RESET_FLOW_STEP_COUNT).toBe(3);
	expect(steps.map(totpResetStepNumber)).toEqual([1, 2, 3, 3, 3]);

	for (const step of steps) {
		expect(totpResetStepLabel(step).length).toBeGreaterThan(0);
	}

	expect(new Set(steps.map(totpResetStepLabel)).size).toBe(steps.length);
});
