import { getVmBillingUsage, type VmBillingUsage } from '#lib/remote/admin-billing.remote.js';
import { getErrorMessage } from '#lib/utils.js';

export function currentMonthStart() {
	const now = new Date();
	return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
}

export class BilledUsage {
	usage = $state<VmBillingUsage | null>(null);
	loading = $state(false);
	error = $state('');
	#request = 0;

	reset() {
		this.#request += 1;
		this.usage = null;
		this.loading = false;
		this.error = '';
	}

	async load(vmId: string, periodStart: number, periodEnd: number) {
		this.#request += 1;
		const request = this.#request;
		this.loading = true;
		this.error = '';
		this.usage = null;
		try {
			const query = getVmBillingUsage({ vmId, periodStart, periodEnd });
			await query.refresh();
			const result = await query;
			if (request === this.#request) {
				this.usage = result;
			}
		} catch (err) {
			if (request === this.#request) {
				this.error = getErrorMessage(err, 'Failed to load billed usage');
			}
		} finally {
			if (request === this.#request) {
				this.loading = false;
			}
		}
	}
}
