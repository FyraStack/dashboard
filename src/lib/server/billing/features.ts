import type { billingResourceTypeEnum, vmTypes } from '$lib/server/db/schema';

export const VOLUME_GIB_HOURS_FEATURE_ID = 'volume_gib_hours';

export type BillingResourceType = (typeof billingResourceTypeEnum.enumValues)[number];

type VmType = typeof vmTypes.$inferSelect;

export function requireVmFeatureId(vmType: Pick<VmType, 'name' | 'autumnFeatureId'>) {
	if (!vmType.autumnFeatureId) {
		throw new Error(`VM type "${vmType.name}" is missing an Autumn feature ID`);
	}

	return vmType.autumnFeatureId;
}

export function hoursBetween(start: number, end: number) {
	return Math.max(0, (end - start) / 3_600_000);
}

export function usageQuantity(units: number | string, periodStart: number, periodEnd: number) {
	const quantity = Number(units) * hoursBetween(periodStart, periodEnd);

	return Number(quantity.toFixed(6));
}

export function usageIdempotencyKey(input: {
	resourceType: BillingResourceType;
	resourceId: string;
	featureId: string;
	units: number | string;
	periodStart: number;
	periodEnd: number;
}) {
	return [
		input.resourceType,
		input.resourceId,
		input.featureId,
		input.units,
		input.periodStart,
		input.periodEnd
	].join(':');
}
