<script lang="ts">
	import type { WTerm } from '@wterm/dom';
	import { GhosttyCore } from '@wterm/ghostty';
	import { Terminal, type TerminalHandle } from '@wterm/svelte';
	import '@wterm/dom/src/terminal.css';
	import { serialConsolePath } from 'stack-shared/routes';
	import { onDestroy } from 'svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { getErrorMessage } from '#lib/utils.js';
	import Loader2 from '~icons/lucide/loader-2';
	import TerminalIcon from '~icons/nucleo/terminal';
	import { OvmfSerialFilter, type ScreenSize } from './ovmf';

	type ConsoleState = 'idle' | 'connecting' | 'connected' | 'closed' | 'error';
	interface FirmwareLayout {
		extent: ScreenSize;
		grid: ScreenSize;
	}

	interface StatusPayload {
		message?: string;
		state: string;
		type: 'status';
	}

	const BASE_FONT_PX = 13;
	const TERMINAL_PADDING_PX = 24;
	const MIN_FONT_PX = 6;
	const RECONNECT_DELAY_MS = 3000;
	const DEFAULT_EXTENT: ScreenSize = { cols: 80, rows: 25 };

	let { vmId, vmName, running }: { vmId: string; vmName: string; running: boolean } = $props();

	let terminal = $state<TerminalHandle | null>(null);
	let wterm = $state<WTerm | null>(null);
	let host = $state<HTMLDivElement | null>(null);
	let core = $state<GhosttyCore | null>(null);
	let coreError = $state<string | null>(null);
	let consoleState = $state<ConsoleState>('idle');
	let statusMessage = $state<string | null>(null);
	let reconnecting = $state(false);
	let filter = new OvmfSerialFilter();
	let firmware: FirmwareLayout | null = null;
	let baseRowHeight: string | null = null;
	let socket: WebSocket | null = null;
	let lastSize: { cols: number; rows: number } | null = null;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

	const showOverlay = $derived(consoleState !== 'connected');

	$effect(() => {
		GhosttyCore.load().then(
			(loaded) => (core = loaded),
			(error) => (coreError = getErrorMessage(error, 'Failed to load terminal'))
		);
	});

	function isRejection(event: CloseEvent) {
		return event.code >= 4000 && event.code < 5000;
	}

	function consoleSocketUrl() {
		const url = new URL(serialConsolePath(vmId), window.location.href);
		url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
		return url;
	}

	function sendResize(cols: number, rows: number) {
		lastSize = { cols, rows };
		if (socket?.readyState === WebSocket.OPEN) {
			socket.send(JSON.stringify({ type: 'resize', cols, rows }));
		}
	}

	function measureCell(fontPx: number): { width: number; height: number } | null {
		if (!wterm) {
			return null;
		}
		const row = document.createElement('div');
		row.className = 'term-row';
		row.style.cssText = `visibility:hidden;position:absolute;font-size:${fontPx}px;height:auto;line-height:normal`;
		const probe = document.createElement('span');
		probe.textContent = 'W';
		row.appendChild(probe);
		wterm.element.appendChild(row);
		const rect = probe.getBoundingClientRect();
		row.remove();
		if (rect.width === 0 || rect.height === 0) {
			return null;
		}
		return { width: rect.width, height: rect.height };
	}

	function applyFirmwareLayout() {
		if (!(firmware && wterm && host)) {
			return;
		}
		const base = measureCell(BASE_FONT_PX);
		if (!base) {
			return;
		}
		const baseRow = Number.parseFloat(baseRowHeight ?? '') || Math.ceil(base.height);
		const availableWidth = host.clientWidth - TERMINAL_PADDING_PX;
		const availableHeight = host.clientHeight - TERMINAL_PADDING_PX;
		const scale = Math.min(
			1,
			availableWidth / (firmware.extent.cols * base.width),
			availableHeight / (firmware.extent.rows * baseRow)
		);
		const fontPx = Math.max(MIN_FONT_PX, BASE_FONT_PX * scale);
		const rowPx = Math.max(1, Math.round(baseRow * (fontPx / BASE_FONT_PX)));
		const cell = measureCell(fontPx) ?? {
			width: base.width * (fontPx / BASE_FONT_PX),
			height: rowPx
		};
		const { style } = wterm.element;
		style.setProperty('--term-font-size', `${fontPx}px`);
		style.setProperty('--term-row-height', `${rowPx}px`);
		style.width = `${(firmware.grid.cols + 0.5) * cell.width + TERMINAL_PADDING_PX}px`;
		style.height = `${(firmware.grid.rows + 0.5) * rowPx + TERMINAL_PADDING_PX}px`;
	}

	function clearFirmwareLayout() {
		if (!wterm) {
			return;
		}
		const { style } = wterm.element;
		style.removeProperty('--term-font-size');
		style.removeProperty('width');
		style.removeProperty('height');
		if (baseRowHeight) {
			style.setProperty('--term-row-height', baseRowHeight);
		} else {
			style.removeProperty('--term-row-height');
		}
	}

	function enterFirmware(screen: ScreenSize) {
		if (!wterm) {
			return;
		}
		if (firmware) {
			firmware.grid = {
				cols: Math.max(firmware.grid.cols, screen.cols),
				rows: Math.max(firmware.grid.rows, screen.rows)
			};
		} else {
			baseRowHeight = wterm.element.style.getPropertyValue('--term-row-height') || null;
			firmware = { grid: screen, extent: { ...DEFAULT_EXTENT } };
		}
		applyFirmwareLayout();
	}

	function growFirmwareExtent(maxCol: number, maxRow: number) {
		if (!firmware) {
			return;
		}
		const cols = Math.min(firmware.grid.cols, Math.max(firmware.extent.cols, maxCol));
		const rows = Math.min(firmware.grid.rows, Math.max(firmware.extent.rows, maxRow));
		if (cols === firmware.extent.cols && rows === firmware.extent.rows) {
			return;
		}
		firmware.extent = { cols, rows };
		applyFirmwareLayout();
	}

	function exitFirmware() {
		firmware = null;
		clearFirmwareLayout();
	}

	function resetStream() {
		filter = new OvmfSerialFilter();
		if (firmware) {
			exitFirmware();
		}
	}

	function receive(bytes: Uint8Array) {
		const result = filter.push(bytes);
		if (result.screen) {
			enterFirmware(result.screen);
		}
		if (firmware) {
			growFirmwareExtent(result.maxCol, result.maxRow);
		}
		if (result.bytes.length) {
			terminal?.write(result.bytes);
		}
		if (result.reset && firmware) {
			exitFirmware();
		}
	}

	function claimInput() {
		if (socket?.readyState === WebSocket.OPEN) {
			socket.send(JSON.stringify({ type: 'claim' }));
		}
	}

	function claimIfFocused() {
		if (host?.contains(document.activeElement)) {
			claimInput();
		}
	}

	function handleData(input: string) {
		if (consoleState !== 'connected' || socket?.readyState !== WebSocket.OPEN) {
			return;
		}
		socket.send(JSON.stringify({ type: 'input', data: input }));
	}

	function handleStatus(payload: StatusPayload) {
		if (payload.state === 'connected') {
			consoleState = 'connected';
			statusMessage = null;
			if (lastSize) {
				sendResize(lastSize.cols, lastSize.rows);
			}
			if (document.hasFocus()) {
				requestAnimationFrame(() => terminal?.focus());
			}
		} else if (payload.state === 'closed') {
			consoleState = 'closed';
			statusMessage = payload.message ?? 'Console disconnected';
		}
	}

	function parseStatus(text: string): StatusPayload | null {
		try {
			const payload = JSON.parse(text);
			return payload?.type === 'status' ? payload : null;
		} catch {
			return null;
		}
	}

	function handleSocketMessage(event: MessageEvent) {
		if (typeof event.data !== 'string') {
			receive(new Uint8Array(event.data as ArrayBuffer));
			return;
		}
		const status = parseStatus(event.data);
		if (status) {
			handleStatus(status);
		}
	}

	function clearReconnect() {
		if (reconnectTimer) {
			clearTimeout(reconnectTimer);
		}
		reconnectTimer = null;
		reconnecting = false;
	}

	function disconnect() {
		clearReconnect();
		const current = socket;
		socket = null;
		if (current && current.readyState <= WebSocket.OPEN) {
			current.close();
		}
		const held = filter.flush();
		if (held.length) {
			terminal?.write(held);
		}
	}

	function scheduleReconnect() {
		clearReconnect();
		reconnecting = true;
		reconnectTimer = setTimeout(() => {
			reconnectTimer = null;
			reconnecting = false;
			if (running) {
				connect();
			}
		}, RECONNECT_DELAY_MS);
	}

	function connect() {
		if (!terminal || consoleState === 'connecting') {
			return;
		}
		disconnect();
		consoleState = 'connecting';
		statusMessage = null;
		resetStream();

		const ws = new WebSocket(consoleSocketUrl());
		ws.binaryType = 'arraybuffer';
		socket = ws;

		ws.onmessage = (event) => {
			if (socket === ws) {
				handleSocketMessage(event);
			}
		};
		ws.onclose = (event) => {
			if (socket !== ws) {
				return;
			}
			socket = null;
			if (consoleState === 'connected' || consoleState === 'connecting') {
				consoleState = 'closed';
				statusMessage = event.reason || 'Console disconnected';
			}
			if (!isRejection(event)) {
				scheduleReconnect();
			}
		};
		ws.onerror = () => {
			if (socket === ws) {
				consoleState = 'error';
				statusMessage = 'Console connection failed';
			}
		};
	}

	$effect(() => {
		if (running && terminal && consoleState === 'idle') {
			connect();
		} else if (!running && consoleState !== 'idle') {
			disconnect();
			consoleState = 'idle';
			statusMessage = null;
		}
	});

	$effect(() => {
		if (!host) {
			return;
		}
		const observer = new ResizeObserver(() => applyFirmwareLayout());
		observer.observe(host);
		return () => observer.disconnect();
	});

	onDestroy(disconnect);
</script>

<svelte:window onfocus={claimIfFocused} />

<div bind:this={host} class="relative min-h-0 flex-1 overflow-hidden" onfocusin={claimInput}>
	{#if core}
		<Terminal
			bind:this={terminal}
			bind:instance={wterm}
			{core}
			class="fyra-console"
			autoResize
			cursorBlink
			onData={handleData}
			onResize={sendResize}
		/>
	{:else}
		<div class="fyra-console-placeholder absolute inset-0"></div>
	{/if}

	{#if showOverlay}
		<div
			class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/85 text-center backdrop-blur-[2px]"
		>
			{#if coreError}
				<TerminalIcon class="h-8 w-8 text-muted-foreground" />
				<p class="text-sm text-foreground">{coreError}</p>
			{:else if !core || consoleState === 'connecting' || (running && consoleState === 'idle')}
				<Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
				<p class="text-sm text-muted-foreground">Opening serial console…</p>
			{:else if !running}
				<TerminalIcon class="h-8 w-8 text-muted-foreground" />
				<p class="text-sm text-foreground">Serial console for {vmName}</p>
				<p class="max-w-xs text-xs text-muted-foreground">Start the server to use the console.</p>
			{:else}
				<TerminalIcon class="h-8 w-8 text-muted-foreground" />
				<p class="text-sm text-foreground">{statusMessage ?? 'Console disconnected'}</p>
				{#if reconnecting}
					<p class="text-xs text-muted-foreground">Reconnecting…</p>
				{/if}
				<Button size="sm" variant="outline" onclick={connect}>Reconnect now</Button>
			{/if}
		</div>
	{/if}
</div>

<style>
	.fyra-console-placeholder {
		background: var(--gray-950);
		border: 1px solid var(--border);
	}

	:global(.wterm.fyra-console) {
		--term-font-family: "Geist Mono Variable", "Menlo", "Consolas", "DejaVu Sans Mono", monospace;
		--term-font-size: 13px;
		--term-bg: var(--gray-950);
		--term-fg: var(--gray-100);
		--term-cursor: var(--gray-300);
		--term-color-0: var(--gray-900);
		--term-color-8: var(--gray-600);
		--term-color-7: var(--gray-200);
		--term-color-15: var(--gray-50);
		position: absolute;
		inset: 0;
		border: 1px solid var(--border);
		border-radius: 0;
		box-shadow: none;
	}
</style>
