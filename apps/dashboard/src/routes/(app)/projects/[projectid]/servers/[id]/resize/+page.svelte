<script lang="ts">
	import { getServerWithFallback } from '$lib/state/servers.svelte';
	import { Button } from '$lib/components/ui/button';

	let { data } = $props();
	let selectedServer = $derived(getServerWithFallback(data.serverId, data.server));
	const resizePlans = [
		{ name: 'STACK-XXS', vcpu: 2, ram: '2GB', disk: '40GB', price: '$5/mo' },
		{ name: 'STACK-XS', vcpu: 4, ram: '4GB', disk: '80GB', price: '$10/mo' },
		{ name: 'STACK-SM', vcpu: 6, ram: '8GB', disk: '160GB', price: '$20/mo' },
		{ name: 'STACK-MD', vcpu: 8, ram: '16GB', disk: '320GB', price: '$34/mo' }
	];
</script>

<div class="space-y-4 p-5">
	<p class="border border-border bg-background/40 px-3 py-2 text-xs text-muted-foreground">
		Resizing isn't available yet.
	</p>
	<div class="grid gap-3 md:grid-cols-2">
		{#each resizePlans as plan (plan.name)}
			<div class="border border-border bg-background/40 p-4">
				<div class="flex items-center justify-between">
					<h3 class="text-sm font-semibold text-foreground">{plan.name}</h3>
					<span class="text-sm text-muted-foreground">{plan.price}</span>
				</div>
				<p class="mt-2 text-xs text-muted-foreground">
					{plan.vcpu} vCPU • {plan.ram} RAM • {plan.disk} disk
				</p>
				<Button variant="outline" size="sm" class="mt-4 h-7 text-xs" disabled
					>{selectedServer.plan === plan.name ? 'Current Plan' : 'Resize'}</Button
				>
			</div>
		{/each}
	</div>
</div>
