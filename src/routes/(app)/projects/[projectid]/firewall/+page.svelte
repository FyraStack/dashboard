<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import CreateFirewallGroupDialog from '$lib/components/dialogs/create-firewall-group-dialog.svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Shield, Plus, Trash2, ChevronRight } from '@lucide/svelte';

	type FirewallRule = {
		id: number;
		direction: 'inbound' | 'outbound';
		protocol: string;
		ports: string;
		source: string;
		enabled: boolean;
	};

	type FirewallGroup = {
		id: string;
		name: string;
		servers: string[];
		rules: FirewallRule[];
	};

	let ruleIdCounter = $state(10);

	let groups = $state<FirewallGroup[]>([
		{
			id: 'fw-web',
			name: 'web-servers',
			servers: ['vps-747762', 'vps-742736'],
			rules: [
				{
					id: 1,
					direction: 'inbound',
					protocol: 'TCP',
					ports: '80',
					source: '0.0.0.0/0',
					enabled: true
				},
				{
					id: 2,
					direction: 'inbound',
					protocol: 'TCP',
					ports: '443',
					source: '0.0.0.0/0',
					enabled: true
				},
				{
					id: 3,
					direction: 'inbound',
					protocol: 'TCP',
					ports: '22',
					source: '10.0.0.0/8',
					enabled: true
				},
				{
					id: 4,
					direction: 'outbound',
					protocol: 'TCP',
					ports: '5432',
					source: '10.132.0.0/16',
					enabled: true
				},
				{
					id: 5,
					direction: 'inbound',
					protocol: 'TCP',
					ports: '3306',
					source: '0.0.0.0/0',
					enabled: false
				}
			]
		},
		{
			id: 'fw-db',
			name: 'database',
			servers: ['vps-747762'],
			rules: [
				{
					id: 6,
					direction: 'inbound',
					protocol: 'TCP',
					ports: '5432',
					source: '10.132.0.0/16',
					enabled: true
				},
				{
					id: 7,
					direction: 'inbound',
					protocol: 'TCP',
					ports: '22',
					source: '10.0.0.0/8',
					enabled: true
				},
				{
					id: 8,
					direction: 'outbound',
					protocol: 'ALL',
					ports: '*',
					source: '0.0.0.0/0',
					enabled: true
				}
			]
		}
	]);

	let selectedGroupId = $state('fw-web');
	let selectedGroup = $derived(groups.find((g) => g.id === selectedGroupId) ?? groups[0]);

	// Add rule dialog
	let addRuleOpen = $state(false);
	let newDirection = $state<'inbound' | 'outbound'>('inbound');
	let newProtocol = $state('TCP');
	let newPorts = $state('');
	let newSource = $state('0.0.0.0/0');
	let addingRule = $state(false);

	// Create group dialog
	let createGroupOpen = $state(false);
	let newGroupName = $state('');
	let groupCounter = $state(2);
	let creatingGroup = $state(false);

	function addRule() {
		if (!newPorts.trim() || addingRule) return;
		addingRule = true;
		ruleIdCounter++;
		const groupIdx = groups.findIndex((g) => g.id === selectedGroup.id);
		if (groupIdx === -1) return;
		groups[groupIdx].rules.push({
			id: ruleIdCounter,
			direction: newDirection,
			protocol: newProtocol,
			ports: newPorts.trim(),
			source: newSource.trim() || '0.0.0.0/0',
			enabled: true
		});
		newDirection = 'inbound';
		newProtocol = 'TCP';
		newPorts = '';
		newSource = '0.0.0.0/0';
		addRuleOpen = false;
		addingRule = false;
	}

	function deleteRule(ruleId: number) {
		const groupIdx = groups.findIndex((g) => g.id === selectedGroup.id);
		if (groupIdx === -1) return;
		groups[groupIdx].rules = groups[groupIdx].rules.filter((r) => r.id !== ruleId);
	}

	function createGroup() {
		if (!newGroupName.trim() || creatingGroup) return;
		creatingGroup = true;
		groupCounter++;
		const newG: FirewallGroup = {
			id: `fw-${groupCounter}`,
			name: newGroupName.trim(),
			servers: [],
			rules: []
		};
		groups.push(newG);
		selectedGroupId = newG.id;
		newGroupName = '';
		createGroupOpen = false;
		creatingGroup = false;
	}

	function deleteGroup(id: string) {
		groups = groups.filter((g) => g.id !== id);
		if (selectedGroupId === id && groups.length > 0) {
			selectedGroupId = groups[0].id;
		}
	}
</script>

<div class="flex flex-1 flex-col overflow-hidden">
	<div class="border-b border-gray-800 bg-gray-900/40 px-5 py-2 text-xs text-gray-500">
		Preview — firewall isn't live yet. Changes here aren't saved.
	</div>
	<div class="flex flex-1 overflow-hidden">
		<!-- Groups sidebar -->
		<div class="flex w-64 shrink-0 flex-col border-r border-gray-800">
			<div class="flex h-10 shrink-0 items-center justify-between border-b border-gray-800 px-4">
				<div class="flex items-center gap-2">
					<Shield class="h-4 w-4 text-gray-400" />
					<span class="text-sm font-semibold text-gray-100">Firewall</span>
				</div>
				<Button
					variant="ghost"
					size="sm"
					class="h-7 w-7 p-0"
					onclick={() => (createGroupOpen = true)}
				>
					<Plus class="h-3.5 w-3.5" />
				</Button>
			</div>
			<div class="flex-1 overflow-y-auto">
				{#each groups as group (group.id)}
					<button
						class="flex w-full items-center justify-between border-b border-gray-800 px-4 py-3 text-left transition-colors duration-100 {selectedGroupId ===
						group.id
							? 'bg-gray-800/60'
							: 'hover:bg-gray-800/30'}"
						onclick={() => (selectedGroupId = group.id)}
					>
						<div class="min-w-0">
							<p class="truncate text-sm font-semibold text-gray-100">{group.name}</p>
							<p class="mt-0.5 text-xs text-gray-500">
								{group.rules.length} rules &bull; {group.servers.length} servers
							</p>
						</div>
						<ChevronRight class="h-3.5 w-3.5 shrink-0 text-gray-500" />
					</button>
				{/each}

				{#if groups.length === 0}
					<div class="flex flex-col items-center justify-center py-16 text-gray-500">
						<Shield class="mb-3 h-6 w-6" />
						<p class="text-xs">No firewall groups</p>
					</div>
				{/if}
			</div>
		</div>

		<!-- Rules panel -->
		{#if selectedGroup}
			<div class="flex flex-1 flex-col overflow-hidden">
				<!-- Group header -->
				<div class="flex h-10 shrink-0 items-center justify-between border-b border-gray-800 px-5">
					<div class="flex items-center gap-2">
						<span class="text-sm font-medium text-gray-200">{selectedGroup.name}</span>
						<span class="text-gray-500">&middot;</span>
						<div class="flex gap-1">
							{#each selectedGroup.servers as s (s)}
								<Badge variant="secondary" class="text-[10px]">{s}</Badge>
							{/each}
							{#if selectedGroup.servers.length === 0}
								<span class="text-xs text-gray-500">No servers assigned</span>
							{/if}
						</div>
					</div>
					<div class="flex items-center gap-1.5">
						<Button
							variant="outline"
							size="sm"
							class="h-7 gap-1.5 px-3 text-xs"
							onclick={() => (addRuleOpen = true)}
						>
							<Plus class="h-3 w-3" />
							Add Rule
						</Button>
						<Button
							variant="ghost"
							size="sm"
							class="h-7 px-2 text-xs text-red-400 hover:text-red-300"
							onclick={() => deleteGroup(selectedGroup.id)}
						>
							<Trash2 class="h-3 w-3" />
						</Button>
					</div>
				</div>

				<!-- Inbound rules -->
				<div class="flex-1 overflow-auto">
					<div class="px-5 py-3">
						<span class="text-xs font-semibold tracking-wider text-gray-500 uppercase"
							>Inbound Rules</span
						>
					</div>
					<table class="w-full whitespace-nowrap">
						<thead>
							<tr class="border-y border-gray-800/50">
								<th class="px-5 py-2 text-left text-xs font-medium text-gray-500">Protocol</th>
								<th class="px-5 py-2 text-left text-xs font-medium text-gray-500">Ports</th>
								<th class="px-5 py-2 text-left text-xs font-medium text-gray-500">Source</th>
								<th class="px-5 py-2 text-left text-xs font-medium text-gray-500">Enabled</th>
								<th class="px-5 py-2 text-right text-xs font-medium text-gray-500"></th>
							</tr>
						</thead>
						<tbody class="divide-y divide-gray-800/30">
							{#each selectedGroup.rules.filter((r) => r.direction === 'inbound') as rule (rule.id)}
								<tr class="transition-colors duration-100 hover:bg-gray-800/20">
									<td class="px-5 py-2.5">
										<Badge variant="outline" class="text-[10px]">{rule.protocol}</Badge>
									</td>
									<td class="px-5 py-2.5 font-mono text-sm text-gray-200">{rule.ports}</td>
									<td class="px-5 py-2.5 font-mono text-sm text-gray-400">{rule.source}</td>
									<td class="px-5 py-2.5">
										<Switch bind:checked={rule.enabled} size="sm" />
									</td>
									<td class="px-5 py-2.5 text-right">
										<Button
											variant="ghost"
											size="sm"
											class="h-7 w-7 p-0 text-red-400 hover:text-red-300"
											onclick={() => deleteRule(rule.id)}
										>
											<Trash2 class="h-3 w-3" />
										</Button>
									</td>
								</tr>
							{/each}
							{#if selectedGroup.rules.filter((r) => r.direction === 'inbound').length === 0}
								<tr>
									<td colspan="5" class="px-5 py-6 text-center text-xs text-gray-500"
										>No inbound rules</td
									>
								</tr>
							{/if}
						</tbody>
					</table>

					<div class="mt-4 px-5 py-3">
						<span class="text-xs font-semibold tracking-wider text-gray-500 uppercase"
							>Outbound Rules</span
						>
					</div>
					<table class="w-full whitespace-nowrap">
						<thead>
							<tr class="border-y border-gray-800/50">
								<th class="px-5 py-2 text-left text-xs font-medium text-gray-500">Protocol</th>
								<th class="px-5 py-2 text-left text-xs font-medium text-gray-500">Ports</th>
								<th class="px-5 py-2 text-left text-xs font-medium text-gray-500">Destination</th>
								<th class="px-5 py-2 text-left text-xs font-medium text-gray-500">Enabled</th>
								<th class="px-5 py-2 text-right text-xs font-medium text-gray-500"></th>
							</tr>
						</thead>
						<tbody class="divide-y divide-gray-800/30">
							{#each selectedGroup.rules.filter((r) => r.direction === 'outbound') as rule (rule.id)}
								<tr class="transition-colors duration-100 hover:bg-gray-800/20">
									<td class="px-5 py-2.5">
										<Badge variant="outline" class="text-[10px]">{rule.protocol}</Badge>
									</td>
									<td class="px-5 py-2.5 font-mono text-sm text-gray-200">{rule.ports}</td>
									<td class="px-5 py-2.5 font-mono text-sm text-gray-400">{rule.source}</td>
									<td class="px-5 py-2.5">
										<Switch bind:checked={rule.enabled} size="sm" />
									</td>
									<td class="px-5 py-2.5 text-right">
										<Button
											variant="ghost"
											size="sm"
											class="h-7 w-7 p-0 text-red-400 hover:text-red-300"
											onclick={() => deleteRule(rule.id)}
										>
											<Trash2 class="h-3 w-3" />
										</Button>
									</td>
								</tr>
							{/each}
							{#if selectedGroup.rules.filter((r) => r.direction === 'outbound').length === 0}
								<tr>
									<td colspan="5" class="px-5 py-6 text-center text-xs text-gray-500"
										>No outbound rules</td
									>
								</tr>
							{/if}
						</tbody>
					</table>
				</div>
			</div>
		{/if}
	</div>
</div>

<!-- Add Rule Dialog -->
<Dialog.Root bind:open={addRuleOpen}>
	<Dialog.Content class="border-gray-800 bg-gray-900 sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Add Firewall Rule</Dialog.Title>
			<Dialog.Description>Add a rule to {selectedGroup?.name}.</Dialog.Description>
		</Dialog.Header>
		<div class="flex flex-col gap-4 py-4">
			<div class="flex gap-3">
				<div class="flex flex-1 flex-col gap-2">
					<Label>Direction</Label>
					<select
						bind:value={newDirection}
						class="w-full appearance-none border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-gray-500 focus:outline-none"
					>
						<option value="inbound">Inbound</option>
						<option value="outbound">Outbound</option>
					</select>
				</div>
				<div class="flex flex-1 flex-col gap-2">
					<Label>Protocol</Label>
					<select
						bind:value={newProtocol}
						class="w-full appearance-none border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-gray-500 focus:outline-none"
					>
						<option value="TCP">TCP</option>
						<option value="UDP">UDP</option>
						<option value="ICMP">ICMP</option>
						<option value="ALL">ALL</option>
					</select>
				</div>
			</div>
			<div class="flex flex-col gap-2">
				<Label>Port(s)</Label>
				<Input bind:value={newPorts} placeholder="80, 443, 8000-9000" />
				<p class="text-xs text-gray-500">Single port, comma-separated, or range.</p>
			</div>
			<div class="flex flex-col gap-2">
				<Label>{newDirection === 'inbound' ? 'Source' : 'Destination'}</Label>
				<Input bind:value={newSource} placeholder="0.0.0.0/0" />
			</div>
		</div>
		<Dialog.Footer>
			<Button
				variant="outline"
				size="sm"
				onclick={() => (addRuleOpen = false)}
				disabled={addingRule}>Cancel</Button
			>
			<Button size="sm" onclick={addRule} disabled={!newPorts.trim() || addingRule}
				>{addingRule ? 'Adding...' : 'Add Rule'}</Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<!-- Create Group Dialog -->
<CreateFirewallGroupDialog
	bind:open={createGroupOpen}
	bind:name={newGroupName}
	submitting={creatingGroup}
	onSubmit={createGroup}
/>
