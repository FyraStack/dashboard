import { hoursBetween } from './features';

export type CapPeriod = { start: number; end: number };

export type CapMeterState = {
	capPeriodStart: number | null;
	capPeriodEnd: number | null;
	hoursThisPeriod: number | string;
};

export type CapSegment = {
	periodStart: number;
	periodEnd: number;
	billableHours: number;
	capped: boolean;
};

export function capHoursFor(
	rate: number | string | null | undefined,
	cap: number | string | null | undefined
) {
	const rateValue = Number(rate);
	const capValue = Number(cap);
	if (!Number.isFinite(rateValue) || rateValue <= 0) return Infinity;
	if (!Number.isFinite(capValue) || capValue <= 0) return Infinity;

	return capValue / rateValue;
}

export function calendarMonthPeriod(at: number): CapPeriod {
	const date = new Date(at);
	return {
		start: Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1),
		end: Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)
	};
}

const DAY_MS = 86_400_000;
const AVERAGE_MONTH_MS = 30.44 * DAY_MS;

function isMonthlyLength(length: number) {
	return length >= 28 * DAY_MS && length <= 31 * DAY_MS;
}

function addUtcMonths(at: number, months: number) {
	const date = new Date(at);
	const day = date.getUTCDate();
	const shifted = new Date(
		Date.UTC(
			date.getUTCFullYear(),
			date.getUTCMonth() + months,
			1,
			date.getUTCHours(),
			date.getUTCMinutes(),
			date.getUTCSeconds(),
			date.getUTCMilliseconds()
		)
	);
	const lastDay = new Date(
		Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0)
	).getUTCDate();
	shifted.setUTCDate(Math.min(day, lastDay));
	return shifted.getTime();
}

export function billingCyclePeriod(anchor: CapPeriod, at: number): CapPeriod {
	const length = anchor.end - anchor.start;
	if (length <= 0) return calendarMonthPeriod(at);
	if (at >= anchor.start && at < anchor.end) return { start: anchor.start, end: anchor.end };

	if (!isMonthlyLength(length)) {
		const cycles = Math.floor((at - anchor.start) / length);
		const start = anchor.start + cycles * length;
		return { start, end: start + length };
	}

	let cycles = Math.round((at - anchor.start) / AVERAGE_MONTH_MS);
	while (addUtcMonths(anchor.start, cycles) > at) cycles -= 1;
	while (addUtcMonths(anchor.start, cycles + 1) <= at) cycles += 1;

	return {
		start: addUtcMonths(anchor.start, cycles),
		end: addUtcMonths(anchor.start, cycles + 1)
	};
}

export function sliceCapUsage(input: {
	from: number;
	to: number;
	capHours: number;
	state: CapMeterState;
	periodAt: (at: number) => CapPeriod;
}) {
	const segments: CapSegment[] = [];
	let periodStart = input.state.capPeriodStart;
	let periodEnd = input.state.capPeriodEnd;
	let hours = Number(input.state.hoursThisPeriod);
	if (!Number.isFinite(hours) || hours < 0) hours = 0;

	let cursor = input.from;
	while (cursor < input.to) {
		if (periodStart == null || periodEnd == null || cursor >= periodEnd) {
			const period = input.periodAt(cursor);
			periodStart = period.start;
			periodEnd = Math.max(period.end, cursor + 1);
			hours = 0;
		}

		const segmentEnd = Math.min(input.to, periodEnd);
		const elapsed = hoursBetween(cursor, segmentEnd);
		const billableHours = Math.min(elapsed, Math.max(0, input.capHours - hours));
		segments.push({
			periodStart: cursor,
			periodEnd: segmentEnd,
			billableHours,
			capped: billableHours < elapsed
		});

		hours += elapsed;
		cursor = segmentEnd;
	}

	return {
		segments,
		state: {
			capPeriodStart: periodStart,
			capPeriodEnd: periodEnd,
			hoursThisPeriod: hours
		}
	};
}
