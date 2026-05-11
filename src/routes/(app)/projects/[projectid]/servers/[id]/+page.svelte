<script lang="ts">
	import type { PageProps } from './$types';
	import { Button } from '$lib/components/ui/button';
	import {
		AlertTriangle,
		Check,
		Copy,
		FileText,
		Pause,
		Play,
		Terminal,
		Trash2
	} from '@lucide/svelte';
	import { getServerWithFallback, serversState } from '$lib/state/servers.svelte';

	let { data }: PageProps = $props();
	let selectedServer = $derived(getServerWithFallback(data.serverId, data.server));
	let copied = $state('');
	let logStreaming = $state(true);
	let liveLoaded = $derived(selectedServer.liveLoaded || serversState.firstStatusRefreshComplete);

	type ChartSample = {
		time?: number;
		cpu: number | null;
		memory: number | null;
		bandwidth: number | null;
		diskIo: number | null;
	};

	let liveChartSamplesByServer = $state<Record<string, ChartSample[]>>({});
	let lastSampleKeyByServer = $state<Record<string, string>>({});

	function formatPercent(value: number | null) {
		if (value == null) return '—';
		return `${Math.round(value * 100)}%`;
	}

	function formatRate(bytes: number | null) {
		if (bytes == null) return '—';
		const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
		let value = bytes;
		let unit = 0;
		while (value >= 1024 && unit < units.length - 1) {
			value /= 1024;
			unit += 1;
		}
		return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
	}

	function buildPoints(
		values: (number | null)[],
		maxValue = Math.max(...values.map((v) => v ?? 0), 1)
	) {
		const padded = [...Array(Math.max(0, 12 - values.length)).fill(null), ...values].slice(-12);
		return padded
			.map((value, index) => {
				const x = (index / Math.max(padded.length - 1, 1)) * 240;
				const y = 80 - ((value ?? 0) / maxValue) * 70;
				return `${x.toFixed(1)},${Math.max(5, Math.min(75, y)).toFixed(1)}`;
			})
			.join(' ');
	}

	function serverMetricsSample(): ChartSample | null {
		if (!selectedServer.liveLoaded) return null;
		const metrics = selectedServer.metrics;
		return {
			cpu: metrics?.cpu ?? null,
			memory: metrics?.memory ?? null,
			bandwidth:
				metrics?.networkIn == null && metrics?.networkOut == null
					? null
					: (metrics.networkIn ?? 0) + (metrics.networkOut ?? 0),
			diskIo:
				metrics?.diskRead == null && metrics?.diskWrite == null
					? null
					: (metrics.diskRead ?? 0) + (metrics.diskWrite ?? 0),
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
		if (!sample) return;
		const key = sampleKey(sample);
		if (lastSampleKeyByServer[selectedServer.id] === key) return;

		lastSampleKeyByServer[selectedServer.id] = key;
		liveChartSamplesByServer[selectedServer.id] = [
			...(liveChartSamplesByServer[selectedServer.id] ?? []),
			sample
		].slice(-12);
	});

	let charts = $derived.by(() => {
		const history = selectedServer.id === data.serverId ? (data.metricsHistory ?? []) : [];
		const liveSamples = liveChartSamplesByServer[selectedServer.id] ?? [];
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
		const latest = samples.at(-1);
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
				value: formatPercent(latest?.cpu ?? null)
			},
			{
				label: 'RAM Usage',
				color: '#4ade80',
				loaded,
				points: buildPoints(
					samples.map((sample) => sample.memory),
					1
				),
				value: formatPercent(latest?.memory ?? null)
			},
			{
				label: 'Bandwidth',
				color: '#60a5fa',
				loaded,
				points: buildPoints(
					samples.map((sample) => sample.bandwidth),
					bandwidthMax
				),
				value: formatRate(latest?.bandwidth ?? null)
			},
			{
				label: 'Disk I/O',
				color: '#fb923c',
				loaded,
				points: buildPoints(
					samples.map((sample) => sample.diskIo),
					diskIoMax
				),
				value: formatRate(latest?.diskIo ?? null)
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
		info: 'text-blue-400',
		warn: 'text-amber-400',
		error: 'text-red-400'
	};

	function isLiveDetail(label: string) {
		return ['Uptime'].includes(label);
	}

	function copyToClipboard(text: string, key: string) {
		navigator.clipboard.writeText(text);
		copied = key;
		setTimeout(() => (copied = ''), 1500);
	}
</script>

<div class="grid shrink-0 grid-cols-4 divide-x divide-gray-800 border-b border-gray-800">
	{#each charts as chart (chart.label)}
		<div class="relative flex flex-col">
			<div class="flex items-baseline justify-between px-4 pt-3 pb-1">
				<span class="relative z-10 text-xs font-medium text-gray-400">{chart.label}</span>
				{#if chart.loaded}
					<span class="relative z-10 text-xs font-semibold text-gray-200">{chart.value}</span>
				{:else}
					<span class="relative z-10 h-3 w-10 animate-pulse rounded bg-gray-800"></span>
				{/if}
			</div>
			<div>
				<svg viewBox="0 0 240 80" class="block h-28 w-full" preserveAspectRatio="none">
					<polygon points="{chart.points} 240,80 0,80" fill={chart.color} opacity="0.08" />
					{#if chart.loaded}
						<polyline
							points={chart.points}
							fill="none"
							stroke={chart.color}
							stroke-width="2"
							stroke-linejoin="round"
							stroke-linecap="round"
							vector-effect="non-scaling-stroke"
						/>
					{/if}
				</svg>
			</div>
		</div>
	{/each}
</div>

<div class="grid shrink-0 grid-cols-5 divide-x divide-gray-800 border-b border-gray-800">
	<div class="col-span-2 divide-y divide-gray-800/50">
		<div class="px-5 py-3 text-xs font-semibold tracking-wider text-gray-500 uppercase">
			Server Details
		</div>
		{#each [['Plan', selectedServer.plan], ['OS', selectedServer.os], ['Region', selectedServer.region], ['vCPU', `${selectedServer.vcpu} cores`], ['RAM', selectedServer.ram], ['Disk', selectedServer.disk], ['Created', selectedServer.created], ['Uptime', selectedServer.uptime]] as [label, value] (label)}
			<div class="flex items-center justify-between px-5 py-2">
				<span class="text-xs text-gray-500">{label}</span>
				{#if !liveLoaded && isLiveDetail(label)}
					<span class="h-2.5 w-20 animate-pulse rounded bg-gray-800"></span>
				{:else}
					<span class="text-xs font-medium text-gray-200">{value}</span>
				{/if}
			</div>
		{/each}
		<div class="flex items-center justify-between px-5 py-2">
			<span class="text-xs text-gray-500">IPv4</span>
			<div class="flex items-center gap-1.5">
				{#if liveLoaded}
					<span class="font-mono text-xs text-gray-200">{selectedServer.ip}</span>
					<button
						class="text-gray-500 hover:text-gray-300"
						onclick={() => copyToClipboard(selectedServer.ip, 'ipv4')}
					>
						{#if copied === 'ipv4'}<Check class="h-3 w-3 text-emerald-500" />{:else}<Copy
								class="h-3 w-3"
							/>{/if}
					</button>
				{:else}
					<span class="h-2.5 w-24 animate-pulse rounded bg-gray-800"></span>
				{/if}
			</div>
		</div>
		<div class="flex items-center justify-between px-5 py-2">
			<span class="text-xs text-gray-500">IPv6</span>
			<div class="flex items-center gap-1.5">
				{#if liveLoaded}
					<span class="font-mono text-[11px] text-gray-200">{selectedServer.ipv6}</span>
					<button
						class="text-gray-500 hover:text-gray-300"
						onclick={() => copyToClipboard(selectedServer.ipv6, 'ipv6')}
					>
						{#if copied === 'ipv6'}<Check class="h-3 w-3 text-emerald-500" />{:else}<Copy
								class="h-3 w-3"
							/>{/if}
					</button>
				{:else}
					<span class="h-2.5 w-28 animate-pulse rounded bg-gray-800"></span>
				{/if}
			</div>
		</div>
	</div>

	<div class="col-span-3 flex flex-col">
		<div class="flex items-center gap-2 border-b border-gray-800 px-4 py-2.5">
			<Terminal class="h-3 w-3 text-gray-500" />
			<span class="text-xs font-semibold text-gray-400">Console</span>
		</div>
		<div
			class="min-h-[180px] flex-1 bg-gray-950 p-4 font-mono text-sm leading-relaxed text-gray-300"
		>
			{#if !data.featureFlags.vpsConsole}
				<div class="flex h-full min-h-[148px] flex-col items-center justify-center gap-3">
					<Terminal class="h-8 w-8 text-gray-500/60" />
					<div class="text-center">
						<p class="text-sm font-medium text-gray-300">Coming soon</p>
						<p class="mt-1 text-xs text-gray-500">Console access is not available yet.</p>
					</div>
				</div>
			{:else if selectedServer.status === 'running'}
				{#each terminalLines as line (line.type + line.text)}
					{#if line.type === 'prompt'}
						<div>
							<span class="text-gray-500">user@{selectedServer.name}~:</span>
							{line.text}
						</div>
					{:else if line.type === 'output'}
						<div class="text-gray-400">{line.text}</div>
					{:else}
						<div>
							<span class="text-gray-500">user@{selectedServer.name}~:</span>
							<span class="inline-block h-4 w-1.5 animate-pulse bg-gray-400"></span>
						</div>
					{/if}
				{/each}
			{:else if selectedServer.status === 'restarting'}
				<div class="text-amber-500">Restarting server...</div>
			{:else}
				<div class="text-gray-600">Server is offline. Start the server to connect.</div>
			{/if}
		</div>
	</div>
</div>

<div class="flex min-h-0 flex-1 flex-col">
	<div class="flex h-8 shrink-0 items-center justify-between border-b border-gray-800 px-4">
		<div class="flex items-center gap-2">
			<FileText class="h-3 w-3 text-gray-500" />
			<span class="text-xs font-semibold text-gray-400">Logs</span>
		</div>
		{#if data.featureFlags.vpsLogs}
			<div class="flex items-center gap-1">
				<Button
					variant="ghost"
					size="sm"
					class="h-6 w-6 p-0"
					onclick={() => (logStreaming = !logStreaming)}
				>
					{#if logStreaming}<Pause class="h-2.5 w-2.5" />{:else}<Play class="h-2.5 w-2.5" />{/if}
				</Button>
				<Button variant="ghost" size="sm" class="h-6 w-6 p-0 text-red-400" disabled>
					<Trash2 class="h-2.5 w-2.5" />
				</Button>
			</div>
		{/if}
	</div>
	<div class="flex-1 overflow-auto bg-gray-950 font-mono text-[11px] leading-relaxed">
		{#if !data.featureFlags.vpsLogs}
			<div class="flex h-full flex-col items-center justify-center gap-3">
				<FileText class="h-8 w-8 text-gray-500/60" />
				<div class="text-center">
					<p class="text-sm font-medium text-gray-300">Coming soon</p>
					<p class="mt-1 text-xs text-gray-500">Log streaming is not available yet.</p>
				</div>
			</div>
		{:else if selectedServer.status !== 'running'}
			<div class="flex h-full flex-col items-center justify-center gap-3">
				<AlertTriangle class="h-8 w-8 text-amber-500/60" />
				<div class="text-center">
					<p class="text-sm font-medium text-gray-300">Server not running</p>
					<p class="mt-1 text-xs text-gray-500">Start the server to connect to the guest agent.</p>
				</div>
			</div>
		{:else if !selectedServer.agentConnected}
			<div class="flex h-full flex-col items-center justify-center gap-3">
				<AlertTriangle class="h-8 w-8 text-red-400/60" />
				<div class="text-center">
					<p class="text-sm font-medium text-gray-300">Guest agent unreachable</p>
					<p class="mt-1 max-w-xs text-xs text-gray-500">
						The server is running but the guest agent is not responding.
					</p>
				</div>
			</div>
		{:else}
			{#each currentLogs as entry (entry.id)}
				<div class="flex items-baseline gap-0 px-4 py-px leading-[1.6] hover:bg-gray-800/20">
					<span class="w-[148px] shrink-0 text-gray-600">{entry.timestamp}</span>
					<span class="w-[42px] shrink-0 font-semibold uppercase {sevColors[entry.severity]}"
						>{entry.severity.slice(0, 4)}</span
					>
					<span class="w-[72px] shrink-0 text-gray-500">{entry.source}</span>
					<span class="text-gray-300">{entry.message}</span>
				</div>
			{/each}
		{/if}
	</div>
</div>
