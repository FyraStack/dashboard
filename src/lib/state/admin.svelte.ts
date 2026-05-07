import { createImage, deleteImage, listProxmoxIsos, updateImage } from '$lib/remote/images.remote';
import { invalidate } from '$app/navigation';
import { updateFeatureFlag } from '$lib/remote/feature-flags.remote';
import { createVmType, deleteVmType, updateVmType } from '$lib/remote/vm-types.remote';
import { untrack } from 'svelte';
import {
	defaultFeatureFlags,
	featureFlagKeys,
	type FeatureFlagKey,
	type FeatureFlags
} from '$lib/feature-flags';

export type VmIsa = 'x86' | 'arm' | 'risc-v';

export type VmType = {
	id: string;
	name: string;
	isa: string;
	cores: number;
	ramCapacity: number;
	storageAmount: number;
	rate: string;
	cap: string;
	autumnFeatureId: string | null;
};

export type BaseImage = {
	id: string;
	name: string;
	version: string;
	description: string;
	shortName: string;
	icon: string | null | undefined;
	color: string;
	filePath: string;
	isa: string;
};

export type PveIso = {
	volid: string;
	filename: string;
	size: number;
	node: string;
};

export type AdminPageData = {
	vmTypes?: VmType[];
	images?: BaseImage[];
	featureFlags?: FeatureFlags;
};

export const colorOptions = [
	'bg-blue-500',
	'bg-sky-600',
	'bg-red-700',
	'bg-orange-600',
	'bg-yellow-600',
	'bg-indigo-600',
	'bg-cyan-700',
	'bg-red-600',
	'bg-emerald-600',
	'bg-purple-600',
	'bg-pink-600',
	'bg-gray-600'
];

function toIsa(value: string): VmIsa {
	return value === 'arm' || value === 'risc-v' ? value : 'x86';
}

function createFeatureFlagSaving() {
	return Object.fromEntries(featureFlagKeys.map((key) => [key, false])) as Record<
		FeatureFlagKey,
		boolean
	>;
}

export class AdminState {
	vmTypes = $state<VmType[]>([]);
	images = $state<BaseImage[]>([]);
	featureFlags = $state<FeatureFlags>({ ...defaultFeatureFlags });
	featureFlagSaving = $state<Record<FeatureFlagKey, boolean>>(createFeatureFlagSaving());
	featureFlagError = $state('');
	featureFlagSyncCooldowns = $state<Partial<Record<FeatureFlagKey, number>>>({});
	vtDialogOpen = $state(false);
	vtEditing = $state<VmType | null>(null);
	vtSaving = $state(false);
	vtError = $state('');
	vtName = $state('');
	vtIsa = $state<VmIsa>('x86');
	vtCores = $state(1);
	vtRam = $state(512);
	vtStorage = $state(10);
	vtRate = $state('0.00');
	vtCap = $state('5.00');
	vtAutumnFeatureId = $state('');
	pveIsos = $state<PveIso[]>([]);
	isoLoading = $state(false);
	isoError = $state('');
	imgDialogOpen = $state(false);
	imgEditing = $state<BaseImage | null>(null);
	imgSaving = $state(false);
	imgError = $state('');
	imgName = $state('');
	imgVersion = $state('');
	imgDescription = $state('');
	imgShortName = $state('');
	imgIcon = $state('');
	imgColor = $state('bg-gray-600');
	imgFilePath = $state('');
	imgIsa = $state<VmIsa>('x86');

	sync(data: AdminPageData) {
		this.vmTypes = [...(data.vmTypes ?? [])];
		this.images = [...(data.images ?? [])];
		const incoming = data.featureFlags ?? { ...defaultFeatureFlags };
		this.featureFlags = untrack(() =>
			Object.fromEntries(
				featureFlagKeys.map((key) => [
					key,
					this.featureFlagSyncCooldowns[key] && Date.now() < this.featureFlagSyncCooldowns[key]
						? this.featureFlags[key]
						: incoming[key]
				])
			)
		) as FeatureFlags;
	}

	async toggleFeatureFlag(flag: FeatureFlagKey, enabled: boolean) {
		const previousEnabled = this.featureFlags[flag];
		this.featureFlagError = '';
		this.featureFlagSaving[flag] = true;
		this.featureFlagSyncCooldowns[flag] = Date.now() + 2000;
		this.featureFlags = { ...this.featureFlags, [flag]: enabled };
		try {
			await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
			const result = await updateFeatureFlag({ flag, enabled });
			this.featureFlags = result.featureFlags;
			await invalidate('app:feature-flags');
		} catch (err) {
			this.featureFlags = { ...this.featureFlags, [flag]: previousEnabled };
			this.featureFlagError = err instanceof Error ? err.message : 'Failed to update feature flag';
		} finally {
			this.featureFlagSaving[flag] = false;
		}
	}

	vtOpenCreate() {
		this.vtEditing = null;
		this.vtName = '';
		this.vtIsa = 'x86';
		this.vtCores = 1;
		this.vtRam = 512;
		this.vtStorage = 10;
		this.vtRate = '0.00';
		this.vtCap = '5.00';
		this.vtAutumnFeatureId = '';
		this.vtError = '';
		this.vtDialogOpen = true;
	}

	vtOpenEdit(vt: VmType) {
		this.vtEditing = vt;
		this.vtName = vt.name;
		this.vtIsa = toIsa(vt.isa);
		this.vtCores = vt.cores;
		this.vtRam = vt.ramCapacity;
		this.vtStorage = vt.storageAmount;
		this.vtRate = vt.rate;
		this.vtCap = vt.cap;
		this.vtAutumnFeatureId = vt.autumnFeatureId ?? '';
		this.vtError = '';
		this.vtDialogOpen = true;
	}

	async vtSave() {
		if (!this.vtName.trim()) return;
		this.vtSaving = true;
		this.vtError = '';
		try {
			const data = {
				name: this.vtName.trim(),
				isa: this.vtIsa,
				cores: this.vtCores,
				ramCapacity: this.vtRam,
				storageAmount: this.vtStorage,
				rate: this.vtRate,
				cap: this.vtCap,
				autumnFeatureId: this.vtAutumnFeatureId.trim()
			};

			if (this.vtEditing) {
				await updateVmType({ vmTypeId: this.vtEditing.id, ...data });
				const index = this.vmTypes.findIndex((vmType) => vmType.id === this.vtEditing?.id);
				if (index !== -1) this.vmTypes[index] = { ...this.vmTypes[index], ...data };
			} else {
				const result = await createVmType(data);
				this.vmTypes.push({ id: result.id, ...data });
			}

			this.vtDialogOpen = false;
		} catch (err) {
			this.vtError = err instanceof Error ? err.message : 'Failed to save';
		} finally {
			this.vtSaving = false;
		}
	}

	async vtRemove(id: string) {
		try {
			await deleteVmType({ vmTypeId: id });
			this.vmTypes = this.vmTypes.filter((vmType) => vmType.id !== id);
		} catch (err) {
			alert(err instanceof Error ? err.message : 'Failed to delete');
		}
	}

	async loadPveIsos() {
		this.isoLoading = true;
		this.isoError = '';
		try {
			this.pveIsos = await listProxmoxIsos();
		} catch (err) {
			this.isoError = err instanceof Error ? err.message : 'Failed to scan Proxmox ISOs';
		} finally {
			this.isoLoading = false;
		}
	}

	imgOpenCreate() {
		this.imgEditing = null;
		this.imgName = '';
		this.imgVersion = '';
		this.imgDescription = '';
		this.imgShortName = '';
		this.imgIcon = '';
		this.imgColor = 'bg-gray-600';
		this.imgFilePath = '';
		this.imgIsa = 'x86';
		this.imgError = '';
		this.imgDialogOpen = true;
		if (this.pveIsos.length === 0) this.loadPveIsos();
	}

	imgOpenEdit(img: BaseImage) {
		this.imgEditing = img;
		this.imgName = img.name;
		this.imgVersion = img.version;
		this.imgDescription = img.description;
		this.imgShortName = img.shortName;
		this.imgIcon = img.icon ?? '';
		this.imgColor = img.color;
		this.imgFilePath = img.filePath;
		this.imgIsa = toIsa(img.isa);
		this.imgError = '';
		this.imgDialogOpen = true;
		if (this.pveIsos.length === 0) this.loadPveIsos();
	}

	async imgSave() {
		if (!this.imgName.trim() || !this.imgFilePath.trim()) return;
		this.imgSaving = true;
		this.imgError = '';
		try {
			const data = {
				name: this.imgName.trim(),
				version: this.imgVersion.trim(),
				description: this.imgDescription.trim(),
				shortName: this.imgShortName.trim(),
				icon: this.imgIcon.trim() || undefined,
				color: this.imgColor,
				filePath: this.imgFilePath.trim(),
				isa: this.imgIsa
			};

			if (this.imgEditing) {
				await updateImage({ imageId: this.imgEditing.id, ...data });
				const index = this.images.findIndex((image) => image.id === this.imgEditing?.id);
				if (index !== -1) this.images[index] = { ...this.images[index], ...data };
			} else {
				const result = await createImage(data);
				this.images.push({ id: result.id, ...data });
			}

			this.imgDialogOpen = false;
		} catch (err) {
			this.imgError = err instanceof Error ? err.message : 'Failed to save';
		} finally {
			this.imgSaving = false;
		}
	}

	async imgRemove(id: string) {
		try {
			await deleteImage({ imageId: id });
			this.images = this.images.filter((image) => image.id !== id);
		} catch (err) {
			alert(err instanceof Error ? err.message : 'Failed to delete');
		}
	}
}
