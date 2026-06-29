<script lang="ts">
	import SiLinux from '@icons-pack/svelte-simple-icons/icons/SiLinux';
	import SiAlmalinux from '@icons-pack/svelte-simple-icons/icons/SiAlmalinux';
	import SiAlpinelinux from '@icons-pack/svelte-simple-icons/icons/SiAlpinelinux';
	import SiCentos from '@icons-pack/svelte-simple-icons/icons/SiCentos';
	import SiDebian from '@icons-pack/svelte-simple-icons/icons/SiDebian';
	import SiFedora from '@icons-pack/svelte-simple-icons/icons/SiFedora';
	import SiRedhat from '@icons-pack/svelte-simple-icons/icons/SiRedhat';
	import SiUbuntu from '@icons-pack/svelte-simple-icons/icons/SiUbuntu';

	const icons = {
		fedora: SiFedora,
		debian: SiDebian,
		ubuntu: SiUbuntu,
		centos: SiCentos,
		almalinux: SiAlmalinux,
		'alma-linux': SiAlmalinux,
		redhat: SiRedhat,
		'red-hat': SiRedhat,
		alpine: SiAlpinelinux,
		linux: SiLinux,
		ultramarine: SiLinux
	} as const;

	let {
		name,
		class: className = '',
		title = undefined
	}: {
		name?: string | null;
		class?: string;
		title?: string;
	} = $props();

	const normalizedName = $derived.by(() =>
		name
			?.trim()
			.toLowerCase()
			.replace(/[_\s]+/g, '-')
	);
</script>

{#if normalizedName === 'fedora'}
	<SiFedora class={className} color="currentColor" {title} />
{:else if normalizedName === 'debian'}
	<SiDebian class={className} color="currentColor" {title} />
{:else if normalizedName === 'ubuntu'}
	<SiUbuntu class={className} color="currentColor" {title} />
{:else if normalizedName === 'centos'}
	<SiCentos class={className} color="currentColor" {title} />
{:else if normalizedName === 'almalinux' || normalizedName === 'alma-linux'}
	<SiAlmalinux class={className} color="currentColor" {title} />
{:else if normalizedName === 'redhat' || normalizedName === 'red-hat'}
	<SiRedhat class={className} color="currentColor" {title} />
{:else if normalizedName === 'alpine'}
	<SiAlpinelinux class={className} color="currentColor" {title} />
{:else}
	<SiLinux class={className} color="currentColor" {title} />
{/if}
