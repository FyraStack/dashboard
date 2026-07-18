<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Dialog from '$lib/components/ui/dialog';
	import {
		getVmBillingUsage,
		reverseVmBillingUsage,
		type VmBillingUsage
	} from '$lib/remote/admin-billing.remote';
	import { getErrorMessage, runQuery } from '$lib/utils';
	import { toast } from 'svelte-sonner';
	import Loader2 from '~icons/lucide/loader-2';
	import AlertTriangle from '~icons/nucleo/alert-triangle';
	import CreditCard from '~icons/nucleo/credit-card';

	type ReversalTarget = { id: string; name: string; projectName: string | null };

	let { open = $bindable(false), vm = null }: { open?: boolean; vm?: ReversalTarget | null } =
		$props();

	function monthStartIso() {
		const now = new Date();
		return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
	}

	function todayIso() {
		return new Date().toISOString().slice(0, 10);
	}

	let startDate = $state(monthStartIso());
	let endDate = $state(todayIso());
	let note = $state('');
	let usage = $state<VmBillingUsage | null>(null);
	let loading = $state(false);
	let loadError = $state('');
	let submitting = $state(false);
	let request = 0;
	let wasOpen = false;

	const periodStart = $derived(Date.parse(`${startDate}T00:00:00Z`));
	const periodEnd = $derived.by(() => {
		const end = Date.parse(`${endDate}T23:59:59.999Z`);
		return Number.isNaN(end) ? Number.NaN : Math.min(end, Date.now());
	});
	const windowValid = $derived(
		!Number.isNaN(periodStart) && !Number.isNaN(periodEnd) && periodStart < periodEnd
	);

	$effect(() => {
		if (open && !wasOpen) {
			startDate = monthStartIso();
			endDate = todayIso();
			note = '';
			usage = null;
			loadError = '';
		}
		wasOpen = open;

		const target = vm;
		if (!open || !target) return;
		if (!windowValid) {
			usage = null;
			return;
		}
		void loadUsage(target.id, periodStart, periodEnd);
	});

	async function loadUsage(vmId: string, start: number, end: number) {
		const current = ++request;
		loading = true;
		loadError = '';
		try {
			const result = await runQuery(
				getVmBillingUsage({ vmId, periodStart: start, periodEnd: end })
			);
			if (current !== request) return;
			usage = result;
		} catch (err) {
			if (current !== request) return;
			usage = null;
			loadError = getErrorMessage(err, 'Failed to load billed usage');
		} finally {
			if (current === request) loading = false;
		}
	}

	const canSubmit = $derived(
		!submitting && !loading && usage !== null && usage.reversibleHours > 0
	);

	async function submit() {
		if (!vm || !usage || !canSubmit) return;
		submitting = true;
		try {
			const result = await reverseVmBillingUsage({
				vmId: vm.id,
				periodStart: usage.periodStart,
				periodEnd: usage.periodEnd,
				...(note.trim() ? { note: note.trim() } : {})
			});
			const amount =
				result.estimatedAmount != null ? ` (about $${result.estimatedAmount.toFixed(2)})` : '';
			if (result.syncStatus === 'synced') {
				toast.success(`Reversed ${result.reversedHours} unit-hours${amount} for ${vm.name}`);
			} else {
				toast.warning(
					`Reversal recorded for ${vm.name}, but the Autumn sync failed. It will retry on the next billing run.`
				);
			}
			open = false;
		} catch (err) {
			toast.error(getErrorMessage(err, 'Failed to reverse billing'));
		} finally {
			submitting = false;
		}
	}

	function formatHours(value: number) {
		return value.toFixed(2);
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="border-border bg-background sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title class="text-base text-foreground">
				Reverse billing for {vm?.name}
			</Dialog.Title>
			<Dialog.Description class="text-xs text-muted-foreground">
				Credits back this server's metered usage in the selected window by recording a negative
				usage event in {vm?.projectName ?? 'its project'} and syncing it to Autumn.
			</Dialog.Description>
		</Dialog.Header>

		<div class="flex flex-col gap-4 pt-4">
			<div class="grid grid-cols-2 gap-3">
				<div class="flex flex-col gap-1.5">
					<Label>From</Label>
					<input
						type="date"
						bind:value={startDate}
						disabled={submitting}
						class="h-9 border border-border bg-muted px-3 text-sm text-foreground focus:border-ring focus:outline-none"
					/>
				</div>
				<div class="flex flex-col gap-1.5">
					<Label>To</Label>
					<input
						type="date"
						bind:value={endDate}
						disabled={submitting}
						class="h-9 border border-border bg-muted px-3 text-sm text-foreground focus:border-ring focus:outline-none"
					/>
				</div>
			</div>

			{#if loadError}
				<div
					class="flex items-center gap-2 border border-red-700 bg-red-950 px-3 py-2 text-sm text-red-400"
				>
					<AlertTriangle class="size-4 shrink-0" />{loadError}
				</div>
			{:else if !windowValid}
				<p class="text-xs text-muted-foreground">Pick a valid window to compute billed usage.</p>
			{:else if loading}
				<div class="flex items-center gap-2 py-2 text-xs text-muted-foreground">
					<Loader2 class="h-3.5 w-3.5 animate-spin" />
					Computing billed usage...
				</div>
			{:else if usage}
				<div class="flex flex-col gap-2 rounded-sm border border-border/60 bg-muted/20 p-3">
					<div class="flex items-center justify-between text-xs">
						<span class="text-muted-foreground">Billed in window</span>
						<span class="text-foreground">{formatHours(usage.billedHours)} unit-hours</span>
					</div>
					<div class="flex items-center justify-between text-xs">
						<span class="text-muted-foreground">Already reversed</span>
						<span class="text-foreground">{formatHours(usage.reversedHours)} unit-hours</span>
					</div>
					<div class="flex items-center justify-between text-xs">
						<span class="text-muted-foreground">To reverse</span>
						<span class="font-medium text-foreground"
							>{formatHours(usage.reversibleHours)} unit-hours</span
						>
					</div>
					{#if usage.estimatedAmount != null}
						<div class="flex items-center justify-between text-xs">
							<span class="text-muted-foreground">Estimated credit (before caps)</span>
							<span class="font-medium text-violet-400">${usage.estimatedAmount.toFixed(2)}</span>
						</div>
					{/if}
				</div>
				{#if usage.reversibleHours <= 0}
					<p class="text-xs text-muted-foreground">
						Nothing left to reverse in this window. Widen the dates to include more usage.
					</p>
				{/if}
			{/if}

			<div class="flex flex-col gap-1.5">
				<Label>
					Reason <span class="font-normal text-muted-foreground">(optional, sent to Autumn)</span>
				</Label>
				<Input
					bind:value={note}
					placeholder="Host outage on Jul 15"
					disabled={submitting}
					maxlength={200}
				/>
			</div>
		</div>

		<Dialog.Footer class="flex items-center gap-2 pt-4">
			<Button
				variant="outline"
				type="button"
				size="sm"
				class="border-border/50 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
				onclick={() => (open = false)}
				disabled={submitting}
			>
				Cancel
			</Button>
			<Button
				variant="destructive"
				size="sm"
				class="gap-1.5 text-xs"
				onclick={() => submit()}
				disabled={!canSubmit}
			>
				{#if submitting}
					<Loader2 class="h-3 w-3 animate-spin" />
					Reversing...
				{:else}
					<CreditCard class="h-3 w-3" />
					Reverse {usage ? formatHours(usage.reversibleHours) : '0.00'} unit-hours
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
