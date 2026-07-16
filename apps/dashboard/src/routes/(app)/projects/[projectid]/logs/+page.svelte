<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import ArrowDown from '~icons/lucide/arrow-down';
	import ChevronRight from '~icons/lucide/chevron-right';
	import FileText from '~icons/nucleo/file-text';
	import X from '~icons/lucide/x';
	import Pause from '~icons/nucleo/pause';
	import Play from '~icons/nucleo/play';
	import Search from '~icons/nucleo/search';
	import Trash2 from '~icons/nucleo/trash';

	type Severity = 'info' | 'warn' | 'error' | 'debug';

	type LogEntry = {
		id: number;
		timestamp: string;
		severity: Severity;
		source: string;
		message: string;
	};

	type ServerLog = {
		id: string;
		name: string;
		status: 'running' | 'stopped';
	};

	const serverList: ServerLog[] = [
		{ id: 'vps-747762', name: 'vps-747762', status: 'running' },
		{ id: 'vps-742736', name: 'vps-742736', status: 'running' },
		{ id: 'vps-711980', name: 'vps-711980', status: 'stopped' }
	];

	let selectedServerId = $state('vps-747762');

	const sources = ['nginx', 'app', 'postgres', 'redis', 'cron', 'sshd', 'systemd'];

	const sampleMessages: Record<Severity, string[]> = {
		info: [
			'GET /api/health 200 OK - 2ms',
			'POST /api/auth/login 200 OK - 45ms',
			'Worker process started pid=4821',
			'Connection pool initialized (min=2, max=10)',
			'TLS certificate renewed successfully',
			'Backup completed: 42MB compressed',
			'Cache hit ratio: 94.2%',
			'GET /api/servers 200 OK - 12ms',
			'Session cleanup: removed 23 expired sessions',
			'DNS resolution for stack.sh: 1.2ms'
		],
		warn: [
			'Rate limit threshold at 80% for IP 45.33.32.156',
			'Connection pool nearing capacity (8/10)',
			'Slow query detected: 850ms on users table',
			'Disk usage at 78% on /var/log',
			'Memory usage exceeds 85% threshold',
			'Retry attempt 2/3 for upstream service',
			'Certificate expires in 14 days',
			'Request queue depth: 47 (threshold: 50)'
		],
		error: [
			'Connection timeout after 30000ms',
			'Failed to write to /var/log/app.log: Permission denied',
			'ECONNREFUSED 10.132.0.5:5432',
			'Out of memory: kill process 3827 (node)',
			'SSL handshake failed: certificate verify failed',
			'Segmentation fault in worker pid=9182',
			'FATAL: too many connections for role "app"'
		],
		debug: [
			'Query plan: sequential scan on sessions',
			'GC pause: 12ms (heap: 256MB)',
			'Route matched: /api/servers/:id/metrics',
			'WebSocket ping/pong latency: 3ms',
			'Cache eviction: LRU removed 12 entries'
		]
	};

	let logId = $state(0);

	function makeTimestamp(): string {
		const now = new Date();
		return now.toISOString().replace('T', ' ').slice(0, 19);
	}

	function randomLog(): LogEntry {
		const weights: Severity[] = [
			'info',
			'info',
			'info',
			'info',
			'info',
			'debug',
			'debug',
			'warn',
			'warn',
			'error'
		];
		const severity = weights[Math.floor(Math.random() * weights.length)];
		const msgs = sampleMessages[severity];
		const message = msgs[Math.floor(Math.random() * msgs.length)];
		const source = sources[Math.floor(Math.random() * sources.length)];
		logId++;
		return { id: logId, timestamp: makeTimestamp(), severity, source, message };
	}

	// Per-server log buffers
	let serverLogs = $state<Record<string, LogEntry[]>>({
		'vps-747762': Array.from({ length: 25 }, () => randomLog()),
		'vps-742736': Array.from({ length: 20 }, () => randomLog()),
		'vps-711980': []
	});

	let currentLogs = $derived(serverLogs[selectedServerId] ?? []);

	let filter = $state<Severity | 'all'>('all');
	let sourceFilter = $state<string | null>(null);
	let search = $state('');
	let streaming = $state(true);
	let logContainer: HTMLDivElement | undefined = $state();

	let filtered = $derived.by(() => {
		let result = currentLogs;
		if (filter !== 'all') {
			result = result.filter((l) => l.severity === filter);
		}
		if (sourceFilter) {
			result = result.filter((l) => l.source === sourceFilter);
		}
		if (search.trim()) {
			const q = search.toLowerCase();
			result = result.filter(
				(l) => l.message.toLowerCase().includes(q) || l.source.toLowerCase().includes(q)
			);
		}
		return result;
	});

	// Auto-stream new logs for running servers
	$effect(() => {
		if (!streaming) return;
		const serverId = selectedServerId;
		const server = serverList.find((s) => s.id === serverId);
		if (!server || server.status === 'stopped') return;

		const interval = setInterval(() => {
			if (!serverLogs[serverId]) serverLogs[serverId] = [];
			serverLogs[serverId].push(randomLog());
			if (serverLogs[serverId].length > 200) {
				serverLogs[serverId] = serverLogs[serverId].slice(-200);
			}
		}, 1200);
		return () => clearInterval(interval);
	});

	// Auto-scroll
	$effect(() => {
		const logCount = filtered.length;
		const container = logContainer;
		if (!streaming || !container) return;

		const frame = requestAnimationFrame(() => {
			if (logCount === filtered.length) {
				container.scrollTop = container.scrollHeight;
			}
		});

		return () => cancelAnimationFrame(frame);
	});

	function clearLogs() {
		serverLogs[selectedServerId] = [];
	}

	const severityColors: Record<Severity, string> = {
		info: 'border-blue-300 bg-blue-100 text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-400',
		warn: 'border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-400',
		error:
			'border-red-300 bg-red-100 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400',
		debug: 'border-border bg-muted/40 text-muted-foreground'
	};

	const filterOptions: { value: Severity | 'all'; label: string }[] = [
		{ value: 'all', label: 'All' },
		{ value: 'error', label: 'Error' },
		{ value: 'warn', label: 'Warn' },
		{ value: 'info', label: 'Info' },
		{ value: 'debug', label: 'Debug' }
	];
</script>

<div class="flex flex-1 flex-col overflow-hidden lg:flex-row">
	<!-- Server selector panel -->
	<div
		class="flex max-h-[38vh] w-full shrink-0 flex-col border-b border-border lg:max-h-none lg:w-56 lg:border-r lg:border-b-0"
	>
		<div class="flex h-10 shrink-0 items-center gap-2 border-b border-border px-4">
			<FileText class="h-4 w-4 text-muted-foreground" />
			<span class="text-sm font-semibold text-foreground">Logs</span>
		</div>
		<div class="flex-1 overflow-y-auto">
			{#each serverList as server (server.id)}
				<button
					class="flex w-full items-center justify-between border-b border-border px-4 py-2.5 text-left transition-colors duration-100 {selectedServerId ===
					server.id
						? 'bg-muted/60'
						: 'hover:bg-muted/30'}"
					onclick={() => (selectedServerId = server.id)}
				>
					<div class="flex items-center gap-2">
						<span
							class="h-1.5 w-1.5 shrink-0 rounded-full {server.status === 'running'
								? 'bg-emerald-500'
								: 'bg-red-500'}"
						></span>
						<span class="text-sm text-foreground">{server.name}</span>
					</div>
					<ChevronRight class="h-3 w-3 text-muted-foreground" />
				</button>
			{/each}
		</div>
	</div>

	<!-- Log content -->
	<div class="flex flex-1 flex-col overflow-hidden">
		<!-- Controls bar -->
		<div class="flex h-10 shrink-0 items-center justify-between border-b border-border px-4">
			<div class="flex items-center gap-2">
				<span class="text-sm font-medium text-foreground">{selectedServerId}</span>
				{#if streaming}
					<span class="flex items-center gap-1.5 text-[10px] text-emerald-500">
						<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500"></span>
						Live
					</span>
				{/if}
			</div>
			<div class="flex items-center gap-2">
				<div class="relative">
					<Search
						class="pointer-events-none absolute top-1/2 left-2.5 h-3 w-3 -translate-y-1/2 text-muted-foreground"
					/>
					<Input bind:value={search} placeholder="Filter logs..." class="h-7 w-44 pl-8 text-xs" />
				</div>
				<div class="flex items-center border border-border">
					{#each filterOptions as opt (opt.value)}
						<button
							class="px-2 py-1 text-[11px] font-medium transition-colors duration-100 {filter ===
							opt.value
								? 'bg-muted text-foreground'
								: 'text-muted-foreground hover:text-foreground'}"
							onclick={() => (filter = opt.value)}
						>
							{opt.label}
						</button>
					{/each}
				</div>
				{#if sourceFilter}
					<Badge variant="secondary" class="gap-1 text-[10px]">
						{sourceFilter}
						<button aria-label="Clear source filter" onclick={() => (sourceFilter = null)}
							><X class="h-2.5 w-2.5" /></button
						>
					</Badge>
				{/if}
				<Button
					variant="ghost"
					size="sm"
					class="h-7 w-7 p-0"
					aria-label={streaming ? 'Pause log streaming' : 'Resume log streaming'}
					onclick={() => (streaming = !streaming)}
				>
					{#if streaming}
						<Pause class="h-3 w-3" />
					{:else}
						<Play class="h-3 w-3" />
					{/if}
				</Button>
				<Button
					variant="ghost"
					size="sm"
					class="h-7 w-7 p-0 text-red-400"
					aria-label="Clear logs"
					onclick={clearLogs}
				>
					<Trash2 class="h-3 w-3" />
				</Button>
			</div>
		</div>

		<!-- Log stream -->
		<div
			class="flex-1 overflow-auto bg-background font-mono text-xs leading-relaxed"
			bind:this={logContainer}
		>
			{#if serverList.find((s) => s.id === selectedServerId)?.status === 'stopped'}
				<div class="flex flex-col items-center justify-center py-20 text-muted-foreground">
					<FileText class="mb-3 h-8 w-8" />
					<p class="font-sans text-sm">Server is offline</p>
					<p class="mt-1 font-sans text-xs text-muted-foreground">Start the server to view logs.</p>
				</div>
			{:else}
				{#each filtered as entry (entry.id)}
					<div
						class="flex items-start gap-3 border-b border-border/20 px-5 py-1.5 transition-colors duration-100 hover:bg-background/50"
					>
						<span class="shrink-0 pt-0.5 text-muted-foreground">{entry.timestamp}</span>
						<button onclick={() => (filter = filter === entry.severity ? 'all' : entry.severity)}>
							<Badge
								variant="outline"
								class="shrink-0 cursor-pointer text-[9px] {severityColors[
									entry.severity
								]} {filter === entry.severity ? 'ring-1 ring-ring' : ''}"
							>
								{entry.severity.toUpperCase()}
							</Badge>
						</button>
						<button
							class="w-16 shrink-0 text-left text-muted-foreground hover:text-muted-foreground {sourceFilter ===
							entry.source
								? 'text-foreground underline'
								: ''}"
							onclick={() => (sourceFilter = sourceFilter === entry.source ? null : entry.source)}
						>
							{entry.source}
						</button>
						<span
							class={entry.severity === 'error'
								? 'text-red-400'
								: entry.severity === 'warn'
									? 'text-amber-400/80'
									: 'text-muted-foreground'}
						>
							{entry.message}
						</span>
					</div>
				{/each}

				{#if filtered.length === 0 && currentLogs.length > 0}
					<div class="flex flex-col items-center justify-center py-20 text-muted-foreground">
						<Search class="mb-3 h-8 w-8" />
						<p class="font-sans text-sm">No logs match your filter</p>
					</div>
				{/if}
			{/if}
		</div>

		<!-- Footer status bar -->
		<div
			class="flex h-7 shrink-0 items-center justify-between border-t border-border bg-background px-5"
		>
			<span class="text-[10px] text-muted-foreground">
				{filtered.length} entries
				{#if filter !== 'all' || search.trim()}
					(filtered from {currentLogs.length})
				{/if}
			</span>
			{#if !streaming}
				<button
					class="flex items-center gap-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
					onclick={() => (streaming = true)}
				>
					<ArrowDown class="h-2.5 w-2.5" />
					Resume streaming
				</button>
			{/if}
		</div>
	</div>
</div>
