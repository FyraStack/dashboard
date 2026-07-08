import { dev } from '$app/environment';
import { getRequestEvent } from '$app/server';
import { env as privateEnv } from '$env/dynamic/private';

type SpanAttributes = Record<string, string | number | boolean | undefined>;

type TraceSpan = {
	setAttribute(key: string, value: string | number | boolean | undefined): void;
};

type TracingApi = {
	enterSpan<T>(name: string, callback: (span: TraceSpan) => T): T;
};

let tracingLoader: Promise<TracingApi | null> | undefined;

function roundMs(value: number): number {
	return Math.round(value * 100) / 100;
}

function timingLogsEnabled(): boolean {
	let value: string | undefined;
	try {
		value = getRequestEvent().platform?.env?.STACK_TIMING_SPAM;
	} catch {}
	value ??= privateEnv.STACK_TIMING_SPAM;
	return value === undefined ? dev : value === 'true';
}

export function timingLog(name: string, attributes?: SpanAttributes) {
	if (!timingLogsEnabled()) return;

	console.info({
		message: `[timing] ${name}`,
		timing: {
			name,
			timestamp: new Date().toISOString(),
			...attributes
		}
	});
}

function loadTracing(): Promise<TracingApi | null> {
	if (tracingLoader === undefined) {
		const moduleName: string = 'cloudflare:workers';
		tracingLoader = import(moduleName)
			.then((module) => (module as { tracing?: TracingApi }).tracing ?? null)
			.catch(() => null);
	}
	return tracingLoader;
}

function applyAttributes(span: TraceSpan, attributes?: SpanAttributes) {
	if (!attributes) return;
	for (const [key, value] of Object.entries(attributes)) {
		span.setAttribute(key, value);
	}
}

export async function instrument<T>(
	name: string,
	operation: () => T | Promise<T>,
	attributes?: SpanAttributes
): Promise<T> {
	const tracingStart = performance.now();
	const tracing = await loadTracing();
	const tracingMs = roundMs(performance.now() - tracingStart);
	if (tracingMs > 5) {
		timingLog('observability.loadTracing', {
			'observability.span': name,
			duration_ms: tracingMs
		});
	}

	const started = performance.now();
	timingLog(`${name}.start`, attributes);

	try {
		const run = () => operation();
		const result = tracing
			? await tracing.enterSpan(name, (span) => {
					applyAttributes(span, attributes);
					return run();
				})
			: await run();
		timingLog(`${name}.end`, {
			...attributes,
			duration_ms: roundMs(performance.now() - started)
		});
		return result;
	} catch (error) {
		timingLog(`${name}.error`, {
			...attributes,
			duration_ms: roundMs(performance.now() - started),
			'error.name': error instanceof Error ? error.name : typeof error
		});
		throw error;
	}
}

export function summarizeStatement(statement: string | undefined): string | undefined {
	if (!statement) return undefined;
	return statement.replace(/\s+/g, ' ').trim().slice(0, 120);
}
