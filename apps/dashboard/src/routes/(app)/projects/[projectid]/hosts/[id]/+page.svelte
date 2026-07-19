<script lang="ts">
	import type { ManagedHost } from '$lib/remote/managed-hosts.remote';

	type PageData = {
		host: ManagedHost;
	};

	let { data }: { data: PageData } = $props();
	const host = $derived(data.host);

	function formatDate(value: number | null) {
		return value ? new Date(value).toLocaleString() : 'Never';
	}

	function formatJson(value: unknown) {
		return JSON.stringify(value ?? null, null, 2);
	}

	function formatOs(value: string | null) {
		if (!value) return 'Unknown';
		const normalized = value.trim().toLowerCase();
		if (normalized.includes('ultramarine')) return 'Ultramarine';
		if (normalized === 'linux') return 'Linux';
		return value;
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex - Axe requires keyboard access for this scrollable region. -->
<div
	class="min-h-0 flex-1 overflow-auto bg-background"
	role="region"
	aria-label="Host overview"
	tabindex="0"
>
	<div class="grid border-b border-border bg-background lg:grid-cols-[320px_1fr]">
		<section class="border-b border-border p-5 lg:border-r lg:border-b-0">
			<h1 class="text-sm font-semibold text-foreground">Host Details</h1>
			<p class="mt-1 text-xs text-muted-foreground">
				Current dashboard state for this Tetra agent.
			</p>

			<div class="mt-5 divide-y divide-border border border-border">
				{#each [['Kind', host.hostKind], ['Mode', host.connectionMode], ['Last seen', formatDate(host.lastSeenAt)], ['OS', formatOs(host.os)], ['Arch', host.arch ?? 'Unknown'], ['Agent', host.agentVersion ?? 'Unknown']] as [label, value] (label)}
					<div class="flex items-center justify-between gap-4 px-4 py-3">
						<span class="text-xs text-muted-foreground">{label}</span>
						<span class="truncate text-right text-xs font-medium text-foreground">{value}</span>
					</div>
				{/each}
			</div>

			{#if host.lastError}
				<div
					class="mt-5 border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"
				>
					{host.lastError}
				</div>
			{/if}
		</section>

		<section class="p-5">
			<div class="flex items-center justify-between gap-4">
				<div>
					<h2 class="text-sm font-semibold text-foreground">Capabilities</h2>
					<p class="mt-1 text-xs text-muted-foreground">
						Last successful `agent.capabilities` response.
					</p>
				</div>
			</div>
			<!-- svelte-ignore a11y_no_noninteractive_tabindex - Axe requires keyboard access for this scrollable code region. -->
			<pre
				role="region"
				aria-label="Host capabilities JSON"
				tabindex="0"
				class="mt-4 max-h-[34rem] overflow-auto border border-border bg-muted/30 p-4 text-xs leading-relaxed text-foreground">{formatJson(
					host.capabilities
				)}</pre>
		</section>
	</div>
</div>
