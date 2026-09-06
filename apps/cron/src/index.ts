interface Env {
	DASHBOARD: Fetcher;
	INTERNAL_CRON_SECRET: string;
	BILLING_DISABLED?: string;
}

const METER_PATH = '/api/internal/billing/meter';
const IPAM_RECONCILE_PATH = '/api/internal/ipam/reconcile';

async function runInternalCronRoute(env: Env, path: string, label: string): Promise<void> {
	const response = await env.DASHBOARD.fetch(`https://dashboard.internal${path}`, {
		method: 'POST',
		headers: { authorization: `Bearer ${env.INTERNAL_CRON_SECRET}` }
	});

	const body = await response.text();
	if (!response.ok) {
		throw new Error(`${label} failed: ${response.status} ${response.statusText} ${body}`);
	}

	console.log(`${label} ok: ${body}`);
}

function billingDisabled(env: Env) {
	return env.BILLING_DISABLED === 'true';
}

export default {
	async scheduled(_event, env, ctx): Promise<void> {
		if (billingDisabled(env)) {
			console.warn('billing meter skipped: BILLING_DISABLED is true');
		} else {
			ctx.waitUntil(runInternalCronRoute(env, METER_PATH, 'billing meter'));
		}
		ctx.waitUntil(runInternalCronRoute(env, IPAM_RECONCILE_PATH, 'ipam reconcile'));
	},
	async fetch(): Promise<Response> {
		return new Response('stack-dashboard-cron: billing meter worker', { status: 200 });
	}
} satisfies ExportedHandler<Env>;
