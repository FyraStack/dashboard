<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Check, Copy, Pencil, Plus, X } from '@lucide/svelte';
	import { getColocationContext } from '../../colocation-context.svelte';

	type ColoIp = { address: string; rdns: string; type: 'Primary' | 'Additional' };

	const colo = getColocationContext();
	let copied = $state('');
	let addIpOpen = $state(false);
	let newIpAddr = $state('');
	let newIpRdns = $state('');
	let addingIp = $state(false);
	let editingRdns = $state<number | null>(null);
	let rdnsValue = $state('');
	let ips = $state<Record<string, ColoIp[]>>({
		'colo-001': [
			{ address: '23.193.50.10', rdns: 'db-primary.stack.sh', type: 'Primary' },
			{ address: '23.193.50.110', rdns: '', type: 'Additional' }
		],
		'colo-002': [{ address: '23.193.50.11', rdns: 'storage.stack.sh', type: 'Primary' }],
		'colo-003': [{ address: '23.193.50.12', rdns: '', type: 'Primary' }]
	});

	let currentIps = $derived(ips[colo.selectedUnitId] ?? []);

	function copyText(text: string, label: string) {
		navigator.clipboard.writeText(text);
		copied = label;
		setTimeout(() => (copied = ''), 1500);
	}

	function openAddIpDialog() {
		newIpAddr = '';
		newIpRdns = '';
		addIpOpen = true;
	}

	function addIp() {
		if (!newIpAddr.trim() || addingIp) return;
		addingIp = true;
		if (!ips[colo.selectedUnitId]) ips[colo.selectedUnitId] = [];
		ips[colo.selectedUnitId].push({
			address: newIpAddr.trim(),
			rdns: newIpRdns.trim(),
			type: 'Additional'
		});
		newIpAddr = '';
		newIpRdns = '';
		addIpOpen = false;
		addingIp = false;
	}

	function saveRdns(idx: number) {
		const unitIps = ips[colo.selectedUnitId];
		if (unitIps?.[idx]) unitIps[idx].rdns = rdnsValue;
		editingRdns = null;
	}

	function deleteIp(idx: number) {
		const unitIps = ips[colo.selectedUnitId];
		if (unitIps) ips[colo.selectedUnitId] = unitIps.filter((_, i) => i !== idx);
	}
</script>

{#if colo.selectedUnit}
	<div class="flex-1 overflow-auto">
		<div class="divide-y divide-gray-800/50">
			<div class="px-5 py-3">
				<div class="flex items-center justify-between">
					<span class="text-xs font-semibold tracking-wider text-gray-500 uppercase"
						>IP Addresses</span
					>
					<Button
						variant="outline"
						size="sm"
						class="h-7 gap-1.5 px-3 text-xs"
						onclick={openAddIpDialog}
					>
						<Plus class="h-3 w-3" />
						Add IP
					</Button>
				</div>
			</div>
			{#each currentIps as ip, idx (ip.address)}
				<div class="flex items-center justify-between px-5 py-2.5">
					<div>
						<div class="flex items-center gap-2">
							<span class="font-mono text-xs text-gray-200">{ip.address}</span>
							<Badge variant="secondary" class="text-[9px]">{ip.type}</Badge>
						</div>
						{#if editingRdns === idx}
							<div class="mt-1 flex items-center gap-1.5">
								<Input bind:value={rdnsValue} class="h-6 w-48 text-[11px]" placeholder="hostname" />
								<Button
									variant="ghost"
									size="sm"
									class="h-6 w-6 p-0 text-emerald-500"
									aria-label="Save reverse DNS"
									onclick={() => saveRdns(idx)}><Check class="h-2.5 w-2.5" /></Button
								>
								<Button
									variant="ghost"
									size="sm"
									class="h-6 w-6 p-0"
									aria-label="Cancel reverse DNS edit"
									onclick={() => (editingRdns = null)}><X class="h-2.5 w-2.5" /></Button
								>
							</div>
						{:else}
							<p class="mt-0.5 font-mono text-[11px] text-gray-500">{ip.rdns || 'No rDNS'}</p>
						{/if}
					</div>
					{#if editingRdns !== idx}
						<div class="flex items-center gap-1">
							<button
								class="text-gray-500 hover:text-gray-300"
								aria-label="Copy IP address"
								onclick={() => copyText(ip.address, `colo-ip-${idx}`)}
							>
								{#if copied === `colo-ip-${idx}`}<Check
										class="h-3 w-3 text-emerald-500"
									/>{:else}<Copy class="h-3 w-3" />{/if}
							</button>
							<Button
								variant="ghost"
								size="sm"
								class="h-7 w-7 p-0"
								aria-label="Edit reverse DNS"
								onclick={() => {
									editingRdns = idx;
									rdnsValue = ip.rdns;
								}}><Pencil class="h-3 w-3" /></Button
							>
							{#if ip.type === 'Additional'}
								<Button
									variant="ghost"
									size="sm"
									class="h-7 w-7 p-0 text-red-400"
									aria-label={`Delete IP ${ip.address}`}
									onclick={() => deleteIp(idx)}><X class="h-3 w-3" /></Button
								>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
			<div class="px-5 py-3">
				<span class="text-xs font-semibold tracking-wider text-gray-500 uppercase">Network</span>
			</div>
			<div class="flex items-center justify-between px-5 py-2.5">
				<span class="text-xs text-gray-500">Uplink</span>
				<span class="text-xs font-medium text-gray-200">1 Gbps fair-use</span>
			</div>
			<div class="flex items-center justify-between px-5 py-2.5">
				<span class="text-xs text-gray-500">Bandwidth This Month</span>
				<span class="text-xs font-medium text-gray-200">1.2 TB</span>
			</div>
		</div>
	</div>

	<Dialog.Root bind:open={addIpOpen}>
		<Dialog.Content class="border-gray-800 bg-gray-900 sm:max-w-md">
			<Dialog.Header>
				<Dialog.Title>Add IP Address</Dialog.Title>
				<Dialog.Description
					>Request an additional IP for {colo.selectedUnit.name}.</Dialog.Description
				>
			</Dialog.Header>
			<div class="flex flex-col gap-4 py-4">
				<div class="flex flex-col gap-2">
					<Label>IP Address</Label>
					<Input
						bind:value={newIpAddr}
						placeholder="23.193.50.x"
						class="font-mono"
						disabled={addingIp}
					/>
				</div>
				<div class="flex flex-col gap-2">
					<Label>Reverse DNS (optional)</Label>
					<Input bind:value={newIpRdns} placeholder="hostname.example.com" disabled={addingIp} />
				</div>
			</div>
			<Dialog.Footer>
				<Button variant="outline" size="sm" onclick={() => (addIpOpen = false)} disabled={addingIp}
					>Cancel</Button
				>
				<Button size="sm" onclick={addIp} disabled={!newIpAddr.trim() || addingIp}
					>{addingIp ? 'Adding...' : 'Add'}</Button
				>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
{/if}
