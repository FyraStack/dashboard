<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import Check from '~icons/lucide/check';
	import Copy from '~icons/nucleo/copy';
	import Power from '~icons/nucleo/power';
	import PowerOff from '~icons/nucleo/power-off';
	import RotateCw from '~icons/nucleo/rotate-cw';
	import { getColocationContext } from '../../colocation-context.svelte';

	const colo = getColocationContext();
	let copied = $state('');
	let ipmiPassword = $state('');
	let showIpmi = $state(false);
	let ipmiAction = $state('');
	let generatingIpmiPassword = $state(false);

	function copyText(text: string, label: string) {
		navigator.clipboard.writeText(text);
		copied = label;
		setTimeout(() => (copied = ''), 1500);
	}

	function generateIpmiPassword() {
		if (generatingIpmiPassword) return;
		generatingIpmiPassword = true;
		ipmiPassword = Array.from(
			{ length: 16 },
			() =>
				'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$'[
					Math.floor(Math.random() * 58)
				]
		).join('');
		showIpmi = true;
		generatingIpmiPassword = false;
	}

	function ipmiCommand(action: string) {
		if (ipmiAction) return;
		ipmiAction = action;
		if (action === 'power-on') {
			colo.updateSelectedUnit({
				status: 'online',
				powerDraw: `${Math.floor(Math.random() * 150 + 100)}W`
			});
			setTimeout(() => (ipmiAction = ''), 1500);
		} else if (action === 'power-off') {
			colo.updateSelectedUnit({ status: 'offline', powerDraw: '0W' });
			setTimeout(() => (ipmiAction = ''), 1500);
		} else if (action === 'reset') {
			colo.updateSelectedUnit({ status: 'provisioning' });
			setTimeout(() => {
				colo.updateSelectedUnit({ status: 'online' });
				ipmiAction = '';
			}, 3000);
		} else if (action === 'power-cycle') {
			colo.updateSelectedUnit({ status: 'offline', powerDraw: '0W' });
			setTimeout(() => {
				colo.updateSelectedUnit({
					status: 'online',
					powerDraw: `${Math.floor(Math.random() * 150 + 100)}W`
				});
				ipmiAction = '';
			}, 3000);
		} else {
			setTimeout(() => (ipmiAction = ''), 1500);
		}
	}
</script>

{#if colo.selectedUnit}
	<div class="flex-1 overflow-auto">
		<div class="divide-y divide-border/50">
			<div class="px-5 py-3">
				<span class="text-xs font-semibold tracking-wider text-muted-foreground uppercase"
					>IPMI Credentials</span
				>
			</div>
			{#if showIpmi}
				<div class="px-5 py-3">
					<div class="flex flex-col gap-2.5">
						<div class="flex items-center justify-between">
							<span class="text-xs text-muted-foreground">IPMI Address</span>
							<div class="flex items-center gap-1.5">
								<span class="font-mono text-xs text-foreground"
									>ipmi-{colo.selectedUnit.id}.stack.sh</span
								>
								<button
									class="text-muted-foreground hover:text-foreground"
									aria-label="Copy IPMI address"
									onclick={() => copyText(`ipmi-${colo.selectedUnit!.id}.stack.sh`, 'ipmi-host')}
								>
									{#if copied === 'ipmi-host'}<Check class="h-3 w-3 text-emerald-500" />{:else}<Copy
											class="h-3 w-3"
										/>{/if}
								</button>
							</div>
						</div>
						<div class="flex items-center justify-between">
							<span class="text-xs text-muted-foreground">Username</span>
							<span class="font-mono text-xs text-foreground">admin</span>
						</div>
						<div class="flex items-center justify-between">
							<span class="text-xs text-muted-foreground">Password</span>
							<div class="flex items-center gap-1.5">
								<code class="bg-muted px-2 py-0.5 font-mono text-xs text-foreground"
									>{ipmiPassword}</code
								>
								<button
									class="text-muted-foreground hover:text-foreground"
									aria-label="Copy IPMI password"
									onclick={() => copyText(ipmiPassword, 'ipmi-pw')}
								>
									{#if copied === 'ipmi-pw'}<Check class="h-3 w-3 text-emerald-500" />{:else}<Copy
											class="h-3 w-3"
										/>{/if}
								</button>
							</div>
						</div>
						<Button
							variant="outline"
							size="sm"
							class="w-fit gap-1.5 text-xs"
							onclick={generateIpmiPassword}
							disabled={generatingIpmiPassword}
							>{generatingIpmiPassword ? 'Regenerating...' : 'Regenerate Password'}</Button
						>
					</div>
				</div>
			{:else}
				<div class="px-5 py-3">
					<Button
						variant="outline"
						size="sm"
						class="gap-1.5 text-xs"
						onclick={generateIpmiPassword}
						disabled={generatingIpmiPassword}
					>
						<Power class="h-3 w-3" />
						{generatingIpmiPassword ? 'Generating...' : 'Generate IPMI Credentials'}
					</Button>
				</div>
			{/if}

			<div class="px-5 py-3">
				<span class="text-xs font-semibold tracking-wider text-muted-foreground uppercase"
					>Power Control</span
				>
			</div>
			<div class="px-5 py-3">
				<div class="grid grid-cols-2 gap-2">
					<Button
						variant="outline"
						size="sm"
						class="h-9 gap-1.5 text-xs"
						disabled={ipmiAction !== '' || colo.selectedUnit.status === 'online'}
						onclick={() => ipmiCommand('power-on')}
					>
						<Power class="h-3 w-3" />
						{ipmiAction === 'power-on' ? 'Powering on...' : 'Power On'}
					</Button>
					<Button
						variant="outline"
						size="sm"
						class="h-9 gap-1.5 border-red-300 text-xs text-red-700 hover:bg-red-100 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950"
						disabled={ipmiAction !== '' || colo.selectedUnit.status === 'offline'}
						onclick={() => ipmiCommand('power-off')}
					>
						<PowerOff class="h-3 w-3" />
						{ipmiAction === 'power-off' ? 'Powering off...' : 'Power Off'}
					</Button>
					<Button
						variant="outline"
						size="sm"
						class="h-9 gap-1.5 text-xs"
						disabled={ipmiAction !== '' || colo.selectedUnit.status === 'offline'}
						onclick={() => ipmiCommand('reset')}
					>
						<RotateCw class="h-3 w-3 {ipmiAction === 'reset' ? 'animate-spin' : ''}" />
						{ipmiAction === 'reset' ? 'Resetting...' : 'Reset'}
					</Button>
					<Button
						variant="outline"
						size="sm"
						class="h-9 gap-1.5 text-xs"
						disabled={ipmiAction !== ''}
						onclick={() => ipmiCommand('power-cycle')}
					>
						<RotateCw class="h-3 w-3 {ipmiAction === 'power-cycle' ? 'animate-spin' : ''}" />
						{ipmiAction === 'power-cycle' ? 'Cycling...' : 'Power Cycle'}
					</Button>
				</div>
			</div>

			<div class="px-5 py-3">
				<span class="text-xs font-semibold tracking-wider text-muted-foreground uppercase"
					>Boot Options</span
				>
			</div>
			<div class="px-5 py-3">
				<div class="flex flex-col gap-2">
					<Button
						variant="outline"
						size="sm"
						class="w-fit gap-1.5 text-xs"
						onclick={() => ipmiCommand('bios-setup')}
						disabled={ipmiAction !== ''}
						>{ipmiAction === 'bios-setup'
							? 'Setting BIOS boot...'
							: 'Enter BIOS Setup on Next Boot'}</Button
					>
					<Button
						variant="outline"
						size="sm"
						class="w-fit gap-1.5 text-xs"
						onclick={() => ipmiCommand('pxe-boot')}
						disabled={ipmiAction !== ''}
						>{ipmiAction === 'pxe-boot'
							? 'Setting PXE boot...'
							: 'PXE Boot on Next Restart'}</Button
					>
				</div>
			</div>
		</div>
	</div>
{/if}
