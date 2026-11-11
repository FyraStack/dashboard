import { config } from '#lib/config.js';
import { getProxmoxTaskStatus, importProxmoxImageFromUrl } from '#lib/remote/images.remote.js';
import { getErrorMessage } from '#lib/utils.js';
import type { PveImages } from './pve-images.svelte.ts';

type ChecksumAlgorithm = '' | 'md5' | 'sha1' | 'sha224' | 'sha256' | 'sha384' | 'sha512';

interface ImportTask {
	exitstatus?: string;
	node: string;
	status: 'starting' | 'running' | 'stopped';
	storage: string;
	upid: string;
}

const taskPollIntervalMs = 1500;

export class ImageImport {
	open = $state(false);
	url = $state('');
	filename = $state('');
	storage = $state(config.admin.defaultImageImportStorage);
	checksumAlgorithm = $state<ChecksumAlgorithm>('');
	checksum = $state('');
	verifyCertificates = $state(true);
	saving = $state(false);
	error = $state('');
	tasks = $state<ImportTask[]>([]);
	readonly #pve: PveImages;

	constructor(pve: PveImages) {
		this.#pve = pve;
	}

	get localTargets() {
		return this.#pve.importTargets.filter((target) => target.storage === this.storage);
	}

	async show() {
		this.url = '';
		this.filename = '';
		this.checksumAlgorithm = '';
		this.checksum = '';
		this.verifyCertificates = true;
		this.saving = false;
		this.error = '';
		this.storage = config.admin.defaultImageImportStorage;
		this.tasks = [];
		this.open = true;
		await this.#pve.load();
	}

	close() {
		if (!this.saving) {
			this.open = false;
		}
	}

	fillFilenameFromUrl() {
		try {
			this.filename = decodeURIComponent(new URL(this.url).pathname.split('/').pop() ?? '');
		} catch {
			const lastSegment = this.url.split('/').pop()?.split('?')[0]?.split('#')[0] ?? '';
			this.filename = decodeURIComponent(lastSegment);
		}
	}

	fillMissingFilename() {
		if (!this.filename.trim()) {
			this.fillFilenameFromUrl();
		}
	}

	async submit() {
		if (!this.url.trim()) {
			return;
		}
		this.fillMissingFilename();
		if (!this.filename.trim()) {
			return;
		}

		this.saving = true;
		this.error = '';
		this.tasks = [];
		try {
			const result = await importProxmoxImageFromUrl({
				storage: this.storage,
				url: this.url.trim(),
				filename: this.filename.trim(),
				...(this.checksumAlgorithm && { checksumAlgorithm: this.checksumAlgorithm }),
				...(this.checksum.trim() && { checksum: this.checksum.trim() }),
				verifyCertificates: this.verifyCertificates
			});
			this.storage = result.storage;
			this.tasks = result.tasks.map((task) => ({ ...task, status: 'starting' as const }));
			await this.#waitForTasks();
			await this.#pve.load();
			this.open = false;
		} catch (err) {
			this.error = getErrorMessage(err, 'Failed to import image');
		} finally {
			this.saving = false;
		}
	}

	async #waitForTasks() {
		let polling = true;
		while (polling) {
			// biome-ignore lint/performance/noAwaitInLoops: polls Proxmox task status on an interval until every import task stops
			await new Promise<void>((resolve) => setTimeout(resolve, taskPollIntervalMs));
			const statuses = await Promise.all(
				this.tasks.map(async (task) => {
					if (task.status === 'stopped') {
						return task;
					}
					const statusQuery = getProxmoxTaskStatus({ node: task.node, upid: task.upid });
					await statusQuery.refresh();
					const status = await statusQuery;
					return { ...task, status: status.status, exitstatus: status.exitstatus };
				})
			);
			this.tasks = statuses;
			const failed = statuses.find((task) => task.exitstatus && task.exitstatus !== 'OK');
			if (failed) {
				throw new Error(`Import failed on ${failed.node}: ${failed.exitstatus}`);
			}
			polling = !statuses.every((task) => task.status === 'stopped');
		}
	}
}
