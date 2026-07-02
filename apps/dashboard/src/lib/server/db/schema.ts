import {
	pgTable,
	pgEnum,
	text,
	boolean,
	bigint,
	integer,
	numeric,
	date,
	index,
	uniqueIndex,
	inet,
	cidr
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { organization } from './auth.schema';
import { ulid } from '$lib/server/id';

export * from './auth.schema';

const ulidPk = () => text('id').primaryKey().$defaultFn(ulid);
const ulidFk = (name: string) => text(name);

export const vmIsaEnum = pgEnum('vm_isa', ['x86', 'arm', 'risc-v']);

export const vmBackendEnum = pgEnum('vm_backend', ['proxmox']);

export const vmStatusEnum = pgEnum('vm_status', ['provisioning', 'ready', 'error']);

export const billingSyncStatusEnum = pgEnum('billing_sync_status', ['pending', 'synced', 'failed']);

export const billingResourceTypeEnum = pgEnum('billing_resource_type', ['vm', 'volume']);

export const ipFamilyEnum = pgEnum('ip_family', ['ipv4', 'ipv6']);

// VM Types

export const vmTypes = pgTable('vm_types', {
	id: ulidPk(),
	name: text('name').notNull(),
	isa: vmIsaEnum('isa').notNull(),
	cores: integer('cores').notNull(),
	ramCapacity: integer('ram_capacity').notNull(),
	storageAmount: integer('storage_amount').notNull(),
	rate: numeric('rate').notNull(),
	cap: numeric('cap').notNull(),
	autumnFeatureId: text('autumn_feature_id')
});

export const vmTypesRelations = relations(vmTypes, ({ many }) => ({
	vms: many(vms)
}));

// VMs

export const vms = pgTable(
	'vms',
	{
		id: ulidPk(),
		name: text('name').notNull(),
		proxmoxId: integer('proxmox_id'),
		proxmoxNode: text('proxmox_node'),
		lastKnownIpv4: inet('last_known_ipv4'),
		lastKnownIpv6: inet('last_known_ipv6'),
		lastKnownStatus: text('last_known_status'),
		lastKnownUptime: integer('last_known_uptime').notNull().default(0),
		lastKnownAt: bigint('last_known_at', { mode: 'number' }),
		active: boolean('active').notNull().default(true),
		ownerProjectId: ulidFk('owner_project_id').references(() => organization.id),
		vmTypeId: ulidFk('vm_type_id')
			.notNull()
			.references(() => vmTypes.id),
		creationDate: date('creation_date').notNull(),
		createdAt: bigint('created_at', { mode: 'number' })
			.notNull()
			.default(sql`(extract(epoch from now()) * 1000)::bigint`),
		backend: vmBackendEnum('backend').notNull(),
		status: vmStatusEnum('status').notNull().default('provisioning'),
		statusError: text('status_error')
	},
	(table) => [
		index('vms_owner_project_id_index').on(table.ownerProjectId),
		index('vms_owner_project_active_index').on(table.ownerProjectId, table.active),
		index('vms_proxmox_id_index').on(table.proxmoxId)
	]
);

export const vmsRelations = relations(vms, ({ one, many }) => ({
	project: one(organization, {
		fields: [vms.ownerProjectId],
		references: [organization.id]
	}),
	vmType: one(vmTypes, {
		fields: [vms.vmTypeId],
		references: [vmTypes.id]
	}),
	volumes: many(volumes),
	paymentPeriods: many(paymentPeriods),
	ipAssignments: many(ipAssignments),
	ipamAllocations: many(ipamAllocations)
}));

// Volumes

export const volumes = pgTable(
	'volumes',
	{
		id: ulidPk(),
		name: text('name').notNull(),
		size: integer('size').notNull(),
		ownerProjectId: ulidFk('owner_project_id')
			.notNull()
			.references(() => organization.id),
		associatedVmId: ulidFk('associated_vm_id').references(() => vms.id),
		createdAt: bigint('created_at', { mode: 'number' })
			.notNull()
			.default(sql`(extract(epoch from now()) * 1000)::bigint`)
	},
	(table) => [
		index('volumes_owner_project_id_index').on(table.ownerProjectId),
		index('volumes_associated_vm_id_index').on(table.associatedVmId)
	]
);

export const volumesRelations = relations(volumes, ({ one }) => ({
	project: one(organization, {
		fields: [volumes.ownerProjectId],
		references: [organization.id]
	}),
	vm: one(vms, {
		fields: [volumes.associatedVmId],
		references: [vms.id]
	})
}));

// Payment Periods

export const paymentPeriods = pgTable(
	'payment_periods',
	{
		id: ulidPk(),
		vmId: ulidFk('vm_id')
			.notNull()
			.references(() => vms.id),
		userId: text('user_id').notNull(),
		startDate: integer('start_date').notNull(),
		endDate: integer('end_date'),
		rate: numeric('rate').notNull(),
		cap: numeric('cap').notNull()
	},
	(table) => [
		index('payment_periods_vm_id_index').on(table.vmId),
		index('payment_periods_user_id_index').on(table.userId)
	]
);

export const paymentPeriodsRelations = relations(paymentPeriods, ({ one }) => ({
	vm: one(vms, {
		fields: [paymentPeriods.vmId],
		references: [vms.id]
	})
}));

export const projectBillingCustomers = pgTable(
	'project_billing_customers',
	{
		projectId: text('project_id').primaryKey(),
		autumnCustomerId: text('autumn_customer_id').notNull(),
		syncStatus: billingSyncStatusEnum('sync_status').notNull().default('pending'),
		syncError: text('sync_error'),
		lastSyncedAt: bigint('last_synced_at', { mode: 'number' }),
		pastDueSince: bigint('past_due_since', { mode: 'number' }),
		suspendedAt: bigint('suspended_at', { mode: 'number' }),
		createdAt: bigint('created_at', { mode: 'number' }).notNull(),
		updatedAt: bigint('updated_at', { mode: 'number' }).notNull()
	},
	(table) => [
		uniqueIndex('project_billing_customers_autumn_customer_id_index').on(table.autumnCustomerId)
	]
);

export const billingMeters = pgTable(
	'billing_meters',
	{
		id: ulidPk(),
		projectId: text('project_id').notNull(),
		resourceType: billingResourceTypeEnum('resource_type').notNull(),
		resourceId: text('resource_id').notNull(),
		featureId: text('feature_id').notNull(),
		units: numeric('units').notNull(),
		lastMeteredAt: bigint('last_metered_at', { mode: 'number' }).notNull(),
		active: boolean('active').notNull().default(true),
		createdAt: bigint('created_at', { mode: 'number' }).notNull(),
		endedAt: bigint('ended_at', { mode: 'number' })
	},
	(table) => [
		uniqueIndex('billing_meters_resource_index').on(table.resourceType, table.resourceId),
		index('billing_meters_active_last_metered_at_index').on(table.active, table.lastMeteredAt),
		index('billing_meters_project_active_index').on(table.projectId, table.active)
	]
);

export const billingUsageEvents = pgTable(
	'billing_usage_events',
	{
		id: ulidPk(),
		projectId: text('project_id').notNull(),
		resourceType: billingResourceTypeEnum('resource_type').notNull(),
		resourceId: text('resource_id').notNull(),
		featureId: text('feature_id').notNull(),
		quantity: numeric('quantity').notNull(),
		periodStart: bigint('period_start', { mode: 'number' }).notNull(),
		periodEnd: bigint('period_end', { mode: 'number' }).notNull(),
		idempotencyKey: text('idempotency_key').notNull(),
		syncStatus: billingSyncStatusEnum('sync_status').notNull().default('pending'),
		syncError: text('sync_error'),
		syncedAt: bigint('synced_at', { mode: 'number' }),
		createdAt: bigint('created_at', { mode: 'number' }).notNull()
	},
	(table) => [
		uniqueIndex('billing_usage_events_idempotency_key_index').on(table.idempotencyKey),
		index('billing_usage_events_project_created_at_index').on(table.projectId, table.createdAt),
		index('billing_usage_events_sync_status_created_at_index').on(
			table.syncStatus,
			table.createdAt
		),
		index('billing_usage_events_resource_index').on(table.resourceType, table.resourceId)
	]
);

// IP Blocks

export const ipBlocks = pgTable('ip_blocks', {
	id: ulidPk(),
	ipBlock: cidr('ip_block').notNull()
});

export const ipBlocksRelations = relations(ipBlocks, ({ many }) => ({
	assignments: many(ipAssignments)
}));

// IP Assignments

export const ipAssignments = pgTable(
	'ip_assignments',
	{
		ip: inet('ip').notNull(),
		ipBlockId: ulidFk('ip_block_id')
			.notNull()
			.references(() => ipBlocks.id),
		associatedVmId: ulidFk('associated_vm_id').references(() => vms.id)
	},
	(table) => [
		index('ip_assignments_ip_block_id_index').on(table.ipBlockId),
		index('ip_assignments_associated_vm_id_index').on(table.associatedVmId)
	]
);

export const ipAssignmentsRelations = relations(ipAssignments, ({ one }) => ({
	ipBlock: one(ipBlocks, {
		fields: [ipAssignments.ipBlockId],
		references: [ipBlocks.id]
	}),
	vm: one(vms, {
		fields: [ipAssignments.associatedVmId],
		references: [vms.id]
	})
}));

export const ipamPrefixes = pgTable(
	'ipam_prefixes',
	{
		id: ulidPk(),
		name: text('name').notNull(),
		cidr: cidr('cidr').notNull(),
		family: ipFamilyEnum('family').notNull(),
		disabled: boolean('disabled').notNull().default(false),
		ipv6UseTransitAddress: boolean('ipv6_use_transit_address').notNull().default(false),
		whitelistStart: inet('whitelist_start'),
		whitelistEnd: inet('whitelist_end'),
		gatewayAddress: inet('gateway_address'),
		createdAt: bigint('created_at', { mode: 'number' })
			.notNull()
			.default(sql`(extract(epoch from now()) * 1000)::bigint`)
	},
	(table) => [
		uniqueIndex('ipam_prefixes_cidr_index').on(table.cidr),
		index('ipam_prefixes_family_disabled_index').on(table.family, table.disabled)
	]
);

export const ipamPrefixesRelations = relations(ipamPrefixes, ({ many }) => ({
	allocations: many(ipamAllocations)
}));

export const ipamAllocations = pgTable(
	'ipam_allocations',
	{
		id: ulidPk(),
		ipamPrefixId: ulidFk('ipam_prefix_id')
			.notNull()
			.references(() => ipamPrefixes.id),
		associatedVmId: ulidFk('associated_vm_id')
			.notNull()
			.references(() => vms.id),
		family: ipFamilyEnum('family').notNull(),
		address: inet('address'),
		prefix: cidr('prefix'),
		prefixLength: integer('prefix_length').notNull(),
		macAddress: text('mac_address').notNull(),
		createdAt: bigint('created_at', { mode: 'number' })
			.notNull()
			.default(sql`(extract(epoch from now()) * 1000)::bigint`)
	},
	(table) => [
		index('ipam_allocations_ipam_prefix_id_index').on(table.ipamPrefixId),
		index('ipam_allocations_associated_vm_id_index').on(table.associatedVmId),
		index('ipam_allocations_vm_family_index').on(table.associatedVmId, table.family),
		uniqueIndex('ipam_allocations_address_index').on(table.address),
		uniqueIndex('ipam_allocations_prefix_index').on(table.prefix)
	]
);

export const ipamAllocationsRelations = relations(ipamAllocations, ({ one }) => ({
	ipamPrefix: one(ipamPrefixes, {
		fields: [ipamAllocations.ipamPrefixId],
		references: [ipamPrefixes.id]
	}),
	vm: one(vms, {
		fields: [ipamAllocations.associatedVmId],
		references: [vms.id]
	})
}));

// SSH Keys

export const sshKeys = pgTable(
	'ssh_keys',
	{
		id: ulidPk(),
		userId: text('user_id').notNull(),
		fingerprint: text('fingerprint').notNull(),
		publicKey: text('public_key').notNull(),
		name: text('name').notNull(),
		description: text('description')
	},
	(table) => [index('ssh_keys_user_id_index').on(table.userId)]
);

// API Tokens

export const apiTokens = pgTable(
	'api_tokens',
	{
		id: ulidPk(),
		userId: text('user_id').notNull(),
		name: text('name').notNull(),
		tokenHash: text('token_hash').notNull(),
		createdAt: bigint('created_at', { mode: 'number' }).notNull()
	},
	(table) => [index('api_tokens_user_id_index').on(table.userId)]
);

// Base Images

export const baseImages = pgTable('base_images', {
	id: ulidPk(),
	filePath: text('file_path').notNull(), // Proxmox storage path: "local:import/debian-12.qcow2"
	name: text('name').notNull(),
	version: text('version').notNull(),
	description: text('description').notNull(),
	shortName: text('short_name').notNull().default(''),
	icon: text('icon'),
	color: text('color').notNull().default('bg-gray-600'), // legacy Tailwind bg class
	isOfficial: boolean('is_official').notNull().default(false),
	logoSvg: text('logo_svg'),
	accentColor: text('accent_color').notNull().default('#6b7280'),
	imageType: text('image_type').notNull().default('qcow2'),
	isa: vmIsaEnum('isa').notNull()
});
