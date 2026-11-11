import { defaultIsa } from 'stack-shared/compute';
import { toast } from 'svelte-sonner';
import { dependencies } from '#lib/dependencies.js';
import { compareVersionsDesc, guessVersionFromFilename } from '#lib/image-versions.js';
import { runOptimistic } from '#lib/optimistic.js';
import {
	createImage,
	deleteImage,
	type listImages,
	reorderImages,
	updateImage
} from '#lib/remote/images.remote.js';
import { getErrorMessage } from '#lib/utils.js';
import { invalidate } from '$app/navigation';
import type { PveImages } from './pve-images.svelte.ts';

export type BaseImage = Awaited<ReturnType<typeof listImages>>[number];

export interface ImageVersionDraft {
	error: string;
	filePath: string;
	id: string | null;
	key: number;
	removed: boolean;
	secureBoot: boolean;
	version: string;
}

type ImageVersionStatus = 'new' | 'changed' | 'removed' | 'unchanged';

export interface ImageGroup {
	name: string;
	representative: BaseImage;
	versions: BaseImage[];
}

const defaultColor = 'bg-gray-600';
const defaultAccentColor = '#6b7280';

interface ImageListAccess {
	get: () => BaseImage[];
	set: (images: BaseImage[]) => void;
}

export class ImageEditor {
	open = $state(false);
	groupName = $state<string | null>(null);
	detailsExpanded = $state(true);
	saving = $state(false);
	error = $state('');
	name = $state('');
	description = $state('');
	icon = $state('');
	color = $state(defaultColor);
	isOfficial = $state(false);
	logoSvg = $state('');
	accentColor = $state(defaultAccentColor);
	rows = $state<ImageVersionDraft[]>([]);
	#rowSeq = 0;
	readonly #list: ImageListAccess;
	readonly #pve: PveImages;

	constructor(list: ImageListAccess, pve: PveImages) {
		this.#list = list;
		this.#pve = pve;
	}

	get images() {
		return this.#list.get();
	}

	get groups(): ImageGroup[] {
		const groups = new Map<string, BaseImage[]>();
		for (const image of this.images) {
			const existing = groups.get(image.name);
			if (existing) {
				existing.push(image);
			} else {
				groups.set(image.name, [image]);
			}
		}
		return Array.from(groups, ([name, versions]) => {
			const sorted = [...versions].sort((a, b) => compareVersionsDesc(a.version, b.version));
			return { name, representative: sorted[0], versions: sorted };
		});
	}

	get isNew() {
		return this.groupName === null;
	}

	get activeRows() {
		return this.rows.filter((row) => !row.removed);
	}

	get sharedChanged() {
		if (this.groupName === null) {
			return false;
		}
		const rep = this.groups.find((g) => g.name === this.groupName)?.representative;
		if (!rep) {
			return true;
		}
		const shared = this.#sharedData();
		return (
			shared.name !== rep.name ||
			shared.description !== rep.description ||
			shared.color !== rep.color ||
			shared.isOfficial !== rep.isOfficial ||
			shared.accentColor !== rep.accentColor ||
			shared.icon !== (rep.icon ?? '') ||
			shared.logoSvg !== (rep.isOfficial ? (rep.logoSvg ?? '') : '')
		);
	}

	get pending() {
		const counts = { new: 0, changed: 0, removed: 0 };
		for (const row of this.rows) {
			const status = this.rowStatus(row);
			if (status !== 'unchanged') {
				counts[status] += 1;
			}
		}
		return { ...counts, details: this.sharedChanged };
	}

	get hasChanges() {
		const { details, new: added, changed, removed } = this.pending;
		return details || added + changed + removed > 0;
	}

	get rowsValid() {
		const volids = new Set(this.#pve.images.map((image) => image.volid));
		const active = this.activeRows;
		if (active.length === 0 && this.groupName === null) {
			return false;
		}
		return active.every((row) => row.version.trim() && volids.has(row.filePath));
	}

	get duplicateVersions(): string[] {
		const seen = new Set<string>();
		const dupes = new Set<string>();
		for (const row of this.activeRows) {
			const version = row.version.trim().toLowerCase();
			if (!version) {
				continue;
			}
			if (seen.has(version)) {
				dupes.add(row.version.trim());
			}
			seen.add(version);
		}
		return [...dupes];
	}

	get canSave() {
		if (this.saving || !this.hasChanges) {
			return false;
		}
		if (this.activeRows.length === 0) {
			return this.groupName !== null;
		}
		return Boolean(this.name.trim()) && this.rowsValid;
	}

	get pendingSummary() {
		const { new: added, changed, removed, details } = this.pending;
		const parts: string[] = [];
		if (details) {
			parts.push('details');
		}
		if (added) {
			parts.push(`${added} new`);
		}
		if (changed) {
			parts.push(`${changed} changed`);
		}
		if (removed) {
			parts.push(`${removed} removed`);
		}
		return parts.join(', ');
	}

	get saveLabel() {
		if (this.isNew) {
			return 'Create image';
		}
		if (this.activeRows.length === 0) {
			return 'Delete image';
		}
		return 'Save changes';
	}

	async openCreate(filePath = '') {
		this.groupName = null;
		this.#resetShared();
		this.detailsExpanded = true;
		this.rows = [this.#newRow({ filePath, version: guessVersionFromFilename(filePath) })];
		await this.#show();
	}

	async openManage(groupName: string) {
		const group = this.groups.find((g) => g.name === groupName);
		if (!group) {
			await this.openCreate();
			return;
		}
		this.#loadGroup(group);
		this.rows = group.versions.map((image) => this.#rowFromImage(image));
		await this.#show();
	}

	adoptExistingName() {
		if (this.groupName !== null) {
			return;
		}
		const name = this.name.trim();
		const group = this.groups.find((g) => g.name === name);
		if (!group) {
			return;
		}
		const pending = this.rows.filter((row) => row.version.trim() || row.filePath);
		this.#loadGroup(group);
		this.rows = [
			...group.versions.map((image) => this.#rowFromImage(image)),
			...(pending.length > 0
				? pending
				: [this.#newRow({ secureBoot: group.representative.secureBoot })])
		];
	}

	addRow() {
		const last = this.rows.findLast((row) => !row.removed);
		this.rows.push(this.#newRow({ secureBoot: last?.secureBoot ?? true }));
	}

	toggleRemoveRow(row: ImageVersionDraft) {
		if (row.id === null) {
			this.rows = this.rows.filter((r) => r.key !== row.key);
			return;
		}
		row.removed = !row.removed;
	}

	removeAll() {
		this.rows = this.rows.filter((row) => row.id !== null);
		for (const row of this.rows) {
			row.removed = true;
		}
	}

	rowFileChanged(row: ImageVersionDraft) {
		if (!row.version.trim()) {
			row.version = guessVersionFromFilename(row.filePath);
		}
	}

	rowStatus(row: ImageVersionDraft): ImageVersionStatus {
		if (row.id === null) {
			return 'new';
		}
		if (row.removed) {
			return 'removed';
		}
		const original = this.images.find((image) => image.id === row.id);
		if (
			!original ||
			original.version !== row.version.trim() ||
			original.filePath !== row.filePath ||
			original.secureBoot !== row.secureBoot
		) {
			return 'changed';
		}
		return 'unchanged';
	}

	fileUsedBy(volid: string, rowId: string | null) {
		const other = this.images.find((image) => image.filePath === volid && image.id !== rowId);
		return other ? `${other.name} ${other.version}`.trim() : null;
	}

	async save() {
		if (!this.canSave) {
			return;
		}
		this.saving = true;
		this.error = '';
		for (const row of this.rows) {
			row.error = '';
		}

		const shared = this.#sharedData();
		const { sharedChanged } = this;
		const remoteShared = {
			name: shared.name,
			description: shared.description,
			color: shared.color,
			isOfficial: shared.isOfficial,
			accentColor: shared.accentColor,
			isa: defaultIsa,
			...(shared.icon ? { icon: shared.icon } : {})
		};
		const versionData = (row: ImageVersionDraft) => ({
			version: row.version.trim(),
			filePath: row.filePath,
			secureBoot: row.secureBoot
		});
		let failed = false;

		try {
			const existingWork = this.rows
				.filter((row) => row.id !== null)
				.map(async (row) => {
					const id = row.id as string;
					const status = this.rowStatus(row);
					try {
						if (status === 'removed') {
							await deleteImage({ imageId: id });
							this.rows = this.rows.filter((r) => r.key !== row.key);
						} else if (status === 'changed' || sharedChanged) {
							const data = {
								...(sharedChanged ? { ...remoteShared, logoSvg: shared.logoSvg } : {}),
								...versionData(row)
							};
							await updateImage({ imageId: id, ...data });
						}
					} catch (err) {
						failed = true;
						row.error = getErrorMessage(err, 'Failed to save');
					}
				});
			await Promise.all(existingWork);

			for (const row of this.rows.filter((r) => r.id === null)) {
				try {
					// biome-ignore lint/performance/noAwaitInLoops: preserve insertion order for sortOrder
					const result = await createImage({
						...remoteShared,
						...(shared.logoSvg ? { logoSvg: shared.logoSvg } : {}),
						...versionData(row)
					});
					row.id = result.id;
				} catch (err) {
					failed = true;
					row.error = getErrorMessage(err, 'Failed to create');
				}
			}

			await invalidate(dependencies.admin.images);

			if (failed) {
				this.error = 'Some changes failed to save. Fix the highlighted rows and try again.';
				if (this.images.some((image) => image.name === shared.name)) {
					this.groupName = shared.name;
				}
				return;
			}
			this.open = false;
		} catch (err) {
			this.error = getErrorMessage(err, 'Failed to save');
		} finally {
			this.saving = false;
		}
	}

	async reorderGroups(fromIndex: number, toIndex: number) {
		const { groups } = this;
		if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) {
			return;
		}
		if (fromIndex >= groups.length || toIndex >= groups.length) {
			return;
		}
		const nextGroups = [...groups];
		const [moved] = nextGroups.splice(fromIndex, 1);
		nextGroups.splice(toIndex, 0, moved);
		const next = nextGroups.flatMap((group) => group.versions);
		try {
			await runOptimistic({
				apply: () => {
					const previous = this.images;
					this.#list.set(next);
					return () => this.#list.set(previous);
				},
				commit: () => reorderImages({ imageIds: next.map((image) => image.id) }),
				invalidates: [dependencies.admin.images]
			});
		} catch (err) {
			toast.error(getErrorMessage(err, 'Failed to reorder images'));
		}
	}

	async #show() {
		this.error = '';
		this.saving = false;
		this.open = true;
		if (this.#pve.images.length === 0) {
			await this.#pve.load();
		}
	}

	#newRow(partial: Partial<ImageVersionDraft> = {}): ImageVersionDraft {
		this.#rowSeq += 1;
		return {
			key: this.#rowSeq,
			id: null,
			version: '',
			filePath: '',
			secureBoot: true,
			removed: false,
			error: '',
			...partial
		};
	}

	#rowFromImage(image: BaseImage) {
		return this.#newRow({
			id: image.id,
			version: image.version,
			filePath: image.filePath,
			secureBoot: image.secureBoot
		});
	}

	#resetShared(source?: BaseImage) {
		this.name = source?.name ?? '';
		this.description = source?.description ?? '';
		this.icon = source?.icon ?? '';
		this.color = source?.color ?? defaultColor;
		this.isOfficial = source?.isOfficial ?? false;
		this.logoSvg = source?.logoSvg ?? '';
		this.accentColor = source?.accentColor ?? defaultAccentColor;
	}

	#loadGroup(group: ImageGroup) {
		this.groupName = group.name;
		this.#resetShared(group.representative);
		this.detailsExpanded = false;
	}

	#sharedData() {
		return {
			name: this.name.trim(),
			description: this.description.trim(),
			color: this.color,
			isOfficial: this.isOfficial,
			accentColor: this.accentColor.trim() || defaultAccentColor,
			icon: this.icon.trim(),
			logoSvg: this.isOfficial ? this.logoSvg.trim() : ''
		};
	}
}
