import type { billingResourceTypeEnum, vmTypes } from '#lib/server/db/schema.js';

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

export function estimatedCost(hours: number, ratePerHour: number) {
	return Number((hours * ratePerHour).toFixed(2));
}

export function billedQuantity(units: number | string, billableHours: number) {
	const quantity = Number(units) * Math.max(0, billableHours);

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

export function reversalIdempotencyKey(input: Parameters<typeof usageIdempotencyKey>[0]) {
	return [
		'reversal',
		input.resourceType,
		input.resourceId,
		input.featureId,
		input.periodStart,
		input.periodEnd,
		input.units
	].join(':');
}
