interface Env {
	DASHBOARD: Fetcher;
	BILLING_METER_SECRET: string;
}

const METER_PATH = '/api/internal/billing/meter';

async function runBillingMeter(env: Env): Promise<void> {
	const response = await env.DASHBOARD.fetch(`https://dashboard.internal${METER_PATH}`, {
		method: 'POST',
		headers: { authorization: `Bearer ${env.BILLING_METER_SECRET}` }
	});

	const body = await response.text();
	if (!response.ok) {
		throw new Error(`billing meter failed: ${response.status} ${response.statusText} ${body}`);
	}

	console.log(`billing meter ok: ${body}`);
}

export default {
	async scheduled(_event, env, ctx): Promise<void> {
		ctx.waitUntil(runBillingMeter(env));
	},
	async fetch(): Promise<Response> {
		return new Response('stack-dashboard-cron: billing meter worker', { status: 200 });
	}
} satisfies ExportedHandler<Env>;
