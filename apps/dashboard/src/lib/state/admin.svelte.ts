import {
	createImage,
	deleteImage,
	getProxmoxTaskStatus,
	importProxmoxImageFromUrl,
	listProxmoxImageImportTargets,
	listProxmoxImages,
	reorderImages,
	updateImage
} from '$lib/remote/images.remote';
import { goto, invalidate } from '$app/navigation';
import {
	listAdminUsers,
	setUserAdmin,
	setUserBillingExempt,
	setUserDisabled,
	setUserTwoFactor,
	setUserRole,
	deleteUserWithVerification,
	getUserResources,
	getOrganizationResources,
	type AdminUser,
	type UserSession,
	type UserAccount,
	type UserOrganization,
	type UserSshKey,
	type UserApiToken
} from '$lib/remote/admin-users.remote';
import { config } from '$lib/config';
import { updateFeatureFlag } from '$lib/remote/feature-flags.remote';
import {
	adminDeleteVm,
	adminKillVm,
	adminRebootVm,
	adminStartVm,
	adminStopVm,
	listAllAdminVms,
	type AdminVm
} from '$lib/remote/admin-vms.remote';
import {
	createVmType,
	deleteVmType,
	reorderVmTypes,
	updateVmType
} from '$lib/remote/vm-types.remote';
import { toast } from 'svelte-sonner';
import { getErrorMessage, runQuery } from '$lib/utils';
import { untrack } from 'svelte';
import {
	defaultFeatureFlags,
	featureFlagKeys,
	type FeatureFlagKey,
	type FeatureFlags
} from '$lib/feature-flags';
import { page } from '$app/state';

export type VmIsa = 'x86';

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
	icon: string | null | undefined;
	color: string;
	isOfficial: boolean;
	logoSvg: string | null | undefined;
	accentColor: string;
	imageType: string;
	filePath: string;
	isa: string;
};

export type PveImage = {
	volid: string;
	filename: string;
	size: number;
	node: string;
	storage: string;
	content: 'import';
	format: string;
};

export type PveImageImportTarget = {
	node: string;
	storage: string;
};

export type IpamPrefix = {
	id: string;
	name: string;
	cidr: string;
	family: 'ipv4' | 'ipv6';
	disabled: boolean;
	ipv6UseTransitAddress: boolean;
	whitelistStart: string | null;
	whitelistEnd: string | null;
	gatewayAddress: string | null;
	allocated: number;
	capacity: string;
	available: string;
	hasCapacity: boolean;
};

type ImportChecksumAlgorithm = '' | 'md5' | 'sha1' | 'sha224' | 'sha256' | 'sha384' | 'sha512';
type ImportTask = {
	node: string;
	storage: string;
	upid: string;
	status: 'starting' | 'running' | 'stopped';
	exitstatus?: string;
};

export type AdminPageData = {
	vmTypes?: VmType[];
	images?: BaseImage[];
	featureFlags?: FeatureFlags;
	adminUsers?: AdminUser[];
	ipamPrefixes?: IpamPrefix[];
	adminVms?: AdminVm[];
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

export class AdminState {
	vmTypes = $state<VmType[]>([]);
	images = $state<BaseImage[]>([]);
	ipamPrefixes = $state<IpamPrefix[]>([]);
	adminUsers = $state<AdminUser[]>([]);
	adminUserSaving = $state<Record<string, boolean>>({});
	adminUserError = $state('');
	adminVms = $state<AdminVm[]>([]);
	adminVmSaving = $state<Record<string, string>>({});
	adminVmError = $state('');

	userSheetOpen = $state(false);
	selectedUser = $state<AdminUser | null>(null);
	userSheetSaving = $state<Record<string, { field: string; saving: boolean }>>({});
	twoFADialogOpen = $state(false);
	twoFAPendingUserId = $state('');
	twoFAPendingValue = $state(false);

	userResourcesOpen = $state<'session' | 'account' | 'org' | 'sshKey' | 'apiToken' | null>(null);
	userResourcesLoading = $state(false);
	userSessions = $state<UserSession[]>([]);
	userAccounts = $state<UserAccount[]>([]);
	userOrgs = $state<UserOrganization[]>([]);
	userSshKeys = $state<UserSshKey[]>([]);
	userApiTokens = $state<UserApiToken[]>([]);

	orgResourcesOpen = $state(false);
	selectedOrg = $state<UserOrganization | null>(null);
	orgResourcesLoading = $state(false);
	orgVms = $state<{ id: string; name: string; status: string; createdAt: number }[]>([]);
	orgVolumes = $state<{ id: string; name: string; size: number; createdAt: number }[]>([]);
	featureFlags = $state<FeatureFlags>({ ...defaultFeatureFlags });
	featureFlagSaving = $state<Record<FeatureFlagKey, boolean>>(
		Object.fromEntries(featureFlagKeys.map((key) => [key, false])) as Record<
			FeatureFlagKey,
			boolean
		>
	);
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
	pveImages = $state<PveImage[]>([]);
	pveImageImportTargets = $state<PveImageImportTarget[]>([]);
	isoLoading = $state(false);
	isoError = $state('');
	importDialogOpen = $state(false);
	importUrl = $state('');
	importFilename = $state('');
	importStorage = $state(config.admin.defaultImageImportStorage);
	importChecksumAlgorithm = $state<ImportChecksumAlgorithm>('');
	importChecksum = $state('');
	importVerifyCertificates = $state(true);
	importSaving = $state(false);
	importError = $state('');
	importTasks = $state<ImportTask[]>([]);
	imgDialogOpen = $state(false);
	imgEditing = $state<BaseImage | null>(null);
	imgSaving = $state(false);
	imgError = $state('');
	imgName = $state('');
	imgVersion = $state('');
	imgDescription = $state('');
	imgIcon = $state('');
	imgColor = $state('bg-gray-600');
	imgIsOfficial = $state(false);
	imgLogoSvg = $state('');
	imgAccentColor = $state('#6b7280');
	imgFilePath = $state('');
	imgIsa = $state<VmIsa>('x86');

	constructor(data?: AdminPageData) {
		if (data) {
			this.sync(data);
		}
	}

	sync(data: AdminPageData) {
		this.vmTypes = [...(data.vmTypes ?? [])];
		this.images = [...(data.images ?? [])];
		this.ipamPrefixes = [...(data.ipamPrefixes ?? [])];
		this.adminUsers = [...(data.adminUsers ?? [])];
		this.adminVms = [...(data.adminVms ?? [])];
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

	async setUserAdmin(userId: string, isAdmin: boolean) {
		const previousUsers = this.adminUsers.map((adminUser) => ({ ...adminUser }));
		this.adminUserError = '';
		this.adminUserSaving[userId] = true;
		this.adminUsers = this.adminUsers.map((adminUser) =>
			adminUser.id === userId ? { ...adminUser, isAdmin } : adminUser
		);
		try {
			await setUserAdmin({ userId, isAdmin });
			this.adminUsers = await runQuery(listAdminUsers());
			await invalidate('app:admin-users');
		} catch (err) {
			this.adminUsers = previousUsers;
			this.adminUserError = getErrorMessage(err, 'Failed to update admin access');
		} finally {
			this.adminUserSaving[userId] = false;
			if (userId === page.data.user.id && !isAdmin) {
				await goto('/');
			}
		}
	}

	openUserSheet(user: AdminUser) {
		this.selectedUser = { ...user };
		this.userSheetOpen = true;
	}

	closeUserSheet() {
		this.userSheetOpen = false;
		this.selectedUser = null;
	}

	private updateUserField(userId: string, field: string, updater: (user: AdminUser) => AdminUser) {
		this.adminUsers = this.adminUsers.map((u) => (u.id === userId ? updater(u) : u));
		if (this.selectedUser?.id === userId) {
			this.selectedUser = updater({ ...this.selectedUser });
		}
	}

	private startUserSheetSave(userId: string, field: string) {
		this.userSheetSaving[userId] = { field, saving: true };
	}

	private stopUserSheetSave(userId: string) {
		this.userSheetSaving[userId] = { field: '', saving: false };
	}

	private isSheetSaving(userId: string) {
		return this.userSheetSaving[userId]?.saving ?? false;
	}

	async setUserDisabled(userId: string, disabled: boolean) {
		const previousUsers = this.adminUsers.map((u) => ({ ...u }));
		this.adminUserError = '';
		this.startUserSheetSave(userId, 'disabled');
		this.updateUserField(userId, 'disabled', (u) => ({ ...u, disabled }));
		try {
			await setUserDisabled({ userId, disabled });
			await invalidate('app:admin-users');
		} catch (err) {
			this.adminUsers = previousUsers;
			this.adminUserError = getErrorMessage(err, 'Failed to update status');
		} finally {
			this.stopUserSheetSave(userId);
		}
	}

	async setUserBillingExempt(userId: string, billingExempt: boolean) {
		const previousUsers = this.adminUsers.map((u) => ({ ...u }));
		this.adminUserError = '';
		this.startUserSheetSave(userId, 'billingExempt');
		this.updateUserField(userId, 'billingExempt', (u) => ({ ...u, billingExempt }));
		try {
			await setUserBillingExempt({ userId, billingExempt });
			await invalidate('app:admin-users');
		} catch (err) {
			this.adminUsers = previousUsers;
			this.adminUserError = getErrorMessage(err, 'Failed to update billing exemption');
		} finally {
			this.stopUserSheetSave(userId);
		}
	}

	async refreshAdminVms() {
		try {
			this.adminVms = await runQuery(listAllAdminVms());
		} catch (err) {
			this.adminVmError = getErrorMessage(err, 'Failed to refresh servers');
		}
	}

	async adminVmPower(vmId: string, action: 'start' | 'stop' | 'kill' | 'reboot') {
		const commands = {
			start: adminStartVm,
			stop: adminStopVm,
			kill: adminKillVm,
			reboot: adminRebootVm
		} as const;
		this.adminVmError = '';
		this.adminVmSaving[vmId] = action;
		try {
			await commands[action]({ vmId });
			await this.refreshAdminVms();
		} catch (err) {
			this.adminVmError = getErrorMessage(err, `Failed to ${action} server`);
		} finally {
			delete this.adminVmSaving[vmId];
		}
	}

	async adminVmDelete(vmId: string) {
		this.adminVmError = '';
		this.adminVmSaving[vmId] = 'delete';
		try {
			await adminDeleteVm({ vmId });
			await this.refreshAdminVms();
		} catch (err) {
			this.adminVmError = getErrorMessage(err, 'Failed to delete server');
			throw err;
		} finally {
			delete this.adminVmSaving[vmId];
		}
	}

	prompt2FAConfirm(userId: string, nextValue: boolean) {
		this.twoFAPendingUserId = userId;
		this.twoFAPendingValue = nextValue;
		this.twoFADialogOpen = true;
	}

	cancel2FAConfirm() {
		this.twoFADialogOpen = false;
		this.twoFAPendingUserId = '';
		this.twoFAPendingValue = false;
	}

	async commit2FAConfirm() {
		const userId = this.twoFAPendingUserId;
		const twoFactorEnabled = this.twoFAPendingValue;
		if (!userId) return;
		this.twoFADialogOpen = false;
		const previousUsers = this.adminUsers.map((u) => ({ ...u }));
		this.adminUserError = '';
		this.startUserSheetSave(userId, 'twoFactor');
		this.updateUserField(userId, 'twoFactorEnabled', (u) => ({ ...u, twoFactorEnabled }));
		try {
			await setUserTwoFactor({ userId, twoFactorEnabled });
			await invalidate('app:admin-users');
		} catch (err) {
			this.adminUsers = previousUsers;
			this.adminUserError = getErrorMessage(err, 'Failed to update two-factor status');
		} finally {
			this.stopUserSheetSave(userId);
			this.twoFAPendingUserId = '';
			this.twoFAPendingValue = false;
		}
	}

	async setUserRole(userId: string, role: string) {
		const previousUsers = this.adminUsers.map((u) => ({ ...u }));
		this.adminUserError = '';
		this.startUserSheetSave(userId, 'role');
		this.updateUserField(userId, 'role', (u) => ({
			...u,
			role,
			isAdmin: role === 'admin'
		}));
		try {
			await setUserRole({ userId, role });
			await invalidate('app:admin-users');
		} catch (err) {
			this.adminUsers = previousUsers;
			this.adminUserError = getErrorMessage(err, 'Failed to update role');
		} finally {
			this.stopUserSheetSave(userId);
		}
	}

	async deleteUser(userId: string, method: string, code: string) {
		this.adminUserError = '';
		this.startUserSheetSave(userId, 'delete');
		try {
			await deleteUserWithVerification({ userId, method, code });
			this.adminUsers = this.adminUsers.filter((u) => u.id !== userId);
			this.closeUserSheet();
			await invalidate('app:admin-users');
		} catch (err) {
			this.adminUserError = getErrorMessage(err, 'Failed to delete user');
			throw err;
		} finally {
			this.stopUserSheetSave(userId);
		}
	}

	async loadUserResources(userId: string, type: typeof this.userResourcesOpen) {
		this.userResourcesLoading = true;
		this.userResourcesOpen = type;
		try {
			const result = await runQuery(getUserResources({ userId }));
			this.userSessions = result.sessions;
			this.userAccounts = result.accounts;
			this.userOrgs = result.members;
			this.userSshKeys = result.sshKeys;
			this.userApiTokens = result.apiTokens;
		} catch (err) {
			this.adminUserError = getErrorMessage(err, 'Failed to load resources');
		} finally {
			this.userResourcesLoading = false;
		}
	}

	closeUserResources() {
		this.userResourcesOpen = null;
	}

	async loadOrgResources(org: UserOrganization) {
		this.selectedOrg = { ...org };
		this.orgResourcesLoading = true;
		this.orgResourcesOpen = true;
		try {
			const result = await runQuery(getOrganizationResources({ orgId: org.id }));
			this.orgVms = result.vms;
			this.orgVolumes = result.volumes;
		} catch (err) {
			this.adminUserError = getErrorMessage(err, 'Failed to load organization resources');
		} finally {
			this.orgResourcesLoading = false;
		}
	}

	closeOrgResources() {
		this.orgResourcesOpen = false;
		this.selectedOrg = null;
		this.orgVms = [];
		this.orgVolumes = [];
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
			this.featureFlagError = getErrorMessage(err, 'Failed to update feature flag');
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
		this.vtIsa = 'x86';
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
			this.vtError = getErrorMessage(err, 'Failed to save');
		} finally {
			this.vtSaving = false;
		}
	}

	async vtReorder(fromIndex: number, toIndex: number) {
		if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
		if (fromIndex >= this.vmTypes.length || toIndex >= this.vmTypes.length) return;
		const previous = [...this.vmTypes];
		const next = [...this.vmTypes];
		const [moved] = next.splice(fromIndex, 1);
		next.splice(toIndex, 0, moved);
		this.vmTypes = next;
		try {
			await reorderVmTypes({ vmTypeIds: next.map((vmType) => vmType.id) });
		} catch (err) {
			this.vmTypes = previous;
			toast.error(getErrorMessage(err, 'Failed to reorder VM types'));
		}
	}

	async vtRemove(id: string) {
		try {
			await deleteVmType({ vmTypeId: id });
			this.vmTypes = this.vmTypes.filter((vmType) => vmType.id !== id);
		} catch (err) {
			toast.error(getErrorMessage(err, 'Failed to delete VM type'));
		}
	}

	async loadPveImages() {
		this.isoLoading = true;
		this.isoError = '';
		try {
			const [images, targets] = await Promise.all([
				runQuery(listProxmoxImages()),
				runQuery(listProxmoxImageImportTargets())
			]);
			this.pveImages = images;
			this.pveImageImportTargets = targets;
		} catch (err) {
			this.isoError = getErrorMessage(err, 'Failed to scan Proxmox images');
		} finally {
			this.isoLoading = false;
		}
	}

	async loadPveIsos() {
		await this.loadPveImages();
	}

	imgImportOpen() {
		this.importUrl = '';
		this.importFilename = '';
		this.importChecksumAlgorithm = '';
		this.importChecksum = '';
		this.importVerifyCertificates = true;
		this.importSaving = false;
		this.importError = '';
		this.importStorage = config.admin.defaultImageImportStorage;
		this.importTasks = [];
		this.importDialogOpen = true;
		this.loadPveImages();
	}

	imgImportClose() {
		if (this.importSaving) return;
		this.importDialogOpen = false;
	}

	importFilenameFromUrl() {
		const fallback = this.importUrl.split('/').pop()?.split('?')[0]?.split('#')[0] ?? '';
		try {
			const url = new URL(this.importUrl);
			this.importFilename = decodeURIComponent(url.pathname.split('/').pop() || fallback);
		} catch {
			this.importFilename = decodeURIComponent(fallback);
		}
		return this.importFilename;
	}

	private waitForTaskPoll() {
		return new Promise<void>((resolve) => setTimeout(resolve, 1500));
	}

	async importImageFromUrl() {
		if (!this.importUrl.trim()) return;
		if (!this.importFilename.trim()) this.importFilenameFromUrl();
		if (!this.importFilename.trim()) return;

		this.importSaving = true;
		this.importError = '';
		this.importTasks = [];
		try {
			const result = await importProxmoxImageFromUrl({
				storage: this.importStorage,
				url: this.importUrl.trim(),
				filename: this.importFilename.trim(),
				...(this.importChecksumAlgorithm && { checksumAlgorithm: this.importChecksumAlgorithm }),
				...(this.importChecksum.trim() && { checksum: this.importChecksum.trim() }),
				verifyCertificates: this.importVerifyCertificates
			});
			this.importStorage = result.storage;
			this.importTasks = result.tasks.map((task) => ({ ...task, status: 'starting' as const }));

			while (true) {
				await this.waitForTaskPoll();
				const statuses = await Promise.all(
					this.importTasks.map(async (task) => {
						if (task.status === 'stopped') return task;
						const status = await runQuery(
							getProxmoxTaskStatus({ node: task.node, upid: task.upid })
						);
						return { ...task, status: status.status, exitstatus: status.exitstatus };
					})
				);
				this.importTasks = statuses;
				const failed = statuses.find((task) => task.exitstatus && task.exitstatus !== 'OK');
				if (failed) throw new Error(`Import failed on ${failed.node}: ${failed.exitstatus}`);
				if (statuses.every((task) => task.status === 'stopped')) {
					await this.loadPveImages();
					this.importDialogOpen = false;
					break;
				}
			}
		} catch (err) {
			this.importError = getErrorMessage(err, 'Failed to import image');
		} finally {
			this.importSaving = false;
		}
	}

	imgOpenCreate() {
		this.imgEditing = null;
		this.imgName = '';
		this.imgVersion = '';
		this.imgDescription = '';
		this.imgIcon = '';
		this.imgColor = 'bg-gray-600';
		this.imgIsOfficial = false;
		this.imgLogoSvg = '';
		this.imgAccentColor = '#6b7280';
		this.imgFilePath = '';
		this.imgIsa = 'x86';
		this.imgError = '';
		this.imgDialogOpen = true;
		if (this.pveImages.length === 0) this.loadPveImages();
	}

	imgOpenEdit(img: BaseImage) {
		this.imgEditing = img;
		this.imgName = img.name;
		this.imgVersion = img.version;
		this.imgDescription = img.description;
		this.imgIcon = img.icon ?? '';
		this.imgColor = img.color;
		this.imgIsOfficial = img.isOfficial;
		this.imgLogoSvg = img.logoSvg ?? '';
		this.imgAccentColor = img.accentColor;
		this.imgFilePath = img.filePath;
		this.imgIsa = 'x86';
		this.imgError = '';
		this.imgDialogOpen = true;
		if (this.pveImages.length === 0) this.loadPveImages();
	}

	async imgSave() {
		const selectedImage = this.pveImages.find((image) => image.volid === this.imgFilePath);
		if (!this.imgName.trim() || !selectedImage) return;
		this.imgSaving = true;
		this.imgError = '';
		try {
			const icon = this.imgIcon.trim();
			const logoSvg = this.imgLogoSvg.trim();
			const data = {
				name: this.imgName.trim(),
				version: this.imgVersion.trim(),
				description: this.imgDescription.trim(),
				color: this.imgColor,
				isOfficial: this.imgIsOfficial,
				accentColor: this.imgAccentColor.trim() || '#6b7280',
				filePath: selectedImage.volid,
				isa: 'x86' as const,
				...(icon ? { icon } : {}),
				...(this.imgIsOfficial && logoSvg ? { logoSvg } : {})
			};
			const localData = {
				...data,
				icon: icon || null,
				logoSvg: this.imgIsOfficial ? logoSvg || null : null,
				imageType: selectedImage.format || 'qcow2'
			};

			if (this.imgEditing) {
				await updateImage({ imageId: this.imgEditing.id, ...data });
				const index = this.images.findIndex((image) => image.id === this.imgEditing?.id);
				if (index !== -1) this.images[index] = { ...this.images[index], ...localData };
			} else {
				const result = await createImage(data);
				this.images.push({ id: result.id, ...localData });
			}

			this.imgDialogOpen = false;
		} catch (err) {
			this.imgError = getErrorMessage(err, 'Failed to save');
		} finally {
			this.imgSaving = false;
		}
	}

	async imgReorder(fromIndex: number, toIndex: number) {
		if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
		if (fromIndex >= this.images.length || toIndex >= this.images.length) return;
		const previous = [...this.images];
		const next = [...this.images];
		const [moved] = next.splice(fromIndex, 1);
		next.splice(toIndex, 0, moved);
		this.images = next;
		try {
			await reorderImages({ imageIds: next.map((image) => image.id) });
		} catch (err) {
			this.images = previous;
			toast.error(getErrorMessage(err, 'Failed to reorder images'));
		}
	}

	async imgRemove(id: string) {
		try {
			await deleteImage({ imageId: id });
			this.images = this.images.filter((image) => image.id !== id);
		} catch (err) {
			toast.error(getErrorMessage(err, 'Failed to delete image'));
		}
	}
}
