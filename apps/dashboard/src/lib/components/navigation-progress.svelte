<script lang="ts">
	import { navigating } from '$app/state';

	const APPEAR_DELAY_MS = 120;
	const TRICKLE_INTERVAL_MS = 200;
	const TRICKLE_CEILING = 90;
	const FADE_OUT_MS = 220;

	let visible = $state(false);
	let width = $state(0);
	let dimmed = $state(false);

	let appearTimer: ReturnType<typeof setTimeout> | null = null;
	let trickleTimer: ReturnType<typeof setInterval> | null = null;
	let fadeTimer: ReturnType<typeof setTimeout> | null = null;

	function clearAppear() {
		if (appearTimer === null) return;
		clearTimeout(appearTimer);
		appearTimer = null;
	}

	function clearTrickle() {
		if (trickleTimer === null) return;
		clearInterval(trickleTimer);
		trickleTimer = null;
	}

	function clearFade() {
		if (fadeTimer === null) return;
		clearTimeout(fadeTimer);
		fadeTimer = null;
	}

	function startTrickle() {
		clearTrickle();
		trickleTimer = setInterval(() => {
			width = Math.min(width + (TRICKLE_CEILING - width) * 0.14, TRICKLE_CEILING);
		}, TRICKLE_INTERVAL_MS);
	}

	function start() {
		clearFade();
		dimmed = false;
		if (appearTimer !== null) return;
		if (visible) {
			if (trickleTimer === null) {
				width = 12;
				startTrickle();
			}
			return;
		}
		appearTimer = setTimeout(() => {
			appearTimer = null;
			visible = true;
			width = 12;
			startTrickle();
		}, APPEAR_DELAY_MS);
	}

	function finish() {
		clearAppear();
		clearTrickle();
		if (!visible) return;
		width = 100;
		fadeTimer = setTimeout(() => {
			dimmed = true;
			fadeTimer = setTimeout(() => {
				visible = false;
				width = 0;
				dimmed = false;
			}, FADE_OUT_MS);
		}, 80);
	}

	$effect(() => {
		if (navigating.to) start();
		else finish();
	});

	$effect(() => () => {
		clearAppear();
		clearTrickle();
		clearFade();
	});
</script>

{#if visible}
	<div
		class="pointer-events-none fixed inset-x-0 top-0 z-[200] h-0.5"
		role="progressbar"
		aria-label="Page loading"
		aria-busy="true"
	>
		<div
			class="h-full bg-red-500 transition-[width,opacity] ease-out"
			style="width: {width}%; opacity: {dimmed ? 0 : 1}; transition-duration: {dimmed
				? FADE_OUT_MS
				: TRICKLE_INTERVAL_MS}ms; box-shadow: 0 0 8px var(--red-500);"
		></div>
	</div>
{/if}
