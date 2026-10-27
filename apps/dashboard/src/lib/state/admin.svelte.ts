import { untrack } from 'svelte';
import { toast } from 'svelte-sonner';
import { config } from '#lib/config.js';
import {
	defaultFeatureFlags,
	type FeatureFlagKey,
	type FeatureFlags,
	featureFlagKeys
} from '#lib/feature-flags.js';
import { type AdminProject, setProjectBillingExempt } from '#lib/remote/admin-projects.remote.js';
import {
	type AdminUser,
	deleteUserWithVerification,
	getOrganizationResources,
	getUserResources,
	listAdminUsers,
	setUserAdmin,
	setUserBillingExempt,
	setUserDisabled,
	setUserRole,
	setUserTwoFactor,
	type UserAccount,
	type UserApiToken,
	type UserOrganization,
	type UserSession,
	type UserSshKey
} from '#lib/remote/admin-users.remote.js';
import {
	type AdminVm,
	adminDeleteVm,
	adminKillVm,
	adminRebootVm,
	adminStartVm,
	adminStopVm,
	listAllAdminVms
} from '#lib/remote/admin-vms.remote.js';
import { updateFeatureFlag } from '#lib/remote/feature-flags.remote.js';
import {
	createImage,
	deleteImage,
	getProxmoxTaskStatus,
	importProxmoxImageFromUrl,
	listProxmoxImageImportTargets,
	listProxmoxImages,
	reorderImages,
	updateImage
} from '#lib/remote/images.remote.js';
import {
	createVmType,
	deleteVmType,
	reorderVmTypes,
	updateVmType
} from '#lib/remote/vm-types.remote.js';
import { getErrorMessage, runQuery } from '#lib/utils.js';
import { goto, invalidate } from '$app/navigation';
import { page } from '$app/state';

export type VmIsa = 'x86';

export interface VmType {
	autumnFeatureId: string | null;
	cap: string;
	cores: number;
	id: string;
	isa: string;
	name: string;
	ramCapacity: number;
	rate: string;
	storageAmount: number;
}

export interface BaseImage {
	accentColor: string;
	color: string;
	description: string;
	filePath: string;
	icon: string | null | undefined;
	id: string;
	imageType: string;
	isa: string;
	isOfficial: boolean;
	logoSvg: string | null | undefined;
	name: string;
	secureBoot: boolean;
	version: string;
}

export interface PveImage {
	content: 'import';
	filename: string;
	format: string;
	node: string;
	size: number;
	storage: string;
	volid: string;
}

export interface ImageVersionDraft {
	error: string;
	filePath: string;
	id: string | null;
	key: number;
	removed: boolean;
	secureBoot: boolean;
	version: string;
}

export type ImageVersionStatus = 'new' | 'changed' | 'removed' | 'unchanged';

export interface ImageGroup {
	name: string;
	representative: BaseImage;
	versions: BaseImage[];
}

export function compareVersionsDesc(a: string, b: string): number {
	const na = Number.parseFloat(a);
	const nb = Number.parseFloat(b);
	if (!(Number.isNaN(na) || Number.isNaN(nb)) && na !== nb) {
		return nb - na;
	}
	return b.localeCompare(a, undefined, { numeric: true });
}

const ARCH_TOKEN_PATTERN = /(x86[-_]64|amd64|aarch64|arm64|i[3-6]86|ppc64le|s390x)/gi;
const IMAGE_EXTENSION_PATTERN = /\.(qcow2|img|raw|vmdk|ova|xz|gz|zst)$/i;
const PATH_SEPARATOR_PATTERN = /[/:]/;
const VERSION_TOKEN_PATTERN = /(?:^|[^0-9a-z])v?(\d+(?:\.\d+)*)(?=$|[^0-9])/i;

/** Best-effort version guess from an image filename, e.g. "debian-12-genericcloud-amd64.qcow2" -> "12". */
export function guessVersionFromFilename(filePath: string): string {
	let name = filePath.split(PATH_SEPARATOR_PATTERN).pop() ?? '';
	while (IMAGE_EXTENSION_PATTERN.test(name)) {
		name = name.replace(IMAGE_EXTENSION_PATTERN, '');
	}
	name = name.replace(ARCH_TOKEN_PATTERN, '');
	return name.match(VERSION_TOKEN_PATTERN)?.[1] ?? '';
}

export interface PveImageImportTarget {
	node: string;
	storage: string;
}

export interface IpamPrefix {
	allocated: number;
	available: string;
	bunnyDnsZone: string | null;
	capacity: string;
	cidr: string;
	disabled: boolean;
	family: 'ipv4' | 'ipv6';
	gatewayAddress: string | null;
	hasCapacity: boolean;
	id: string;
	ipv6UseTransitAddress: boolean;
	name: string;
	whitelistEnd: string | null;
	whitelistStart: string | null;
}

type ImportChecksumAlgorithm = '' | 'md5' | 'sha1' | 'sha224' | 'sha256' | 'sha384' | 'sha512';
interface ImportTask {
	exitstatus?: string;
	node: string;
	status: 'starting' | 'running' | 'stopped';
	storage: string;
	upid: string;
}

export interface AdminPageData {
	adminProjects?: AdminProject[];
	adminUsers?: AdminUser[];
	adminVms?: AdminVm[];
	featureFlags?: FeatureFlags;
	images?: BaseImage[];
	ipamPrefixes?: IpamPrefix[];
	vmTypes?: VmType[];
}

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
	adminProjects = $state<AdminProject[]>([]);
	adminProjectSaving = $state<Record<string, boolean>>({});
	adminProjectError = $state('');

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
	imgGroupName = $state<string | null>(null);
	imgDetailsExpanded = $state(true);
	imgSaving = $state(false);
	imgError = $state('');
	imgName = $state('');
	imgDescription = $state('');
	imgIcon = $state('');
	imgColor = $state('bg-gray-600');
	imgIsOfficial = $state(false);
	imgLogoSvg = $state('');
	imgAccentColor = $state('#6b7280');
	imgIsa = $state<VmIsa>('x86');
	imgRows = $state<ImageVersionDraft[]>([]);
	private imgRowSeq = 0;

	get imageGroups(): ImageGroup[] {
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
		this.adminProjects = [...(data.adminProjects ?? [])];
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

	private updateUserField(userId: string, updater: (user: AdminUser) => AdminUser) {
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

	async setUserDisabled(userId: string, disabled: boolean) {
		const previousUsers = this.adminUsers.map((u) => ({ ...u }));
		this.adminUserError = '';
		this.startUserSheetSave(userId, 'disabled');
		this.updateUserField(userId, (u) => ({ ...u, disabled }));
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
		this.updateUserField(userId, (u) => ({ ...u, billingExempt }));
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

	async setProjectBillingExempt(projectId: string, billingExempt: boolean) {
		const previousProjects = this.adminProjects.map((project) => ({ ...project }));
		this.adminProjectError = '';
		this.adminProjectSaving[projectId] = true;
		this.adminProjects = this.adminProjects.map((project) =>
			project.id === projectId ? { ...project, billingExempt } : project
		);
		try {
			await setProjectBillingExempt({ projectId, billingExempt });
			await invalidate('app:admin-projects');
		} catch (err) {
			this.adminProjects = previousProjects;
			this.adminProjectError = getErrorMessage(err, 'Failed to update billing exemption');
		} finally {
			delete this.adminProjectSaving[projectId];
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
		if (!userId) {
			return;
		}
		this.twoFADialogOpen = false;
		const previousUsers = this.adminUsers.map((u) => ({ ...u }));
		this.adminUserError = '';
		this.startUserSheetSave(userId, 'twoFactor');
		this.updateUserField(userId, (u) => ({ ...u, twoFactorEnabled }));
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
		this.updateUserField(userId, (u) => ({
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
		if (!this.vtName.trim()) {
			return;
		}
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
				if (index !== -1) {
					this.vmTypes[index] = { ...this.vmTypes[index], ...data };
				}
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
		if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) {
			return;
		}
		if (fromIndex >= this.vmTypes.length || toIndex >= this.vmTypes.length) {
			return;
		}
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
		if (this.importSaving) {
			return;
		}
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
		if (!this.importUrl.trim()) {
			return;
		}
		if (!this.importFilename.trim()) {
			this.importFilenameFromUrl();
		}
		if (!this.importFilename.trim()) {
			return;
		}

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

			let polling = true;
			while (polling) {
				// biome-ignore lint/performance/noAwaitInLoops: polls Proxmox task status on an interval until every import task stops
				await this.waitForTaskPoll();
				const statuses = await Promise.all(
					this.importTasks.map(async (task) => {
						if (task.status === 'stopped') {
							return task;
						}
						const status = await runQuery(
							getProxmoxTaskStatus({ node: task.node, upid: task.upid })
						);
						return { ...task, status: status.status, exitstatus: status.exitstatus };
					})
				);
				this.importTasks = statuses;
				const failed = statuses.find((task) => task.exitstatus && task.exitstatus !== 'OK');
				if (failed) {
					throw new Error(`Import failed on ${failed.node}: ${failed.exitstatus}`);
				}
				if (statuses.every((task) => task.status === 'stopped')) {
					await this.loadPveImages();
					this.importDialogOpen = false;
					polling = false;
				}
			}
		} catch (err) {
			this.importError = getErrorMessage(err, 'Failed to import image');
		} finally {
			this.importSaving = false;
		}
	}

	private imgNewRow(partial: Partial<ImageVersionDraft> = {}): ImageVersionDraft {
		this.imgRowSeq += 1;
		return {
			key: this.imgRowSeq,
			id: null,
			version: '',
			filePath: '',
			secureBoot: true,
			removed: false,
			error: '',
			...partial
		};
	}

	private imgRowFromImage(image: BaseImage) {
		return this.imgNewRow({
			id: image.id,
			version: image.version,
			filePath: image.filePath,
			secureBoot: image.secureBoot
		});
	}

	private imgResetShared(source?: BaseImage) {
		this.imgName = source?.name ?? '';
		this.imgDescription = source?.description ?? '';
		this.imgIcon = source?.icon ?? '';
		this.imgColor = source?.color ?? 'bg-gray-600';
		this.imgIsOfficial = source?.isOfficial ?? false;
		this.imgLogoSvg = source?.logoSvg ?? '';
		this.imgAccentColor = source?.accentColor ?? '#6b7280';
		this.imgIsa = 'x86';
	}

	private imgLoadGroup(group: ImageGroup) {
		this.imgGroupName = group.name;
		this.imgResetShared(group.representative);
		this.imgDetailsExpanded = false;
	}

	imgOpenCreate(filePath = '') {
		this.imgGroupName = null;
		this.imgResetShared();
		this.imgDetailsExpanded = true;
		this.imgRows = [this.imgNewRow({ filePath, version: guessVersionFromFilename(filePath) })];
		this.imgError = '';
		this.imgSaving = false;
		this.imgDialogOpen = true;
		if (this.pveImages.length === 0) {
			this.loadPveImages();
		}
	}

	imgOpenManage(groupName: string) {
		const group = this.imageGroups.find((g) => g.name === groupName);
		if (!group) {
			this.imgOpenCreate();
			return;
		}
		this.imgLoadGroup(group);
		this.imgRows = group.versions.map((image) => this.imgRowFromImage(image));
		this.imgError = '';
		this.imgSaving = false;
		this.imgDialogOpen = true;
		if (this.pveImages.length === 0) {
			this.loadPveImages();
		}
	}

	imgAdoptExistingName() {
		if (this.imgGroupName !== null) {
			return;
		}
		const name = this.imgName.trim();
		const group = this.imageGroups.find((g) => g.name === name);
		if (!group) {
			return;
		}
		const pending = this.imgRows.filter((row) => row.version.trim() || row.filePath);
		this.imgLoadGroup(group);
		this.imgRows = [
			...group.versions.map((image) => this.imgRowFromImage(image)),
			...(pending.length > 0
				? pending
				: [this.imgNewRow({ secureBoot: group.representative.secureBoot })])
		];
	}

	imgAddRow() {
		const last = this.imgRows.findLast((row) => !row.removed);
		this.imgRows.push(this.imgNewRow({ secureBoot: last?.secureBoot ?? true }));
	}

	imgToggleRemoveRow(row: ImageVersionDraft) {
		if (row.id === null) {
			this.imgRows = this.imgRows.filter((r) => r.key !== row.key);
			return;
		}
		row.removed = !row.removed;
	}

	imgRemoveAll() {
		this.imgRows = this.imgRows.filter((row) => row.id !== null);
		for (const row of this.imgRows) {
			row.removed = true;
		}
	}

	imgRowFileChanged(row: ImageVersionDraft) {
		if (!row.version.trim()) {
			row.version = guessVersionFromFilename(row.filePath);
		}
	}

	imgRowStatus(row: ImageVersionDraft): ImageVersionStatus {
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

	imgFileUsedBy(volid: string, rowId: string | null) {
		const other = this.images.find((image) => image.filePath === volid && image.id !== rowId);
		return other ? `${other.name} ${other.version}`.trim() : null;
	}

	private imgSharedData() {
		return {
			name: this.imgName.trim(),
			description: this.imgDescription.trim(),
			color: this.imgColor,
			isOfficial: this.imgIsOfficial,
			accentColor: this.imgAccentColor.trim() || '#6b7280',
			icon: this.imgIcon.trim(),
			logoSvg: this.imgIsOfficial ? this.imgLogoSvg.trim() : ''
		};
	}

	get imgSharedChanged() {
		if (this.imgGroupName === null) {
			return false;
		}
		const rep = this.imageGroups.find((g) => g.name === this.imgGroupName)?.representative;
		if (!rep) {
			return true;
		}
		const shared = this.imgSharedData();
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

	get imgPending() {
		const counts = { new: 0, changed: 0, removed: 0 };
		for (const row of this.imgRows) {
			const status = this.imgRowStatus(row);
			if (status !== 'unchanged') {
				counts[status] += 1;
			}
		}
		return { ...counts, details: this.imgSharedChanged };
	}

	get imgHasChanges() {
		const pending = this.imgPending;
		return pending.details || pending.new + pending.changed + pending.removed > 0;
	}

	get imgActiveRows() {
		return this.imgRows.filter((row) => !row.removed);
	}

	get imgRowsValid() {
		const volids = new Set(this.pveImages.map((image) => image.volid));
		const active = this.imgActiveRows;
		if (active.length === 0 && this.imgGroupName === null) {
			return false;
		}
		return active.every((row) => row.version.trim() && volids.has(row.filePath));
	}

	get imgDuplicateVersions(): string[] {
		const seen = new Set<string>();
		const dupes = new Set<string>();
		for (const row of this.imgActiveRows) {
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

	get imgCanSave() {
		if (this.imgSaving || !this.imgHasChanges) {
			return false;
		}
		if (this.imgActiveRows.length === 0) {
			// Deleting the whole family doesn't need valid details.
			return this.imgGroupName !== null;
		}
		return Boolean(this.imgName.trim()) && this.imgRowsValid;
	}

	async imgSave() {
		if (!this.imgCanSave) {
			return;
		}
		this.imgSaving = true;
		this.imgError = '';
		for (const row of this.imgRows) {
			row.error = '';
		}

		const shared = this.imgSharedData();
		const sharedChanged = this.imgSharedChanged;
		const remoteShared = {
			name: shared.name,
			description: shared.description,
			color: shared.color,
			isOfficial: shared.isOfficial,
			accentColor: shared.accentColor,
			isa: 'x86' as const,
			...(shared.icon ? { icon: shared.icon } : {})
		};
		const localShared = {
			...remoteShared,
			icon: shared.icon || null,
			logoSvg: shared.logoSvg || null
		};
		const versionData = (row: ImageVersionDraft) => ({
			version: row.version.trim(),
			filePath: row.filePath,
			secureBoot: row.secureBoot
		});
		const formatOf = (volid: string) =>
			this.pveImages.find((image) => image.volid === volid)?.format || 'qcow2';
		let failed = false;

		try {
			// Deletions and updates can go in parallel.
			const existingWork = this.imgRows
				.filter((row) => row.id !== null)
				.map(async (row) => {
					const id = row.id as string;
					const status = this.imgRowStatus(row);
					try {
						if (status === 'removed') {
							await deleteImage({ imageId: id });
							this.images = this.images.filter((image) => image.id !== id);
							this.imgRows = this.imgRows.filter((r) => r.key !== row.key);
						} else if (status === 'changed' || sharedChanged) {
							const data = {
								...(sharedChanged ? { ...remoteShared, logoSvg: shared.logoSvg } : {}),
								...versionData(row)
							};
							await updateImage({ imageId: id, ...data });
							this.images = this.images.map((image) =>
								image.id === id
									? {
											...image,
											...(sharedChanged ? localShared : {}),
											...versionData(row),
											imageType: formatOf(row.filePath)
										}
									: image
							);
						}
					} catch (err) {
						failed = true;
						row.error = getErrorMessage(err, 'Failed to save');
					}
				});
			await Promise.all(existingWork);

			// Creations run sequentially so sort order follows the row order.
			for (const row of this.imgRows.filter((r) => r.id === null)) {
				try {
					// biome-ignore lint/performance/noAwaitInLoops: preserve insertion order for sortOrder
					const result = await createImage({
						...remoteShared,
						...(shared.logoSvg ? { logoSvg: shared.logoSvg } : {}),
						...versionData(row)
					});
					this.images.push({
						id: result.id,
						...localShared,
						...versionData(row),
						imageType: formatOf(row.filePath)
					});
					row.id = result.id;
				} catch (err) {
					failed = true;
					row.error = getErrorMessage(err, 'Failed to create');
				}
			}

			if (failed) {
				this.imgError = 'Some changes failed to save. Fix the highlighted rows and try again.';
				if (this.images.some((image) => image.name === shared.name)) {
					this.imgGroupName = shared.name;
				}
				return;
			}
			this.imgDialogOpen = false;
		} catch (err) {
			this.imgError = getErrorMessage(err, 'Failed to save');
		} finally {
			this.imgSaving = false;
		}
	}

	async imgReorderGroups(fromIndex: number, toIndex: number) {
		const groups = this.imageGroups;
		if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) {
			return;
		}
		if (fromIndex >= groups.length || toIndex >= groups.length) {
			return;
		}
		const nextGroups = [...groups];
		const [moved] = nextGroups.splice(fromIndex, 1);
		nextGroups.splice(toIndex, 0, moved);
		const previous = [...this.images];
		const next = nextGroups.flatMap((group) => group.versions);
		this.images = next;
		try {
			await reorderImages({ imageIds: next.map((image) => image.id) });
		} catch (err) {
			this.images = previous;
			toast.error(getErrorMessage(err, 'Failed to reorder images'));
		}
	}
}
