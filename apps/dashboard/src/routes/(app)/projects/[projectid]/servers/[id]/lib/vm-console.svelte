<script lang="ts">
	import { untrack } from 'svelte';
	import { Terminal } from '@xterm/xterm';
	import { FitAddon } from '@xterm/addon-fit';
	import { AttachAddon } from '@xterm/addon-attach';
	import '@xterm/xterm/css/xterm.css';
	import Loader2 from '~icons/lucide/loader-2';

	let {
		vmId,
		serverName,
		interactive = true
	}: {
		vmId: string;
		serverName: string;
		/** Preview embeds are read-only: they show live output but don't focus or accept input. */
		interactive?: boolean;
	} = $props();

	let containerEl = $state<HTMLDivElement>();
	let status = $state<'connecting' | 'open' | 'closed' | 'error'>('connecting');

	$effect(() => {
		const container = containerEl;
		if (!container) return;

		// `vmId`/`interactive` are read untracked on purpose. Callers pass these from a $derived
		// server object that is recreated on every status poll, so tracking them would tear down
		// and reopen the websocket about once a second. Callers use {#key vmId} to remount when
		// the VM genuinely changes.
		const currentVmId = untrack(() => vmId);
		const isInteractive = untrack(() => interactive);

		let disposed = false;
		let socket: WebSocket | undefined;
		let attachAddon: AttachAddon | undefined;

		const terminal = new Terminal({
			cursorBlink: isInteractive,
			convertEol: true,
			fontSize: 13,
			fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
			theme: { background: '#0a0a0a' }
		});
		const fitAddon = new FitAddon();
		terminal.loadAddon(fitAddon);
		terminal.open(container);
		fitAddon.fit();

		const resizeObserver = new ResizeObserver(() => fitAddon.fit());
		resizeObserver.observe(container);

		function connect() {
			status = 'connecting';
			terminal.reset();

			const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
			socket = new WebSocket(`${protocol}//${location.host}/api/vms/${currentVmId}/console`);

			socket.addEventListener('open', () => {
				if (disposed) return;
				status = 'open';
				attachAddon = new AttachAddon(socket!, { bidirectional: isInteractive });
				terminal.loadAddon(attachAddon);
				if (isInteractive) terminal.focus();
			});
			socket.addEventListener('close', () => {
				if (disposed) return;
				status = 'closed';
				attachAddon?.dispose();
				attachAddon = undefined;
			});
			socket.addEventListener('error', () => {
				if (disposed) return;
				status = 'error';
			});
		}

		connect();

		return () => {
			disposed = true;
			resizeObserver.disconnect();
			attachAddon?.dispose();
			socket?.close();
			terminal.dispose();
		};
	});
</script>

<div class="flex min-h-0 flex-1 flex-col bg-[#0a0a0a]">
	{#if status !== 'open'}
		<div
			class="flex shrink-0 items-center gap-2 border-b border-border bg-background px-4 py-2 text-xs text-muted-foreground"
		>
			{#if status === 'connecting'}
				<Loader2 class="h-3 w-3 animate-spin" />
				Connecting to {serverName}…
			{:else if status === 'closed'}
				Console connection closed.
			{:else}
				Failed to connect to console.
			{/if}
		</div>
	{/if}
	<div bind:this={containerEl} class="min-h-0 flex-1 overflow-hidden px-3 py-2"></div>
</div>
