<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { Button } from '#lib/components/ui/button/index.js';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import ExternalLink from '~icons/lucide/external-link';
	import { useServer } from '../lib/server-context';
	import SerialConsole from './serial-console.svelte';

	const POPOUT_FEATURES = 'popup,width=1024,height=640';

	const server = useServer();

	function popOut() {
		const href = resolve(
			`projects/${page.params.projectid ?? ''}/servers/${server.current.id}/console/window`
		);
		const popout = window.open(href, `serial-console-${server.current.id}`, POPOUT_FEATURES);
		if (popout) {
			popout.focus();
		} else {
			toast.error('Allow pop-ups for this site to pop out the console.');
		}
	}
</script>

<div class="flex min-h-0 flex-1 flex-col">
	<div class="flex h-9 shrink-0 items-center justify-end border-b border-border px-2">
		<Button variant="ghost" size="sm" class="h-7 gap-1.5 px-2 text-xs" onclick={popOut}>
			<ExternalLink class="h-3.5 w-3.5" />
			Pop out
		</Button>
	</div>
	<SerialConsole
		vmId={server.current.id}
		vmName={server.current.name}
		running={server.current.status === 'running'}
	/>
</div>
