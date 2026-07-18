<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import CreateNetworkDialog from '$lib/components/dialogs/create-network-dialog.svelte';
	import Check from '~icons/lucide/check';
	import Plus from '~icons/lucide/plus';
	import X from '~icons/lucide/x';
	import Globe from '~icons/nucleo/globe';
	import Network from '~icons/nucleo/network';
	import Pencil from '~icons/nucleo/pencil';
	import Trash2 from '~icons/nucleo/trash';

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
	<div class="flex h-10 shrink-0 items-center gap-2 border-b border-border px-5">
		<Network class="h-4 w-4 text-muted-foreground" />
		<span class="text-sm font-semibold text-foreground">Networking</span>
	</div>

	<div class="border-b border-border bg-background/40 px-5 py-2 text-xs text-muted-foreground">
		Preview: networking isn't live yet. Changes here aren't saved.
	</div>

	<div class="flex-1 overflow-auto">
		<!-- IP Addresses Section -->
		<div class="border-b border-border">
			<div class="flex items-center gap-2 px-5 py-3">
				<Globe class="size-4 text-muted-foreground" />
				<span class="text-xs font-semibold tracking-wider text-muted-foreground uppercase"
					>IP Addresses</span
				>
			</div>
			<table class="w-full whitespace-nowrap">
				<thead>
					<tr class="border-y border-border/50">
						<th class="px-5 py-2.5 text-left text-xs font-medium text-muted-foreground">Address</th>
						<th class="px-5 py-2.5 text-left text-xs font-medium text-muted-foreground">Type</th>
						<th class="px-5 py-2.5 text-left text-xs font-medium text-muted-foreground">Server</th>
						<th class="px-5 py-2.5 text-left text-xs font-medium text-muted-foreground"
							>Reverse DNS</th
						>
						<th class="px-5 py-2.5 text-right text-xs font-medium text-muted-foreground"></th>
					</tr>
				</thead>
				<tbody class="divide-y divide-border/50">
					{#each ips as ip, idx (ip.address)}
						<tr class="transition-colors duration-100 hover:bg-muted/20">
							<td class="px-5 py-3 font-mono text-sm text-foreground">{ip.address}</td>
							<td class="px-5 py-3">
								<Badge variant="secondary" class="text-[10px]">{ip.type}</Badge>
							</td>
							<td class="px-5 py-3 text-sm text-muted-foreground">{ip.server}</td>
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
											aria-label="Save reverse DNS"
											onclick={saveEdit}
										>
											<Check class="h-3 w-3" />
										</Button>
										<Button
											variant="ghost"
											size="sm"
											class="h-7 w-7 p-0"
											aria-label="Cancel editing reverse DNS"
											onclick={cancelEdit}
										>
											<X class="h-3 w-3" />
										</Button>
									</div>
								{:else}
									<span class="text-sm text-muted-foreground">
										{ip.rdns || '-'}
									</span>
								{/if}
							</td>
							<td class="px-5 py-3 text-right">
								{#if editingIdx !== idx}
									<Button
										variant="ghost"
										size="sm"
										class="h-7 w-7 p-0"
										aria-label={`Edit reverse DNS for ${ip.address}`}
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
					<Network class="size-4 text-muted-foreground" />
					<span class="text-xs font-semibold tracking-wider text-muted-foreground uppercase"
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
			<table class="w-full whitespace-nowrap">
				<thead>
					<tr class="border-y border-border/50">
						<th class="px-5 py-2.5 text-left text-xs font-medium text-muted-foreground">Name</th>
						<th class="px-5 py-2.5 text-left text-xs font-medium text-muted-foreground">CIDR</th>
						<th class="px-5 py-2.5 text-left text-xs font-medium text-muted-foreground">Servers</th>
						<th class="px-5 py-2.5 text-left text-xs font-medium text-muted-foreground">Enabled</th>
						<th class="px-5 py-2.5 text-right text-xs font-medium text-muted-foreground"></th>
					</tr>
				</thead>
				<tbody class="divide-y divide-border/50">
					{#each networks as net (net.id)}
						<tr class="transition-colors duration-100 hover:bg-muted/20">
							<td class="px-5 py-3">
								<span class="text-sm font-medium text-foreground">{net.name}</span>
								<span class="ml-2 text-xs text-muted-foreground">{net.id}</span>
							</td>
							<td class="px-5 py-3 font-mono text-sm text-muted-foreground">{net.cidr}</td>
							<td class="px-5 py-3">
								<div class="flex flex-wrap gap-1">
									{#each net.servers as s (s)}
										<Badge variant="secondary" class="text-[10px]">{s}</Badge>
									{/each}
									{#if net.servers.length === 0}
										<span class="text-xs text-muted-foreground">None</span>
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
									class="h-7 w-7 p-0 text-red-400 hover:text-red-300"
									aria-label={`Delete network ${net.name}`}
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
				<div class="flex flex-col items-center justify-center py-16 text-muted-foreground">
					<Network class="mb-3 h-8 w-8" />
					<p class="text-sm">No private networks</p>
				</div>
			{/if}
		</div>
	</div>
</div>

<!-- Create Network Dialog -->
<CreateNetworkDialog
	bind:open={createNetOpen}
	bind:name={newNetName}
	bind:cidr={newNetCidr}
	onSubmit={createNetwork}
/>
