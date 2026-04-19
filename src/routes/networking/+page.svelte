<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Network, Pencil, Check, X, Plus, Globe, Trash2 } from '@lucide/svelte';

	type IpAddress = {
		address: string;
		type: string;
		server: string;
		rdns: string;
	};

	type PrivateNetwork = {
		id: string;
		name: string;
		cidr: string;
		servers: string[];
		enabled: boolean;
	};

	let ips = $state<IpAddress[]>([
		{
			address: '23.193.49.192',
			type: 'IPv4',
			server: 'vps-747762',
			rdns: 'vps-747762.stack.sh'
		},
		{
			address: '23.193.49.193',
			type: 'IPv4',
			server: 'vps-742736',
			rdns: 'vps-742736.stack.sh'
		},
		{ address: '23.193.49.194', type: 'IPv4', server: 'vps-711980', rdns: '' },
		{
			address: '2607:f8b0:4004:800::200e',
			type: 'IPv6',
			server: 'vps-747762',
			rdns: ''
		},
		{
			address: '2607:f8b0:4004:800::200f',
			type: 'IPv6',
			server: 'vps-742736',
			rdns: ''
		}
	]);

	let networks = $state<PrivateNetwork[]>([
		{
			id: 'vpc-001',
			name: 'internal-net',
			cidr: '10.132.0.0/16',
			servers: ['vps-747762', 'vps-742736'],
			enabled: true
		}
	]);

	let editingIdx = $state<number | null>(null);
	let editValue = $state('');

	let createNetOpen = $state(false);
	let newNetName = $state('');
	let newNetCidr = $state('10.0.0.0/16');

	function startEdit(idx: number) {
		editingIdx = idx;
		editValue = ips[idx].rdns;
	}

	function saveEdit() {
		if (editingIdx === null) return;
		ips[editingIdx].rdns = editValue;
		editingIdx = null;
	}

	function cancelEdit() {
		editingIdx = null;
	}

	let netCounter = $state(1);

	function createNetwork() {
		if (!newNetName.trim()) return;
		netCounter++;
		networks.push({
			id: `vpc-${String(netCounter).padStart(3, '0')}`,
			name: newNetName.trim(),
			cidr: newNetCidr,
			servers: [],
			enabled: true
		});
		newNetName = '';
		newNetCidr = '10.0.0.0/16';
		createNetOpen = false;
	}

	function deleteNetwork(id: string) {
		networks = networks.filter((n) => n.id !== id);
	}
</script>

<div class="flex flex-1 flex-col overflow-hidden">
	<!-- Header -->
	<div class="flex h-10 shrink-0 items-center gap-2 border-b border-fyra-gray-800 px-5">
		<Network class="h-4 w-4 text-fyra-gray-400" />
		<span class="text-sm font-semibold text-fyra-gray-100">Networking</span>
	</div>

	<div class="flex-1 overflow-auto">
		<!-- IP Addresses Section -->
		<div class="border-b border-fyra-gray-800">
			<div class="flex items-center gap-2 px-5 py-3">
				<Globe class="h-3.5 w-3.5 text-fyra-gray-500" />
				<span class="text-xs font-semibold tracking-wider text-fyra-gray-500 uppercase"
					>IP Addresses</span
				>
			</div>
			<table class="w-full">
				<thead>
					<tr class="border-y border-fyra-gray-800/50">
						<th class="px-5 py-2.5 text-left text-xs font-medium text-fyra-gray-500">Address</th>
						<th class="px-5 py-2.5 text-left text-xs font-medium text-fyra-gray-500">Type</th>
						<th class="px-5 py-2.5 text-left text-xs font-medium text-fyra-gray-500">Server</th>
						<th class="px-5 py-2.5 text-left text-xs font-medium text-fyra-gray-500">Reverse DNS</th
						>
						<th class="px-5 py-2.5 text-right text-xs font-medium text-fyra-gray-500"></th>
					</tr>
				</thead>
				<tbody class="divide-y divide-fyra-gray-800/50">
					{#each ips as ip, idx (ip.address)}
						<tr class="transition-colors duration-100 hover:bg-fyra-gray-800/20">
							<td class="px-5 py-3 font-mono text-sm text-fyra-gray-100">{ip.address}</td>
							<td class="px-5 py-3">
								<Badge variant="secondary" class="text-[10px]">{ip.type}</Badge>
							</td>
							<td class="px-5 py-3 text-sm text-fyra-gray-300">{ip.server}</td>
							<td class="px-5 py-3">
								{#if editingIdx === idx}
									<div class="flex items-center gap-1.5">
										<Input
											bind:value={editValue}
											class="h-7 text-xs"
											placeholder="hostname.example.com"
										/>
										<Button
											variant="ghost"
											size="sm"
											class="h-7 w-7 p-0 text-emerald-500"
											onclick={saveEdit}
										>
											<Check class="h-3 w-3" />
										</Button>
										<Button variant="ghost" size="sm" class="h-7 w-7 p-0" onclick={cancelEdit}>
											<X class="h-3 w-3" />
										</Button>
									</div>
								{:else}
									<span class="text-sm text-fyra-gray-400">
										{ip.rdns || '—'}
									</span>
								{/if}
							</td>
							<td class="px-5 py-3 text-right">
								{#if editingIdx !== idx}
									<Button
										variant="ghost"
										size="sm"
										class="h-7 w-7 p-0"
										onclick={() => startEdit(idx)}
									>
										<Pencil class="h-3 w-3" />
									</Button>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<!-- Private Networks Section -->
		<div>
			<div class="flex items-center justify-between px-5 py-3">
				<div class="flex items-center gap-2">
					<Network class="h-3.5 w-3.5 text-fyra-gray-500" />
					<span class="text-xs font-semibold tracking-wider text-fyra-gray-500 uppercase"
						>Private Networks</span
					>
				</div>
				<Button
					variant="outline"
					size="sm"
					class="h-7 gap-1.5 px-3 text-xs"
					onclick={() => (createNetOpen = true)}
				>
					<Plus class="h-3 w-3" />
					Create Network
				</Button>
			</div>
			<table class="w-full">
				<thead>
					<tr class="border-y border-fyra-gray-800/50">
						<th class="px-5 py-2.5 text-left text-xs font-medium text-fyra-gray-500">Name</th>
						<th class="px-5 py-2.5 text-left text-xs font-medium text-fyra-gray-500">CIDR</th>
						<th class="px-5 py-2.5 text-left text-xs font-medium text-fyra-gray-500">Servers</th>
						<th class="px-5 py-2.5 text-left text-xs font-medium text-fyra-gray-500">Enabled</th>
						<th class="px-5 py-2.5 text-right text-xs font-medium text-fyra-gray-500"></th>
					</tr>
				</thead>
				<tbody class="divide-y divide-fyra-gray-800/50">
					{#each networks as net (net.id)}
						<tr class="transition-colors duration-100 hover:bg-fyra-gray-800/20">
							<td class="px-5 py-3">
								<span class="text-sm font-medium text-fyra-gray-100">{net.name}</span>
								<span class="ml-2 text-xs text-fyra-gray-600">{net.id}</span>
							</td>
							<td class="px-5 py-3 font-mono text-sm text-fyra-gray-300">{net.cidr}</td>
							<td class="px-5 py-3">
								<div class="flex flex-wrap gap-1">
									{#each net.servers as s (s)}
										<Badge variant="secondary" class="text-[10px]">{s}</Badge>
									{/each}
									{#if net.servers.length === 0}
										<span class="text-xs text-fyra-gray-500">None</span>
									{/if}
								</div>
							</td>
							<td class="px-5 py-3">
								<Switch bind:checked={net.enabled} size="sm" />
							</td>
							<td class="px-5 py-3 text-right">
								<Button
									variant="ghost"
									size="sm"
									class="h-7 w-7 p-0 text-fyra-red-400 hover:text-fyra-red-300"
									onclick={() => deleteNetwork(net.id)}
								>
									<Trash2 class="h-3 w-3" />
								</Button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>

			{#if networks.length === 0}
				<div class="flex flex-col items-center justify-center py-16 text-fyra-gray-500">
					<Network class="mb-3 h-8 w-8" />
					<p class="text-sm">No private networks</p>
				</div>
			{/if}
		</div>
	</div>
</div>

<!-- Create Network Dialog -->
<Dialog.Root bind:open={createNetOpen}>
	<Dialog.Content class="border-fyra-gray-800 bg-fyra-gray-900 sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Create Private Network</Dialog.Title>
			<Dialog.Description>Create an isolated network for your servers.</Dialog.Description>
		</Dialog.Header>
		<div class="flex flex-col gap-4 py-4">
			<div class="flex flex-col gap-2">
				<Label>Name</Label>
				<Input bind:value={newNetName} placeholder="my-network" />
			</div>
			<div class="flex flex-col gap-2">
				<Label>CIDR Block</Label>
				<Input bind:value={newNetCidr} placeholder="10.0.0.0/16" />
				<p class="text-xs text-fyra-gray-500">
					Private IPv4 range. Must not overlap existing networks.
				</p>
			</div>
		</div>
		<Dialog.Footer>
			<Button variant="outline" size="sm" onclick={() => (createNetOpen = false)}>Cancel</Button>
			<Button size="sm" onclick={createNetwork} disabled={!newNetName.trim()}>Create</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
