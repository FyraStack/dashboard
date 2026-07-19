<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import { confirmDestructive } from '$lib/confirm.svelte';
	import {
		listManagedHostPodman,
		runManagedHostPodmanContainerAction,
		type ManagedHost
	} from '$lib/remote/managed-hosts.remote';
	import { getErrorMessage } from '$lib/utils';
	import Loader2 from '~icons/lucide/loader-2';
	import RefreshCw from '~icons/lucide/refresh-cw';

	type PodmanResource = 'containers' | 'images' | 'volumes' | 'networks';

	type PageData = {
		host: ManagedHost;
	};

	let { data }: { data: PageData } = $props();
	const host = $derived(data.host);
	let podmanResource = $state<PodmanResource>('containers');
	let podmanData = $state<unknown[]>([]);
	let podmanCommand = $state<string | null>(null);
	let podmanLoading = $state(false);
	let podmanError = $state('');
	let podmanActionName = $state('');
	let loadedHostId = $state<string | null>(null);

	const podmanResources: { id: PodmanResource; label: string }[] = [
		{ id: 'containers', label: 'Containers' },
		{ id: 'images', label: 'Images' },
		{ id: 'volumes', label: 'Volumes' },
		{ id: 'networks', label: 'Networks' }
	];

	function asRecord(value: unknown): Record<string, unknown> {
		return typeof value === 'object' && value !== null && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {};
	}

	function field(record: Record<string, unknown>, keys: string[]) {
		for (const key of keys) {
			const value = record[key];
			if (Array.isArray(value)) return value.join(', ');
			if (value !== undefined && value !== null && String(value).trim()) return String(value);
		}
		return 'Unknown';
	}

	function podmanRowKey(item: unknown, index: number) {
		const record = asRecord(item);
		return field(record, ['Id', 'ID', 'Name', 'Names']) + `-${index}`;
	}

	function containerName(item: unknown) {
		return field(asRecord(item), ['Names', 'Name', 'Id', 'ID']);
	}

	$effect(() => {
		if (loadedHostId === host.id) return;
		loadedHostId = host.id;
		refreshPodman();
	});

	async function refreshPodman(resource: PodmanResource = podmanResource) {
		if (podmanLoading) return;
		podmanError = '';
		podmanLoading = true;
		try {
			const result = await listManagedHostPodman({ hostId: host.id, resource });
			podmanResource = resource;
			podmanData = result.data;
			podmanCommand = result.command;
		} catch (err) {
			podmanError = getErrorMessage(err, 'Failed to load Podman resources.');
		} finally {
			podmanLoading = false;
		}
	}

	async function runContainerAction(action: 'start' | 'stop' | 'restart' | 'remove', name: string) {
		if (podmanActionName) return;
		if (action === 'remove') {
			const ok = await confirmDestructive({
				title: 'Remove container',
				description: `This will remove ${name} from ${host.displayName}.`,
				confirmWord: name,
				confirmLabel: 'Remove container'
			});
			if (!ok) return;
		}

		podmanActionName = `${action}:${name}`;
		podmanError = '';
		try {
			await runManagedHostPodmanContainerAction({ hostId: host.id, name, action });
			await refreshPodman('containers');
		} catch (err) {
			podmanError = getErrorMessage(err, 'Podman action failed.');
		} finally {
			podmanActionName = '';
		}
	}

	function containerPath(name: string, section?: 'logs') {
		const path = `/projects/${page.params.projectid}/hosts/${host.id}/podman/${encodeURIComponent(name)}`;
		return section ? `${path}#${section}` : path;
	}

	function openContainer(name: string, section?: 'logs') {
		goto(containerPath(name, section));
	}
</script>

<section class="min-h-0 flex-1 overflow-auto bg-background p-5">
	<div class="flex flex-wrap items-center justify-between gap-4">
		<div>
			<h1 class="text-sm font-semibold text-foreground">Podman</h1>
			<p class="mt-1 text-xs text-muted-foreground">Inspect and manage containers on this host.</p>
		</div>
		<Button
			variant="outline"
			size="sm"
			class="gap-2"
			onclick={() => refreshPodman()}
			disabled={podmanLoading}
		>
			{#if podmanLoading}
				<Loader2 class="size-3.5 animate-spin" />
			{:else}
				<RefreshCw class="size-3.5" />
			{/if}
			Refresh
		</Button>
	</div>

	<div class="mt-4 flex flex-wrap gap-2">
		{#each podmanResources as resource (resource.id)}
			<Button
				variant={podmanResource === resource.id ? 'default' : 'outline'}
				size="sm"
				onclick={() => refreshPodman(resource.id)}
				disabled={podmanLoading}
			>
				{resource.label}
			</Button>
		{/each}
	</div>

	{#if podmanError}
		<div class="mt-4 border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
			{podmanError}
		</div>
	{/if}

	<div class="mt-4 overflow-hidden border border-border">
		{#if podmanLoading && podmanData.length === 0}
			<div class="flex items-center gap-2 p-4 text-xs text-muted-foreground">
				<Loader2 class="size-3.5 animate-spin" />
				Loading Podman {podmanResource}
			</div>
		{:else if podmanData.length === 0}
			<div class="p-4 text-xs text-muted-foreground">No Podman {podmanResource} found.</div>
		{:else}
			<div class="overflow-auto">
				<table class="w-full min-w-[720px] text-left text-xs">
					<thead class="border-b border-border bg-muted/30 text-muted-foreground">
						<tr>
							{#if podmanResource === 'containers'}
								<th class="px-3 py-2 font-medium">Name</th>
								<th class="px-3 py-2 font-medium">Image</th>
								<th class="px-3 py-2 font-medium">State</th>
								<th class="px-3 py-2 font-medium">Status</th>
								<th class="px-3 py-2 text-right font-medium">Actions</th>
							{:else if podmanResource === 'images'}
								<th class="px-3 py-2 font-medium">Repository</th>
								<th class="px-3 py-2 font-medium">Tag</th>
								<th class="px-3 py-2 font-medium">Image ID</th>
								<th class="px-3 py-2 font-medium">Size</th>
							{:else if podmanResource === 'volumes'}
								<th class="px-3 py-2 font-medium">Name</th>
								<th class="px-3 py-2 font-medium">Driver</th>
								<th class="px-3 py-2 font-medium">Mountpoint</th>
							{:else}
								<th class="px-3 py-2 font-medium">Name</th>
								<th class="px-3 py-2 font-medium">Driver</th>
								<th class="px-3 py-2 font-medium">Interface</th>
							{/if}
						</tr>
					</thead>
					<tbody class="divide-y divide-border">
						{#each podmanData as item, index (podmanRowKey(item, index))}
							{@const record = asRecord(item)}
							<tr>
								{#if podmanResource === 'containers'}
									{@const name = containerName(item)}
									<td class="max-w-56 px-3 py-2 font-medium text-foreground">
										<span class="block truncate">{name}</span>
									</td>
									<td class="max-w-64 px-3 py-2 text-muted-foreground">
										<span class="block truncate">{field(record, ['Image'])}</span>
									</td>
									<td class="px-3 py-2 text-muted-foreground">{field(record, ['State'])}</td>
									<td class="max-w-56 px-3 py-2 text-muted-foreground">
										<span class="block truncate">{field(record, ['Status'])}</span>
									</td>
									<td class="px-3 py-2">
										<div class="flex justify-end gap-1">
											{#each ['start', 'stop', 'restart'] as action (action)}
												<Button
													variant="outline"
													size="sm"
													class="h-7 px-2 text-[11px]"
													onclick={() =>
														runContainerAction(action as 'start' | 'stop' | 'restart', name)}
													disabled={!!podmanActionName}
												>
													{podmanActionName === `${action}:${name}` ? '...' : action}
												</Button>
											{/each}
											<Button
												variant="outline"
												size="sm"
												class="h-7 px-2 text-[11px] text-destructive dark:text-red-300"
												onclick={() => runContainerAction('remove', name)}
												disabled={!!podmanActionName}
											>
												Remove
											</Button>
											<Button
												variant="outline"
												size="sm"
												class="h-7 px-2 text-[11px]"
												onclick={() => openContainer(name)}
											>
												Edit
											</Button>
											<Button
												variant="outline"
												size="sm"
												class="h-7 px-2 text-[11px]"
												onclick={() => openContainer(name, 'logs')}
											>
												Logs
											</Button>
										</div>
									</td>
								{:else if podmanResource === 'images'}
									<td class="max-w-72 px-3 py-2 font-medium text-foreground">
										<span class="block truncate">{field(record, ['Repository'])}</span>
									</td>
									<td class="px-3 py-2 text-muted-foreground">{field(record, ['Tag'])}</td>
									<td class="max-w-56 px-3 py-2 font-mono text-muted-foreground">
										<span class="block truncate">{field(record, ['Id', 'ID', 'ImageID'])}</span>
									</td>
									<td class="px-3 py-2 text-muted-foreground">{field(record, ['Size'])}</td>
								{:else if podmanResource === 'volumes'}
									<td class="px-3 py-2 font-medium text-foreground">{field(record, ['Name'])}</td>
									<td class="px-3 py-2 text-muted-foreground">{field(record, ['Driver'])}</td>
									<td class="max-w-96 px-3 py-2 text-muted-foreground">
										<span class="block truncate">{field(record, ['Mountpoint'])}</span>
									</td>
								{:else}
									<td class="px-3 py-2 font-medium text-foreground">{field(record, ['Name'])}</td>
									<td class="px-3 py-2 text-muted-foreground">{field(record, ['Driver'])}</td>
									<td class="px-3 py-2 text-muted-foreground">
										{field(record, ['NetworkInterface', 'Interface'])}
									</td>
								{/if}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
</section>
