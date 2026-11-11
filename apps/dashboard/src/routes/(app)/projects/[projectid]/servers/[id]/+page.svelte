<script lang="ts">
	import { Clipboard } from '#lib/clipboard.svelte.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { formatPercent } from '#lib/format.js';
	import { getVmMetricsHistory } from '#lib/remote/vms.remote.js';
	import { primaryAddress } from '#lib/server-info.js';
	import { serversState } from '#lib/state/servers.svelte.js';
	import { browser } from '$app/env';
	import Check from '~icons/lucide/check';
	import AlertTriangle from '~icons/nucleo/alert-triangle';
	import Copy from '~icons/nucleo/copy';
	import FileText from '~icons/nucleo/file-text';
	import Terminal from '~icons/nucleo/terminal';
	import Trash2 from '~icons/nucleo/trash';
	import type { PageProps } from './$types';
	import { useServer } from './lib/server-context';

	let { data }: PageProps = $props();
	const server = useServer();
	let sshAddress = $derived(primaryAddress(server.current));
	const clipboard = new Clipboard();
	let liveLoaded = $derived(server.current.liveLoaded || serversState.firstStatusRefreshComplete);
	const metricsHistory = $derived(
		browser ? getVmMetricsHistory({ vmId: data.serverId, timeframe: 'hour' }) : null
	);

	interface ChartSample {
		bandwidth: number | null;
		cpu: number | null;
		diskIo: number | null;
		memory: number | null;
		time?: number;
	}

	let liveChartSamplesByServer = $state<Record<string, ChartSample[]>>({});
	let lastSampleKeyByServer = $state<Record<string, string>>({});

	function formatBytesPerSecond(bytes: number) {
		const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
		let value = bytes;
		let unit = 0;
		while (value >= 1024 && unit < units.length - 1) {
			value /= 1024;
			unit += 1;
		}
		return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
	}

	function formatOptional(value: number | null, format: (value: number) => string) {
		return value === null ? '-' : format(value);
	}

	function buildPoints(
		values: (number | null)[],
		maxValue = Math.max(...values.map((v) => v ?? 0), 1)
	) {
		const points = values.filter((value): value is number => value !== null);

		return points
			.map((value, index) => {
				const x = (index / Math.max(points.length - 1, 1)) * 240;
				const y = 80 - (value / maxValue) * 70;

				return `${x.toFixed(1)},${Math.max(5, Math.min(75, y)).toFixed(1)}`;
			})
			.join(' ');
	}

	function serverMetricsSample(): ChartSample | null {
		if (!server.current.liveLoaded) {
			return null;
		}
		const { metrics } = server.current;
		return {
			cpu: metrics?.cpu ?? null,
			memory: metrics?.memory ?? null,
			bandwidth: null,
			diskIo: null,
			time: Math.floor(Date.now() / 1000)
		};
	}

	function sampleKey(sample: ChartSample) {
		return JSON.stringify({
			cpu: sample.cpu,
			memory: sample.memory,
			bandwidth: sample.bandwidth,
			diskIo: sample.diskIo
		});
	}

	$effect(() => {
		const sample = serverMetricsSample();
		if (!sample) {
			return;
		}
		const key = sampleKey(sample);
		if (lastSampleKeyByServer[server.current.id] === key) {
			return;
		}

		lastSampleKeyByServer[server.current.id] = key;
		liveChartSamplesByServer[server.current.id] = [
			...(liveChartSamplesByServer[server.current.id] ?? []),
			sample
		].slice(-12);
	});

	let charts = $derived.by(() => {
		const history = server.current.id === data.serverId ? (metricsHistory?.current ?? []) : [];
		const liveSamples = liveChartSamplesByServer[server.current.id] ?? [];
		const currentSample = serverMetricsSample();
		const lastLiveSample = liveSamples.at(-1);
		const samples = [
			...history,
			...liveSamples,
			...(currentSample &&
			(!lastLiveSample || sampleKey(currentSample) !== sampleKey(lastLiveSample))
				? [currentSample]
				: [])
		].slice(-12);
		const lastValue = (key: 'cpu' | 'memory' | 'bandwidth' | 'diskIo') => {
			for (let index = samples.length - 1; index >= 0; index -= 1) {
				const value = samples[index][key];
				if (typeof value === 'number') {
					return value;
				}
			}
			return null;
		};
		const bandwidthMax = Math.max(...samples.map((sample) => sample.bandwidth ?? 0), 1);
		const diskIoMax = Math.max(...samples.map((sample) => sample.diskIo ?? 0), 1);
		const loaded = samples.length > 0 || liveLoaded;

		return [
			{
				label: 'CPU Usage',
				color: '#ef6b6b',
				loaded,
				points: buildPoints(
					samples.map((sample) => sample.cpu),
					1
				),
				value: formatOptional(lastValue('cpu'), formatPercent)
			},
			{
				label: 'RAM Usage',
				color: '#4ade80',
				loaded,
				points: buildPoints(
					samples.map((sample) => sample.memory),
					1
				),
				value: formatOptional(lastValue('memory'), formatPercent)
			},
			{
				label: 'Bandwidth',
				color: '#60a5fa',
				loaded,
				points: buildPoints(
					samples.map((sample) => sample.bandwidth),
					bandwidthMax
				),
				value: formatOptional(lastValue('bandwidth'), formatBytesPerSecond)
			},
			{
				label: 'Disk I/O',
				color: '#fb923c',
				loaded,
				points: buildPoints(
					samples.map((sample) => sample.diskIo),
					diskIoMax
				),
				value: formatOptional(lastValue('diskIo'), formatBytesPerSecond)
			}
		];
	});

	const terminalLines = [
		{ type: 'prompt' as const, text: 'ls /var/log' },
		{ type: 'output' as const, text: 'www.log  gamer.log  uwaa.log  fyra.log  chicago.log' },
		{ type: 'cursor' as const, text: '' }
	];

	const currentLogs = [
		{
			id: 'log-1',
			timestamp: '2026-04-27 05:10:18',
			severity: 'info',
			source: 'agent',
			message: 'guest agent connected'
		},
		{
			id: 'log-2',
			timestamp: '2026-04-27 05:10:20',
			severity: 'info',
			source: 'network',
			message: 'network interface configured'
		}
	];

	const sevColors: Record<string, string> = {
		info: 'text-blue-700 dark:text-blue-400',
		warn: 'text-amber-700 dark:text-amber-400',
		error: 'text-red-700 dark:text-red-400'
	};

	const serverDetails = $derived([
		{ label: 'Plan', value: server.current.plan },
		{ label: 'Region', value: server.current.region },
		{ label: 'vCPU', value: `${server.current.vcpu}` },
		{ label: 'RAM', value: server.current.ram },
		{ label: 'Disk', value: server.current.disk },
		{ label: 'Created', value: server.current.created },
		{ label: 'Uptime', value: server.current.uptime ?? '-', live: true }
	]);
</script>

{#snippet copyButton(
	text: string,
	key: string,
	label: string
)}
	<button
		type="button"
		class="text-muted-foreground hover:text-foreground"
		aria-label={label}
		onclick={() => clipboard.copy(text, key)}
	>
		{#if clipboard.copiedKey === key}
			<Check class="h-3 w-3 text-emerald-500" />
		{:else}
			<Copy class="h-3 w-3" />
		{/if}
	</button>
{/snippet}

{#snippet addressRow(
	label: string,
	value: string | null,
	key: string,
	valueClass: string,
	skeletonClass: string
)}
	<div class="flex items-center justify-between px-5 py-2">
		<span class="text-xs text-muted-foreground">{label}</span>
		<div class="flex items-center gap-1.5">
			{#if liveLoaded}
				<span class="font-mono text-foreground {valueClass}">{value ?? '-'}</span>
				{#if value}
					{@render copyButton(value, key, `Copy ${label} address`)}
				{/if}
			{:else}
				<span class="h-2.5 animate-pulse rounded bg-muted {skeletonClass}"></span>
			{/if}
		</div>
	</div>
{/snippet}

{#snippet sshHint(
	command: string,
	key: string,
	copyLabel: string,
	lead: string,
	commandClass: string,
	leadClass: string
)}
	<div class="flex items-center gap-2 border border-border bg-background px-3 py-1.5">
		<span class="text-muted-foreground {commandClass}">{command}</span>
		{@render copyButton(command, key, copyLabel)}
	</div>
	<p class="text-muted-foreground {leadClass}">
		{lead}
		<a
			href="https://fyrastack.com/docs/vps/ssh"
			target="_blank"
			rel="noopener noreferrer"
			class="text-red-700 underline underline-offset-2 hover:text-red-800 dark:text-red-300 dark:hover:text-red-200"
			>SSH</a
		>
		in the meantime.
	</p>
{/snippet}

<h1 class="sr-only">Server Overview</h1>

<div
	class="grid shrink-0 grid-cols-2 gap-px border-b border-border bg-muted lg:grid-cols-4 high-contrast:bg-border"
>
	{#each charts as chart (chart.label)}
		<div class="relative flex flex-col bg-background">
			<div class="flex items-baseline justify-between px-4 pt-3 pb-1">
				<span class="relative z-10 text-xs font-medium text-muted-foreground">{chart.label}</span>
				{#if chart.loaded}
					<span class="relative z-10 text-xs font-semibold text-foreground">{chart.value}</span>
				{:else}
					<span class="relative z-10 h-3 w-10 animate-pulse rounded bg-muted"></span>
				{/if}
			</div>
			<div>
				<svg
					viewBox="0 0 240 80"
					class="block h-28 w-full"
					preserveAspectRatio="none"
					aria-hidden="true"
				>
					{#if chart.loaded}
						<polygon
							points="{chart.points} 240,80 0,80"
							fill={chart.color}
							opacity="0.08"
						></polygon>

						<polyline
							points={chart.points}
							fill="none"
							stroke={chart.color}
							stroke-width="2"
							stroke-linejoin="round"
							stroke-linecap="round"
							vector-effect="non-scaling-stroke"
						></polyline>
					{:else}
						<line
							x1="0"
							y1="50"
							x2="240"
							y2="50"
							stroke="var(--border)"
							stroke-width="2"
							stroke-dasharray="4 5"
							stroke-linecap="round"
							vector-effect="non-scaling-stroke"
							class="animate-pulse"
						></line>
					{/if}
				</svg>
			</div>
		</div>
	{/each}
</div>

<div
	class="grid shrink-0 grid-cols-1 gap-px border-b border-border bg-muted lg:grid-cols-5 high-contrast:bg-border"
>
	<div class="col-span-2 divide-y divide-border/50 bg-background">
		<div class="px-5 py-3 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
			Server Details
		</div>
		{#each serverDetails as detail (detail.label)}
			<div class="flex items-center justify-between px-5 py-2">
				<span class="text-xs text-muted-foreground">{detail.label}</span>
				{#if detail.live && !liveLoaded}
					<span class="h-2.5 w-20 animate-pulse rounded bg-muted"></span>
				{:else}
					<span class="text-xs font-medium text-foreground">{detail.value}</span>
				{/if}
			</div>
		{/each}
		{@render addressRow('IPv4', server.current.ip, 'ipv4', 'text-xs', 'w-24')}
		{@render addressRow('IPv6', server.current.ipv6, 'ipv6', 'text-[11px]', 'w-28')}
	</div>

	<div class="col-span-3 flex flex-col bg-background">
		<div class="flex items-center gap-2 border-b border-border px-4 py-2.5">
			<Terminal class="h-3 w-3 text-muted-foreground" />
			<span class="text-xs font-semibold text-muted-foreground">Console</span>
		</div>
		<div
			class="min-h-[180px] flex-1 bg-background p-4 font-mono text-sm leading-relaxed text-muted-foreground"
		>
			{#if !data.featureFlags.vpsConsole}
				<div class="flex h-full min-h-[148px] flex-col items-center justify-center gap-3">
					<Terminal class="h-8 w-8 text-muted-foreground/60" />
					<div class="text-center">
						<p class="text-sm font-medium text-muted-foreground">Coming soon</p>
						<p class="mt-1 text-xs text-muted-foreground">Console access is not available yet.</p>
					</div>
					{#if sshAddress}
						{@render sshHint(
							`ssh root@${sshAddress}`,
							'ssh-console',
							'Copy SSH command',
							'Connect over',
							'text-xs',
							'text-[11px]'
						)}
					{/if}
				</div>
			{:else if server.current.status === 'running'}
				{#each terminalLines as line (line.type + line.text)}
					{#if line.type === 'prompt'}
						<div>
							<span class="text-muted-foreground">user@{server.current.name}~:</span>
							{line.text}
						</div>
					{:else if line.type === 'output'}
						<div class="text-muted-foreground">{line.text}</div>
					{:else}
						<div>
							<span class="text-muted-foreground">user@{server.current.name}~:</span>
							<span class="inline-block h-4 w-1.5 animate-pulse bg-muted-foreground"></span>
						</div>
					{/if}
				{/each}
			{:else if server.current.status === 'restarting'}
				<div class="text-amber-500">Restarting server...</div>
			{:else if server.current.status === 'unknown'}
				<div class="text-muted-foreground">Server status unavailable. Reconnecting...</div>
			{:else}
				<div class="text-muted-foreground">Server is offline. Start the server to connect.</div>
			{/if}
		</div>
	</div>
</div>

<div class="flex min-h-[22rem] flex-1 flex-col lg:min-h-0">
	<div class="flex h-8 shrink-0 items-center justify-between border-b border-border px-4">
		<div class="flex items-center gap-2">
			<FileText class="h-3 w-3 text-muted-foreground" />
			<span class="text-xs font-semibold text-muted-foreground">Logs</span>
		</div>
		{#if data.featureFlags.vpsLogs}
			<div class="flex items-center gap-1">
				<Button
					variant="ghost"
					size="sm"
					class="h-6 w-6 p-0 text-red-400"
					aria-label="Clear logs"
					disabled
				>
					<Trash2 class="h-2.5 w-2.5" />
				</Button>
			</div>
		{/if}
	</div>
	<div class="flex-1 overflow-auto bg-background font-mono text-[11px] leading-relaxed">
		{#if !data.featureFlags.vpsLogs}
			<div class="flex h-full flex-col items-center justify-center gap-3">
				<FileText class="h-8 w-8 text-muted-foreground/60" />
				<div class="text-center">
					<p class="text-sm font-medium text-muted-foreground">Coming soon</p>
					<p class="mt-1 text-xs text-muted-foreground">Log streaming is not available yet.</p>
				</div>
				{#if sshAddress}
					{@render sshHint(
						`ssh root@${sshAddress} journalctl -f`,
						'ssh-logs',
						'Copy logs command',
						'Tail logs over',
						'',
						''
					)}
				{/if}
			</div>
		{:else if server.current.status !== 'running'}
			<div class="flex h-full flex-col items-center justify-center gap-3">
				<AlertTriangle class="h-8 w-8 text-amber-500/60" />
				<div class="text-center">
					<p class="text-sm font-medium text-muted-foreground">Server not running</p>
					<p class="mt-1 text-xs text-muted-foreground">
						Start the server to connect to the guest agent.
					</p>
				</div>
			</div>
		{:else if !server.current.agentConnected}
			<div class="flex h-full flex-col items-center justify-center gap-3">
				<AlertTriangle class="h-8 w-8 text-red-400/60" />
				<div class="text-center">
					<p class="text-sm font-medium text-muted-foreground">Guest agent unreachable</p>
					<p class="mt-1 max-w-xs text-xs text-muted-foreground">
						The server is running but the guest agent is not responding.
					</p>
				</div>
			</div>
		{:else}
			{#each currentLogs as entry (entry.id)}
				<div class="flex items-baseline gap-0 px-4 py-px leading-[1.6] hover:bg-muted/20">
					<span class="w-[148px] shrink-0 text-muted-foreground">{entry.timestamp}</span>
					<span class="w-[42px] shrink-0 font-semibold uppercase {sevColors[entry.severity]}"
						>{entry.severity.slice(0, 4)}</span
					>
					<span class="w-[72px] shrink-0 text-muted-foreground">{entry.source}</span>
					<span class="text-muted-foreground">{entry.message}</span>
				</div>
			{/each}
		{/if}
	</div>
</div>
