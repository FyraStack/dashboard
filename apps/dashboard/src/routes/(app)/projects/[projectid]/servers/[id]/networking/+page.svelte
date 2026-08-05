<script lang="ts">
	import { untrack } from 'svelte';
	import type { PageProps } from './$types';
	import { getServerWithFallback } from '$lib/state/servers.svelte';
	import { setVmPtrRecord } from '$lib/remote/networking.remote';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import * as InputGroup from '$lib/components/ui/input-group';
	import { getErrorMessage } from '$lib/utils';
	import { toast } from 'svelte-sonner';
	import Check from '~icons/lucide/check';
	import Loader2 from '~icons/lucide/loader-2';
	import Plus from '~icons/lucide/plus';
	import X from '~icons/lucide/x';
	import Copy from '~icons/nucleo/copy';
	import Pencil from '~icons/nucleo/pencil';

	let { data }: PageProps = $props();
	let selectedServer = $derived(getServerWithFallback(data.serverId, data.server));
	let allocations = $state(untrack(() => data.networking.allocations));
	$effect(() => {
		allocations = data.networking.allocations;
	});

	type Allocation = (typeof allocations)[number];

	let copied = $state('');
	let editingKey = $state<string | null>(null);
	let rdnsValue = $state('');
	let savingKey = $state<string | null>(null);
	type PtrEntry = {
		key: number;
		suffix: string;
		value: string;
		originalAddress: string | null;
		originalValue: string | null;
	};

	let subnetDialogOpen = $state(false);
	let subnetDialogAllocation = $state<Allocation | null>(null);
	let subnetEntries = $state<PtrEntry[]>([]);
	let subnetSaving = $state(false);
	let nextEntryKey = 0;

	const ipv4Allocations = $derived(
		allocations.filter((allocation) => allocation.family === 'ipv4' && allocation.address)
	);
	const ipv6AddressAllocations = $derived(
		allocations.filter((allocation) => allocation.family === 'ipv6' && allocation.address)
	);
	const ipv6PrefixAllocations = $derived(
		allocations.filter((allocation) => allocation.family === 'ipv6' && allocation.prefix)
	);

	function copyToClipboard(text: string, label: string) {
		navigator.clipboard.writeText(text);
		copied = label;
		setTimeout(() => (copied = ''), 1500);
	}

	function ptrValueFor(allocation: Allocation, address: string | null) {
		if (!address) return null;
		return allocation.ptrRecords.find((record) => record.address === address)?.value ?? null;
	}

	function entryKey(allocationId: string, address: string) {
		return `${allocationId}|${address}`;
	}

	function startEditing(allocationId: string, address: string, current: string | null) {
		editingKey = entryKey(allocationId, address);
		rdnsValue = current ?? '';
	}

	function applyResult(
		allocationId: string,
		address: string,
		result: { address: string; value: string } | null
	) {
		allocations = allocations.map((allocation) => {
			if (allocation.id !== allocationId) return allocation;
			const others = allocation.ptrRecords.filter(
				(record) => record.address !== address && record.address !== result?.address
			);
			return {
				...allocation,
				ptrRecords: result
					? [...others, result].sort((a, b) => a.address.localeCompare(b.address))
					: others
			};
		});
	}

	async function savePtr(allocationId: string, address: string, value: string) {
		savingKey = entryKey(allocationId, address);
		try {
			const result = await setVmPtrRecord({
				vmId: data.serverId,
				allocationId,
				address,
				value: value.trim()
			});
			applyResult(allocationId, address, result);
			editingKey = null;
		} catch (err) {
			toast.error(getErrorMessage(err, 'Failed to update reverse DNS'));
		} finally {
			savingKey = null;
		}
	}

	function prefixBase(prefix: string | null) {
		return prefix?.replace(/::\/\d+$/, '') ?? '';
	}

	function entrySuffix(address: string, prefix: string | null) {
		const base = prefixBase(prefix);
		return base && address.toLowerCase().startsWith(base.toLowerCase())
			? address.slice(base.length)
			: address;
	}

	function blankEntry(): PtrEntry {
		return {
			key: nextEntryKey++,
			suffix: '',
			value: '',
			originalAddress: null,
			originalValue: null
		};
	}

	function openSubnetDialog(allocation: Allocation) {
		subnetDialogAllocation = allocation;
		subnetEntries = allocation.ptrRecords.map((record) => ({
			key: nextEntryKey++,
			suffix: entrySuffix(record.address, allocation.prefix),
			value: record.value,
			originalAddress: record.address,
			originalValue: record.value
		}));
		if (subnetEntries.length === 0) subnetEntries = [blankEntry()];
		subnetDialogOpen = true;
	}

	function removeSubnetEntry(key: number) {
		subnetEntries = subnetEntries.filter((entry) => entry.key !== key);
	}

	const subnetEntriesValid = $derived(
		subnetEntries.every((entry) => entry.suffix.trim() && entry.value.trim())
	);

	async function saveSubnetEntries() {
		const allocation = subnetDialogAllocation;
		if (!allocation || !subnetEntriesValid) return;

		const base = prefixBase(allocation.prefix);
		const kept = subnetEntries.map((entry) => ({
			...entry,
			address: `${base}${entry.suffix.trim()}`
		}));

		const keptAddresses = new Set(kept.map((entry) => entry.address.toLowerCase()));
		const removed = allocation.ptrRecords.filter(
			(record) => !keptAddresses.has(record.address.toLowerCase())
		);

		subnetSaving = true;
		try {
			for (const record of removed) {
				const result = await setVmPtrRecord({
					vmId: data.serverId,
					allocationId: allocation.id,
					address: record.address,
					value: ''
				});
				applyResult(allocation.id, record.address, result);
			}
			for (const entry of kept) {
				const unchanged =
					entry.originalAddress?.toLowerCase() === entry.address.toLowerCase() &&
					entry.originalValue === entry.value.trim();
				if (unchanged) continue;
				if (
					entry.originalAddress &&
					entry.originalAddress.toLowerCase() !== entry.address.toLowerCase()
				) {
					const result = await setVmPtrRecord({
						vmId: data.serverId,
						allocationId: allocation.id,
						address: entry.originalAddress,
						value: ''
					});
					applyResult(allocation.id, entry.originalAddress, result);
				}
				const result = await setVmPtrRecord({
					vmId: data.serverId,
					allocationId: allocation.id,
					address: entry.address,
					value: entry.value.trim()
				});
				applyResult(allocation.id, entry.address, result);
			}
			subnetDialogOpen = false;
		} catch (err) {
			toast.error(getErrorMessage(err, 'Failed to update reverse DNS'));
		} finally {
			subnetSaving = false;
		}
	}
</script>

{#snippet rdnsEditor(allocation: Allocation, address: string)}
	{@const key = entryKey(allocation.id, address)}
	{@const current = ptrValueFor(allocation, address)}
	<div class="mt-2 flex items-center justify-between">
		<span class="text-xs text-muted-foreground">Reverse DNS</span>
		{#if editingKey === key}
			<div class="flex items-center gap-1.5">
				<Input bind:value={rdnsValue} class="h-7 w-56 text-xs" placeholder="hostname.example.com" />
				<Button
					aria-label="Save reverse DNS"
					variant="ghost"
					size="sm"
					class="h-7 w-7 p-0 text-emerald-500"
					disabled={savingKey === key}
					onclick={() => savePtr(allocation.id, address, rdnsValue)}
				>
					{#if savingKey === key}
						<Loader2 class="h-3 w-3 animate-spin" />
					{:else}
						<Check class="h-3 w-3" />
					{/if}
				</Button>
				<Button
					aria-label="Cancel reverse DNS edit"
					variant="ghost"
					size="sm"
					class="h-7 w-7 p-0"
					disabled={savingKey === key}
					onclick={() => (editingKey = null)}
				>
					<X class="h-3 w-3" />
				</Button>
			</div>
		{:else}
			<div class="flex items-center gap-1.5">
				<span class="font-mono text-xs text-muted-foreground">{current || '-'}</span>
				{#if allocation.ptrEditable}
					<Button
						aria-label="Edit reverse DNS"
						variant="ghost"
						size="sm"
						class="h-7 w-7 p-0"
						onclick={() => startEditing(allocation.id, address, current)}
					>
						<Pencil class="h-3 w-3" />
					</Button>
				{/if}
			</div>
		{/if}
	</div>
{/snippet}

<div class="flex-1 divide-y divide-border/50 overflow-auto">
	<div class="px-5 py-3">
		<span class="text-xs font-semibold tracking-wider text-muted-foreground uppercase"
			>Public Network</span
		>
	</div>
	{#each ipv4Allocations as allocation (allocation.id)}
		<div class="px-5 py-3">
			<div class="flex items-center justify-between">
				<div>
					<p class="text-sm font-medium text-foreground">IPv4 Address</p>
					<p class="mt-0.5 font-mono text-xs text-muted-foreground">{allocation.address}</p>
				</div>
				<button
					aria-label="Copy IPv4 address"
					class="text-muted-foreground hover:text-foreground"
					onclick={() => copyToClipboard(allocation.address ?? '', `ipv4-${allocation.id}`)}
					>{#if copied === `ipv4-${allocation.id}`}<Check
							class="h-3.5 w-3.5 text-emerald-500"
						/>{:else}<Copy class="size-4" />{/if}</button
				>
			</div>
			{#if allocation.address}
				{@render rdnsEditor(allocation, allocation.address)}
			{/if}
		</div>
	{/each}
	{#each ipv6AddressAllocations as allocation (allocation.id)}
		<div class="px-5 py-3">
			<div class="flex items-center justify-between">
				<div>
					<p class="text-sm font-medium text-foreground">IPv6 Address</p>
					<p class="mt-0.5 font-mono text-xs text-muted-foreground">{allocation.address}</p>
				</div>
				<button
					aria-label="Copy IPv6 address"
					class="text-muted-foreground hover:text-foreground"
					onclick={() => copyToClipboard(allocation.address ?? '', `ipv6-${allocation.id}`)}
					>{#if copied === `ipv6-${allocation.id}`}<Check
							class="h-3.5 w-3.5 text-emerald-500"
						/>{:else}<Copy class="size-4" />{/if}</button
				>
			</div>
			{#if allocation.address}
				{@render rdnsEditor(allocation, allocation.address)}
			{/if}
		</div>
	{/each}
	{#each ipv6PrefixAllocations as allocation (allocation.id)}
		<div class="px-5 py-3">
			<div class="flex items-center justify-between">
				<div>
					<p class="text-sm font-medium text-foreground">IPv6 Subnet</p>
					<p class="mt-0.5 font-mono text-xs text-muted-foreground">{allocation.prefix}</p>
				</div>
				<div class="flex items-center gap-2">
					{#if allocation.ptrEditable}
						<Button
							variant="outline"
							size="sm"
							class="h-7 gap-1.5 px-3 text-xs"
							onclick={() => openSubnetDialog(allocation)}
						>
							{#if allocation.ptrRecords.length > 0}
								<Pencil class="h-3 w-3" />Edit Reverse DNS
							{:else}
								<Plus class="h-3 w-3" />Add Reverse DNS
							{/if}
						</Button>
					{/if}
					<button
						aria-label="Copy IPv6 subnet"
						class="text-muted-foreground hover:text-foreground"
						onclick={() => copyToClipboard(allocation.prefix ?? '', `prefix-${allocation.id}`)}
						>{#if copied === `prefix-${allocation.id}`}<Check
								class="h-3.5 w-3.5 text-emerald-500"
							/>{:else}<Copy class="size-4" />{/if}</button
					>
				</div>
			</div>
		</div>
		{#each allocation.ptrRecords as record (record.address)}
			<div class="flex items-center justify-between px-5 py-2.5">
				<div class="flex items-center gap-3">
					<span class="font-mono text-xs text-foreground">{record.address}</span>
					<span class="font-mono text-xs text-muted-foreground">{record.value}</span>
				</div>
			</div>
		{/each}
	{/each}
	{#if allocations.length === 0}
		<div class="px-5 py-3">
			<div class="flex items-center justify-between">
				<div>
					<p class="text-sm font-medium text-foreground">IPv4 Address</p>
					<p class="mt-0.5 font-mono text-xs text-muted-foreground">{selectedServer.ip}</p>
				</div>
				<button
					aria-label="Copy IPv4 address"
					class="text-muted-foreground hover:text-foreground"
					onclick={() => copyToClipboard(selectedServer.ip, 'net-ipv4')}
					>{#if copied === 'net-ipv4'}<Check class="h-3.5 w-3.5 text-emerald-500" />{:else}<Copy
							class="size-4"
						/>{/if}</button
				>
			</div>
		</div>
		<div class="px-5 py-3">
			<div class="flex items-center justify-between">
				<div>
					<p class="text-sm font-medium text-foreground">IPv6 Address</p>
					<p class="mt-0.5 font-mono text-xs text-muted-foreground">{selectedServer.ipv6}</p>
				</div>
				<button
					aria-label="Copy IPv6 address"
					class="text-muted-foreground hover:text-foreground"
					onclick={() => copyToClipboard(selectedServer.ipv6, 'net-ipv6')}
					>{#if copied === 'net-ipv6'}<Check class="h-3.5 w-3.5 text-emerald-500" />{:else}<Copy
							class="size-4"
						/>{/if}</button
				>
			</div>
		</div>
	{/if}
</div>

<Dialog.Root bind:open={subnetDialogOpen}>
	<Dialog.Content class="border-border bg-background sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>Edit Reverse DNS</Dialog.Title>
			<Dialog.Description>
				PTR records for addresses in <span class="font-mono">{subnetDialogAllocation?.prefix}</span
				>.
			</Dialog.Description>
		</Dialog.Header>
		<div class="grid gap-3 py-4">
			{#each subnetEntries as entry (entry.key)}
				<div class="flex items-start gap-2">
					<div class="grid flex-1 gap-2">
						<InputGroup.Root>
							<InputGroup.Addon class="font-mono">
								{prefixBase(subnetDialogAllocation?.prefix ?? null)}
							</InputGroup.Addon>
							<InputGroup.Input
								bind:value={entry.suffix}
								class="font-mono"
								placeholder="::1"
								aria-label="IPv6 address suffix"
							/>
						</InputGroup.Root>
						<Input
							bind:value={entry.value}
							placeholder="hostname.example.com"
							aria-label="Reverse DNS hostname"
						/>
					</div>
					<Button
						aria-label="Remove entry"
						variant="ghost"
						size="sm"
						class="mt-1 h-7 w-7 p-0"
						disabled={subnetSaving}
						onclick={() => removeSubnetEntry(entry.key)}
					>
						<X class="h-3 w-3" />
					</Button>
				</div>
			{/each}
			<button
				class="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border py-2 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
				disabled={subnetSaving}
				onclick={() => (subnetEntries = [...subnetEntries, blankEntry()])}
			>
				<Plus class="h-3 w-3" />Add entry
			</button>
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (subnetDialogOpen = false)} disabled={subnetSaving}
				>Cancel</Button
			>
			<Button onclick={saveSubnetEntries} disabled={subnetSaving || !subnetEntriesValid}>
				{#if subnetSaving}
					<Loader2 class="mr-2 h-3 w-3 animate-spin" />
				{/if}
				Save
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
