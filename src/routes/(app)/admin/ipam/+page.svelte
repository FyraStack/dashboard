<script lang="ts">
	import { invalidate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Dialog from '$lib/components/ui/dialog';
	import {
		createIpamPrefix,
		deleteIpamPrefix,
		listIpamPrefixes,
		setIpamPrefixDisabled,
		updateIpamPrefix
	} from '$lib/remote/ipam.remote';
	import { AdminState, type AdminPageData, type IpamPrefix } from '$lib/state/admin.svelte';
	import { getErrorMessage } from '$lib/utils';
	import {
		AlertTriangle,
		Cpu,
		Disc,
		Flag,
		Loader2,
		Network,
		Pencil,
		Plus,
		Power,
		Trash2,
		UserCog
	} from '@lucide/svelte';
	import { featureFlagKeys } from '$lib/feature-flags';
	import { toast } from 'svelte-sonner';

	type AdminTab = 'features' | 'vmTypes' | 'images' | 'ipam' | 'users';
	let { data }: { data: AdminPageData } = $props();
	const activeTab = 'ipam' as AdminTab;
	const admin = new AdminState();

	$effect(() => {
		admin.sync(data);
	});

	let dialogOpen = $state(false);
	let editing = $state<IpamPrefix | null>(null);
	let saving = $state(false);
	let formError = $state('');
	let name = $state('');
	let cidr = $state('');
	let whitelistStart = $state('');
	let whitelistEnd = $state('');
	let gatewayAddress = $state('');
	let disabled = $state(false);
	let ipv6UseTransitAddress = $state(false);

	const userCount = $derived(admin.adminUsers.length);
	const enabledCount = $derived(featureFlagKeys.filter((key) => admin.featureFlags[key]).length);
	const ipv4Count = $derived(
		admin.ipamPrefixes.filter((prefix) => prefix.family === 'ipv4').length
	);
	const ipv6Count = $derived(
		admin.ipamPrefixes.filter((prefix) => prefix.family === 'ipv6').length
	);
	const isIpv6Prefix = $derived(cidr.trim().includes(':'));

	function formatCount(value: string) {
		const parsed = BigInt(value);
		if (parsed < 1_000_000n) return parsed.toString();
		if (parsed < 1_000_000_000n) return `${parsed / 1_000_000n}M`;
		return `${parsed / 1_000_000_000n}B+`;
	}

	function openCreate() {
		editing = null;
		name = '';
		cidr = '';
		whitelistStart = '';
		whitelistEnd = '';
		gatewayAddress = '';
		disabled = false;
		ipv6UseTransitAddress = false;
		formError = '';
		dialogOpen = true;
	}

	function openEdit(prefix: IpamPrefix) {
		editing = prefix;
		name = prefix.name;
		cidr = prefix.cidr;
		whitelistStart = prefix.whitelistStart ?? '';
		whitelistEnd = prefix.whitelistEnd ?? '';
		gatewayAddress = prefix.gatewayAddress ?? '';
		disabled = prefix.disabled;
		ipv6UseTransitAddress = prefix.ipv6UseTransitAddress;
		formError = '';
		dialogOpen = true;
	}

	async function refreshPrefixes() {
		admin.ipamPrefixes = await listIpamPrefixes().run();
		await invalidate('app:ipam-prefixes');
	}

	async function savePrefix() {
		if (!name.trim() || !cidr.trim() || (!isIpv6Prefix && !gatewayAddress.trim())) return;

		saving = true;
		formError = '';

		const payload = {
			name: name.trim(),
			cidr: cidr.trim(),
			whitelistStart: whitelistStart.trim(),
			whitelistEnd: whitelistEnd.trim(),
			gatewayAddress: isIpv6Prefix ? '' : gatewayAddress.trim(),
			disabled,
			ipv6UseTransitAddress: isIpv6Prefix && ipv6UseTransitAddress
		};

		try {
			if (editing) {
				await updateIpamPrefix({ prefixId: editing.id, ...payload });
			} else {
				await createIpamPrefix(payload);
			}
			dialogOpen = false;
			await refreshPrefixes();
		} catch (err) {
			formError = getErrorMessage(err, 'Failed to save prefix');
		} finally {
			saving = false;
		}
	}

	async function togglePrefix(prefix: IpamPrefix) {
		const previous = admin.ipamPrefixes.map((item) => ({ ...item }));
		admin.ipamPrefixes = admin.ipamPrefixes.map((item) =>
			item.id === prefix.id ? { ...item, disabled: !prefix.disabled } : item
		);

		try {
			await setIpamPrefixDisabled({ prefixId: prefix.id, disabled: !prefix.disabled });
			await refreshPrefixes();
		} catch (err) {
			admin.ipamPrefixes = previous;
			toast.error(getErrorMessage(err, 'Failed to update prefix'));
		}
	}

	async function removePrefix(prefix: IpamPrefix) {
		if (
			!window.confirm(
				`Delete prefix "${prefix.name}" (${prefix.cidr})? Any live allocations from this pool may be orphaned. This cannot be undone.`
			)
		)
			return;
		try {
			await deleteIpamPrefix({ prefixId: prefix.id });
			admin.ipamPrefixes = admin.ipamPrefixes.filter((item) => item.id !== prefix.id);
			await invalidate('app:ipam-prefixes');
		} catch (err) {
			toast.error(getErrorMessage(err, 'Failed to delete prefix'));
		}
	}
</script>

<div class="flex flex-1 flex-col overflow-hidden">
	<div class="flex h-10 shrink-0 items-center gap-0 overflow-x-auto border-b border-gray-800">
		<a
			class="flex h-full items-center gap-1.5 border-b-2 px-5 text-xs font-medium transition-colors {activeTab ===
			'vmTypes'
				? 'border-red-500 text-gray-100'
				: 'border-transparent text-gray-500 hover:text-gray-300'}"
			href={resolve('/admin')}
		>
			<Cpu class="h-3.5 w-3.5 shrink-0" />
			VM Types
			<Badge variant="secondary" class="text-[10px]">{admin.vmTypes.length}</Badge>
		</a>
		<a
			class="flex h-full items-center gap-1.5 border-b-2 px-5 text-xs font-medium transition-colors {activeTab ===
			'images'
				? 'border-red-500 text-gray-100'
				: 'border-transparent text-gray-500 hover:text-gray-300'}"
			href={resolve('/admin/images')}
		>
			<Disc class="h-3.5 w-3.5 shrink-0" />
			Images
			<Badge variant="secondary" class="text-[10px]">{admin.images.length}</Badge>
		</a>
		<a
			class="flex h-full items-center gap-1.5 border-b-2 px-5 text-xs font-medium transition-colors {activeTab ===
			'features'
				? 'border-red-500 text-gray-100'
				: 'border-transparent text-gray-500 hover:text-gray-300'}"
			href={resolve('/admin/features')}
		>
			<Flag class="h-3.5 w-3.5 shrink-0" />
			Feature Flags
			<Badge variant="secondary" class="text-[10px]">{enabledCount}</Badge>
		</a>
		<a
			class="flex h-full items-center gap-1.5 border-b-2 px-5 text-xs font-medium transition-colors {activeTab ===
			'ipam'
				? 'border-red-500 text-gray-100'
				: 'border-transparent text-gray-500 hover:text-gray-300'}"
			href={resolve('/admin/ipam')}
		>
			<Network class="h-3.5 w-3.5 shrink-0" />
			IPAM
			<Badge variant="secondary" class="text-[10px]">{admin.ipamPrefixes.length}</Badge>
		</a>
		<a
			class="flex h-full items-center gap-1.5 border-b-2 px-5 text-xs font-medium transition-colors {activeTab ===
			'users'
				? 'border-red-500 text-gray-100'
				: 'border-transparent text-gray-500 hover:text-gray-300'}"
			href={resolve('/admin/users')}
		>
			<UserCog class="h-3.5 w-3.5 shrink-0" />
			Users
			<Badge variant="secondary" class="text-[10px]">{userCount}</Badge>
		</a>
		<div class="flex-1"></div>
		<div class="px-4">
			<Button size="sm" class="h-7 gap-1.5 text-xs" onclick={openCreate}>
				<Plus class="h-3 w-3" /> Add Prefix
			</Button>
		</div>
	</div>

	<div class="flex-1 overflow-auto">
		<div class="flex items-center gap-4 border-b border-gray-800/60 px-5 py-3">
			<div class="flex items-center gap-2 text-xs text-gray-400">
				<span class="text-gray-500">IPv4</span>
				<span class="font-medium text-gray-200">{ipv4Count}</span>
			</div>
			<div class="flex items-center gap-2 text-xs text-gray-400">
				<span class="text-gray-500">IPv6</span>
				<span class="font-medium text-gray-200">{ipv6Count}</span>
			</div>
		</div>

		{#if admin.ipamPrefixes.length === 0}
			<div class="flex flex-col items-center justify-center py-20 text-gray-500">
				<Network class="mb-3 h-6 w-6" />
				<p class="text-xs">No IPAM prefixes configured</p>
				<Button variant="outline" size="sm" class="mt-3 gap-1.5 text-xs" onclick={openCreate}>
					<Plus class="h-3 w-3" /> Add Prefix
				</Button>
			</div>
		{:else}
			<table class="w-full whitespace-nowrap">
				<thead>
					<tr class="border-b border-gray-800">
						<th class="px-5 py-3 text-left text-xs font-medium text-gray-500">Name</th>
						<th class="px-5 py-3 text-left text-xs font-medium text-gray-500">Prefix</th>
						<th class="px-5 py-3 text-left text-xs font-medium text-gray-500">Family</th>
						<th class="px-5 py-3 text-left text-xs font-medium text-gray-500">Gateway</th>
						<th class="px-5 py-3 text-left text-xs font-medium text-gray-500">Mode</th>
						<th class="px-5 py-3 text-left text-xs font-medium text-gray-500">Available</th>
						<th class="px-5 py-3 text-right text-xs font-medium text-gray-500">Actions</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-gray-800/50">
					{#each admin.ipamPrefixes as prefix (prefix.id)}
						<tr class="transition-colors hover:bg-gray-800/20">
							<td class="px-5 py-3">
								<div class="flex items-center gap-2">
									<span class="text-sm font-medium text-gray-100">{prefix.name}</span>
									{#if prefix.disabled}
										<Badge variant="secondary" class="text-[10px]">Disabled</Badge>
									{/if}
								</div>
							</td>
							<td class="px-5 py-3 font-mono text-xs text-gray-300">{prefix.cidr}</td>
							<td class="px-5 py-3">
								<Badge variant="secondary" class="text-[10px]">{prefix.family}</Badge>
							</td>
							<td class="px-5 py-3 font-mono text-xs text-gray-300">
								{prefix.gatewayAddress ?? '—'}
							</td>
							<td class="px-5 py-3">
								<Badge variant="outline" class="text-[10px]">
									{prefix.family === 'ipv6'
										? prefix.ipv6UseTransitAddress
											? '/128 transit'
											: '/64 prefixes'
										: '/32 addresses'}
								</Badge>
							</td>
							<td class="px-5 py-3 text-sm text-gray-300">
								<span class="tabular-nums">{formatCount(prefix.available)}</span>
								<span class="text-gray-500"> / {formatCount(prefix.capacity)}</span>
							</td>

							<td class="px-5 py-3 text-right">
								<div class="flex items-center justify-end gap-1">
									<Button
										variant="ghost"
										size="sm"
										class="h-7 w-7 p-0 text-gray-400 hover:text-gray-100"
										onclick={() => togglePrefix(prefix)}
										aria-label={prefix.disabled ? 'Enable prefix' : 'Disable prefix'}
									>
										<Power class="h-3 w-3" />
									</Button>
									<Button
										variant="ghost"
										size="sm"
										class="h-7 w-7 p-0 text-gray-400 hover:text-gray-100"
										onclick={() => openEdit(prefix)}
										aria-label="Edit prefix"
									>
										<Pencil class="h-3 w-3" />
									</Button>
									<Button
										variant="ghost"
										size="sm"
										class="h-7 w-7 p-0 text-red-400 hover:text-red-300"
										onclick={() => removePrefix(prefix)}
										aria-label="Delete prefix"
									>
										<Trash2 class="h-3 w-3" />
									</Button>
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>
</div>

<Dialog.Root bind:open={dialogOpen}>
	<Dialog.Content class="border-gray-800 bg-gray-900 sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{editing ? 'Edit Prefix' : 'Add Prefix'}</Dialog.Title>
			<Dialog.Description>Global IPAM allocation source.</Dialog.Description>
		</Dialog.Header>
		<div class="grid gap-4 py-4">
			{#if formError}
				<div
					class="flex items-center gap-2 border border-red-700 bg-red-950 px-3 py-2 text-sm text-red-400"
				>
					<AlertTriangle class="h-3.5 w-3.5 shrink-0" />{formError}
				</div>
			{/if}
			<div class="grid gap-2">
				<Label for="ipam-name">Name</Label>
				<Input id="ipam-name" bind:value={name} placeholder="Public v4 pool" />
			</div>
			<div class="grid gap-2">
				<Label for="ipam-cidr">Prefix</Label>
				<Input id="ipam-cidr" bind:value={cidr} placeholder="203.0.113.0/24" />
			</div>
			{#if !isIpv6Prefix}
				<div class="grid gap-2">
					<Label for="ipam-gateway-address">Gateway Address</Label>
					<Input id="ipam-gateway-address" bind:value={gatewayAddress} placeholder="203.0.113.1" />
				</div>
			{/if}
			<div class="grid grid-cols-2 gap-4">
				<div class="grid gap-2">
					<Label for="ipam-whitelist-start">Whitelist Start</Label>
					<Input id="ipam-whitelist-start" bind:value={whitelistStart} placeholder="optional" />
				</div>
				<div class="grid gap-2">
					<Label for="ipam-whitelist-end">Whitelist End</Label>
					<Input id="ipam-whitelist-end" bind:value={whitelistEnd} placeholder="optional" />
				</div>
			</div>
			{#if isIpv6Prefix}
				<label class="flex items-start gap-2 text-sm text-gray-300">
					<input
						type="checkbox"
						bind:checked={ipv6UseTransitAddress}
						class="mt-0.5 accent-red-500"
					/>
					<span>
						Use this IPv6 block for /128 transit addresses
						<span class="block text-xs text-gray-500"
							>Leave unchecked to allocate /64 prefixes.</span
						>
					</span>
				</label>
			{/if}

			<label class="flex items-center gap-2 text-sm text-gray-300">
				<input type="checkbox" bind:checked={disabled} class="accent-red-500" />
				Disabled
			</label>
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (dialogOpen = false)} disabled={saving}
				>Cancel</Button
			>
			<Button
				onclick={savePrefix}
				disabled={saving ||
					!name.trim() ||
					!cidr.trim() ||
					(!isIpv6Prefix && !gatewayAddress.trim())}
			>
				{#if saving}
					<Loader2 class="mr-2 h-3 w-3 animate-spin" />
				{/if}
				Save
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
