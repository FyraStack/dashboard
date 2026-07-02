<script lang="ts">
	import type { PageProps } from './$types';
	import { getServerWithFallback } from '$lib/state/servers.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import ComingSoon from '$lib/components/coming-soon.svelte';
	import { Check, Copy, Pencil, Plus, Trash2, X } from '@lucide/svelte';

	let { data }: PageProps = $props();
	let selectedServer = $derived(getServerWithFallback(data.serverId, data.server));
	let copied = $state('');
	let editingRdnsKey = $state<string | null>(null);
	let rdnsValue = $state('');
	let ipv4Rdns = $state('vps.stack.sh');
	let ipv6Entries = $state([
		{ ip: '2607:f8b0:4004:0800::1', rdns: 'mail.stack.sh' },
		{ ip: '2607:f8b0:4004:0800::2', rdns: '' }
	]);
	function copyToClipboard(text: string, label: string) {
		navigator.clipboard.writeText(text);
		copied = label;
		setTimeout(() => (copied = ''), 1500);
	}
</script>

<div class="flex-1 divide-y divide-gray-800/50 overflow-auto">
	<div class="px-5 py-3">
		<span class="text-xs font-semibold tracking-wider text-gray-500 uppercase">Public Network</span>
	</div>
	<div class="px-5 py-3">
		<div class="flex items-center justify-between">
			<div>
				<p class="text-sm font-medium text-gray-100">IPv4 Address</p>
				<p class="mt-0.5 font-mono text-xs text-gray-400">{selectedServer.ip}</p>
			</div>
			<button
				aria-label="Copy IPv4 address"
				class="text-gray-500 hover:text-gray-300"
				onclick={() => copyToClipboard(selectedServer.ip, 'net-ipv4')}
				>{#if copied === 'net-ipv4'}<Check class="h-3.5 w-3.5 text-emerald-500" />{:else}<Copy
						class="h-3.5 w-3.5"
					/>{/if}</button
			>
		</div>
		<div class="mt-2 flex items-center justify-between">
			<span class="text-xs text-gray-500">Reverse DNS</span>{#if editingRdnsKey === 'ipv4'}<div
					class="flex items-center gap-1.5"
				>
					<Input
						bind:value={rdnsValue}
						class="h-7 w-56 text-xs"
						placeholder="hostname.example.com"
					/><Button
						aria-label="Save reverse DNS"
						variant="ghost"
						size="sm"
						class="h-7 w-7 p-0 text-emerald-500"
						onclick={() => {
							ipv4Rdns = rdnsValue;
							editingRdnsKey = null;
						}}><Check class="h-3 w-3" /></Button
					><Button
						aria-label="Cancel reverse DNS edit"
						variant="ghost"
						size="sm"
						class="h-7 w-7 p-0"
						onclick={() => (editingRdnsKey = null)}><X class="h-3 w-3" /></Button
					>
				</div>{:else}<div class="flex items-center gap-1.5">
					<span class="font-mono text-xs text-gray-300">{ipv4Rdns || '—'}</span><Button
						aria-label="Edit reverse DNS"
						variant="ghost"
						size="sm"
						class="h-7 w-7 p-0"
						onclick={() => {
							editingRdnsKey = 'ipv4';
							rdnsValue = ipv4Rdns;
						}}><Pencil class="h-3 w-3" /></Button
					>
				</div>{/if}
		</div>
	</div>
	<div class="px-5 py-3">
		<div class="flex items-center justify-between">
			<div>
				<p class="text-sm font-medium text-gray-100">IPv6 Subnet</p>
				<p class="mt-0.5 font-mono text-xs text-gray-400">{selectedServer.ipv6}</p>
			</div>
			<div class="flex items-center gap-2">
				<ComingSoon />
				<Button variant="outline" size="sm" disabled class="h-7 gap-1.5 px-3 text-xs"
					><Plus class="h-3 w-3" />Add Address</Button
				>
			</div>
		</div>
	</div>
	{#each ipv6Entries as entry, idx (entry.ip)}<div
			class="flex items-center justify-between px-5 py-2.5"
		>
			<div class="flex items-center gap-3">
				<span class="font-mono text-xs text-gray-200">{entry.ip}</span><span
					class="font-mono text-xs text-gray-500">{entry.rdns || '—'}</span
				>
			</div>
			<div class="flex items-center gap-1">
				<Button aria-label="Edit IPv6 reverse DNS" variant="ghost" size="sm" class="h-7 w-7 p-0"
					><Pencil class="h-3 w-3" /></Button
				><Button
					aria-label="Delete IPv6 address"
					variant="ghost"
					size="sm"
					class="h-7 w-7 p-0 text-red-400 hover:text-red-300"
					onclick={() => (ipv6Entries = ipv6Entries.filter((_, i) => i !== idx))}
					><Trash2 class="h-3 w-3" /></Button
				>
			</div>
		</div>{/each}
	<div class="px-5 py-3">
		<span class="text-xs font-semibold tracking-wider text-gray-500 uppercase">Firewall</span>
	</div>
	<div class="flex items-center justify-between px-5 py-3">
		<div>
			<p class="text-sm font-medium text-gray-100">web-servers</p>
			<p class="mt-0.5 text-xs text-gray-400">3 inbound, 1 outbound rules</p>
		</div>
		<Badge
			variant="outline"
			class="border-emerald-800 bg-emerald-950/40 text-[10px] text-emerald-400">Active</Badge
		>
	</div>
	<div class="px-5 py-3">
		<span class="text-xs font-semibold tracking-wider text-gray-500 uppercase">Private Network</span
		>
	</div>
	<div class="flex items-center justify-between px-5 py-3">
		<div>
			<p class="text-sm font-medium text-gray-100">internal-net</p>
			<p class="mt-0.5 font-mono text-xs text-gray-400">10.132.0.0/16</p>
		</div>
		<Badge variant="secondary" class="text-[10px]">Attached</Badge>
	</div>
</div>
