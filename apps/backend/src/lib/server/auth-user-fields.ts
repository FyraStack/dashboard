export const userAdditionalFields = {
	isAdmin: {
		type: 'boolean',
		input: false,
		required: true,
		defaultValue: false
	},
	billingExempt: {
		type: 'boolean',
		input: false,
		required: true,
		defaultValue: false
	}
} as const;
