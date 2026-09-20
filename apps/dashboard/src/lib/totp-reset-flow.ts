export type TotpResetFlowStep = 'email' | 'choice' | 'reset' | 'setup' | 'disable';

export type TotpResetUiChoice = 'reset-totp' | 'disable-totp';

export const TOTP_RESET_UI_CHOICES: TotpResetUiChoice[] = ['reset-totp', 'disable-totp'];

export const TOTP_RESET_FLOW_STEP_COUNT = 3;

export function totpResetStepNumber(step: TotpResetFlowStep): number {
	switch (step) {
		case 'email':
			return 1;
		case 'choice':
			return 2;
		case 'reset':
		case 'setup':
		case 'disable':
			return 3;
	}
}

export function totpResetStepLabel(step: TotpResetFlowStep): string {
	switch (step) {
		case 'email':
			return 'Verify your email';
		case 'choice':
			return 'Choose what to do';
		case 'reset':
			return 'Confirm your password';
		case 'setup':
			return 'Set up your authenticator';
		case 'disable':
			return 'Disable two-factor authentication';
	}
}

export function maskEmail(email: string): string {
	const at = email.indexOf('@');
	if (at <= 0) return email;
	const local = email.slice(0, at);
	const domain = email.slice(at);
	const visible = local.length > 2 ? local.slice(0, 2) : local.slice(0, 1);
	return `${visible}${'•'.repeat(Math.max(local.length - visible.length, 3))}${domain}`;
}
