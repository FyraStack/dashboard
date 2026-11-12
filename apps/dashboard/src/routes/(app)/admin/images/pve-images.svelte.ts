import { listProxmoxImageImportTargets, listProxmoxImages } from '#lib/remote/images.remote.js';
import { getErrorMessage } from '#lib/utils.js';

type Awaited2<T> = T extends Promise<infer U> ? U : T;
export type PveImage = Awaited2<ReturnType<typeof listProxmoxImages>>[number];
export type PveImageImportTarget = Awaited2<
	ReturnType<typeof listProxmoxImageImportTargets>
>[number];

export class PveImages {
	images = $state<PveImage[]>([]);
	importTargets = $state<PveImageImportTarget[]>([]);
	loading = $state(false);
	error = $state('');

	async load() {
		this.loading = true;
		this.error = '';
		try {
			const imagesQuery = listProxmoxImages();
			const targetsQuery = listProxmoxImageImportTargets();
			await Promise.all([imagesQuery.refresh(), targetsQuery.refresh()]);
			const [images, targets] = await Promise.all([imagesQuery, targetsQuery]);
			this.images = images;
			this.importTargets = targets;
		} catch (err) {
			this.error = getErrorMessage(err, 'Failed to scan Proxmox images');
		} finally {
			this.loading = false;
		}
	}
}
