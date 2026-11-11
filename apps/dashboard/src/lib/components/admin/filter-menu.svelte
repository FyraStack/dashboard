<script lang="ts" generics="T extends string">
	import { adminMenuItemClass } from '#lib/components/admin/menu-item-class.js';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
	import Check from '~icons/lucide/check';
	import ChevronDown from '~icons/lucide/chevron-down';

	interface FilterOption {
		detail?: string;
		label: string;
		value: T;
	}

	let {
		label,
		allLabel,
		options,
		value = $bindable('all'),
		contentClass = 'w-44'
	}: {
		allLabel: string;
		contentClass?: string;
		label: string;
		options: readonly FilterOption[];
		value?: T | 'all';
	} = $props();

	const summary = $derived(
		value === 'all' ? 'All' : (options.find((option) => option.value === value)?.label ?? value)
	);
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger
		class="flex h-8 items-center gap-1.5 rounded-md border border-border/50 px-3 text-xs transition-colors hover:bg-muted hover:text-foreground {value ===
		'all'
			? 'text-muted-foreground'
			: 'text-foreground'}"
	>
		{label}: {summary}
		<ChevronDown class="h-3 w-3 text-muted-foreground" />
	</DropdownMenu.Trigger>
	<DropdownMenu.Content class="{contentClass} border-border bg-background">
		<DropdownMenu.Item class={adminMenuItemClass} onSelect={() => (value = 'all')}>
			{allLabel}
			{#if value === 'all'}
				<Check class="ml-auto h-3 w-3 text-emerald-400" />
			{/if}
		</DropdownMenu.Item>
		<DropdownMenu.Separator class="bg-muted" />
		{#each options as option (option.value)}
			<DropdownMenu.Item class={adminMenuItemClass} onSelect={() => (value = option.value)}>
				{#if option.detail}
					<span class="flex min-w-0 flex-col">
						<span class="truncate">{option.label}</span>
						<span class="truncate text-[10px] text-muted-foreground">{option.detail}</span>
					</span>
				{:else}
					{option.label}
				{/if}
				{#if value === option.value}
					<Check class="ml-auto h-3 w-3 shrink-0 text-emerald-400" />
				{/if}
			</DropdownMenu.Item>
		{/each}
	</DropdownMenu.Content>
</DropdownMenu.Root>
