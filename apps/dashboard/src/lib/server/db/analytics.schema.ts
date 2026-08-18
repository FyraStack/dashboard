/**
 * A read-only mirror of the public schema for analytics/BI tools such as Metabase.
 * Basically you can think of this as the same as public, but with fields redacted for privacy and security reasons.
 * When setting this up, please make sure to set up a role which ONLY has read-only access to this schema.
 *
 * Here's an example:
 * -- Add LOGIN and a password when you set this up for real, otherwise nothing can connect.
 * CREATE ROLE analytics_role;
 * -- In newer versions of postgres, the following revoke shouldn't be necessary, but it doesn't hurt.
 * REVOKE ALL ON SCHEMA public FROM analytics_role;
 * -- Grants only read-only access to analytics_role.
 * GRANT USAGE ON SCHEMA analytics TO analytics_role;
 * GRANT SELECT ON ALL TABLES IN SCHEMA analytics TO analytics_role;
 * -- If we create new tables in this schema in the future, we want the role to be able to access them.
 * -- Run this one as the role that runs migrations: it attaches to whoever executes it, so running
 * -- it as an admin instead means later views silently never become readable.
 * -- You can think of this as modifying the default permission set your migration role uses when creating tables in the schema.
 * ALTER DEFAULT PRIVILEGES IN SCHEMA analytics GRANT SELECT ON TABLES TO analytics_role;
 */

import { pgSchema } from 'drizzle-orm/pg-core';
import {
	apiTokens,
	baseImages,
	billingMeters,
	billingUsageEvents,
	ipamAllocations,
	ipamPrefixes,
	ipamPtrRecords,
	ipamSettings,
	member,
	organization,
	projectBillingCustomers,
	sshKeys,
	user,
	vmTypes,
	vms,
	volumes
} from './schema';

export const analyticsSchema = pgSchema('analytics');

// Organization

export const analyticsOrganization = analyticsSchema.view('organization').as((qb) =>
	qb
		.select({
			id: organization.id,
			name: organization.name,
			slug: organization.slug,
			createdAt: organization.createdAt,
			billingExempt: organization.billingExempt,
			disabled: organization.disabled,
			deletedAt: organization.deletedAt
		})
		.from(organization)
);

// Member

export const analyticsMember = analyticsSchema.view('member').as((qb) =>
	qb
		.select({
			id: member.id,
			organizationId: member.organizationId,
			userId: member.userId,
			role: member.role,
			createdAt: member.createdAt
		})
		.from(member)
);

// User

export const analyticsUser = analyticsSchema.view('user').as((qb) =>
	qb
		.select({
			id: user.id,
			emailVerified: user.emailVerified,
			createdAt: user.createdAt,
			updatedAt: user.updatedAt,
			role: user.role,
			banned: user.banned,
			banExpires: user.banExpires,
			twoFactorEnabled: user.twoFactorEnabled,
			isAdmin: user.isAdmin,
			billingExempt: user.billingExempt
		})
		.from(user)
);

// VM Types

export const analyticsVmTypes = analyticsSchema.view('vm_types').as((qb) =>
	qb
		.select({
			id: vmTypes.id,
			name: vmTypes.name,
			isa: vmTypes.isa,
			cores: vmTypes.cores,
			ramCapacity: vmTypes.ramCapacity,
			storageAmount: vmTypes.storageAmount,
			rate: vmTypes.rate,
			cap: vmTypes.cap,
			sortOrder: vmTypes.sortOrder
		})
		.from(vmTypes)
);

// VMs

export const analyticsVms = analyticsSchema.view('vms').as((qb) =>
	qb
		.select({
			id: vms.id,
			proxmoxId: vms.proxmoxId,
			proxmoxNode: vms.proxmoxNode,
			lastKnownIpv4: vms.lastKnownIpv4,
			lastKnownIpv6: vms.lastKnownIpv6,
			lastKnownStatus: vms.lastKnownStatus,
			lastKnownUptime: vms.lastKnownUptime,
			lastKnownAt: vms.lastKnownAt,
			active: vms.active,
			deletedAt: vms.deletedAt,
			ownerProjectId: vms.ownerProjectId,
			vmTypeId: vms.vmTypeId,
			creationDate: vms.creationDate,
			createdAt: vms.createdAt,
			backend: vms.backend,
			status: vms.status,
			statusError: vms.statusError
		})
		.from(vms)
);

// Volumes

export const analyticsVolumes = analyticsSchema.view('volumes').as((qb) =>
	qb
		.select({
			id: volumes.id,
			size: volumes.size,
			ownerProjectId: volumes.ownerProjectId,
			associatedVmId: volumes.associatedVmId,
			createdAt: volumes.createdAt
		})
		.from(volumes)
);

// Project Billing Customers

export const analyticsProjectBillingCustomers = analyticsSchema
	.view('project_billing_customers')
	.as((qb) =>
		qb
			.select({
				projectId: projectBillingCustomers.projectId,
				syncStatus: projectBillingCustomers.syncStatus,
				syncError: projectBillingCustomers.syncError,
				lastSyncedAt: projectBillingCustomers.lastSyncedAt,
				pastDueSince: projectBillingCustomers.pastDueSince,
				suspendedAt: projectBillingCustomers.suspendedAt,
				createdAt: projectBillingCustomers.createdAt,
				updatedAt: projectBillingCustomers.updatedAt
			})
			.from(projectBillingCustomers)
	);

// Billing Meters

export const analyticsBillingMeters = analyticsSchema.view('billing_meters').as((qb) =>
	qb
		.select({
			id: billingMeters.id,
			projectId: billingMeters.projectId,
			resourceType: billingMeters.resourceType,
			resourceId: billingMeters.resourceId,
			featureId: billingMeters.featureId,
			units: billingMeters.units,
			lastMeteredAt: billingMeters.lastMeteredAt,
			active: billingMeters.active,
			createdAt: billingMeters.createdAt,
			endedAt: billingMeters.endedAt
		})
		.from(billingMeters)
);

// Billing Usage Events

export const analyticsBillingUsageEvents = analyticsSchema.view('billing_usage_events').as((qb) =>
	qb
		.select({
			id: billingUsageEvents.id,
			projectId: billingUsageEvents.projectId,
			resourceType: billingUsageEvents.resourceType,
			resourceId: billingUsageEvents.resourceId,
			featureId: billingUsageEvents.featureId,
			quantity: billingUsageEvents.quantity,
			periodStart: billingUsageEvents.periodStart,
			periodEnd: billingUsageEvents.periodEnd,
			idempotencyKey: billingUsageEvents.idempotencyKey,
			syncStatus: billingUsageEvents.syncStatus,
			syncError: billingUsageEvents.syncError,
			syncedAt: billingUsageEvents.syncedAt,
			createdAt: billingUsageEvents.createdAt
		})
		.from(billingUsageEvents)
);

// IPAM Prefixes

export const analyticsIpamPrefixes = analyticsSchema.view('ipam_prefixes').as((qb) =>
	qb
		.select({
			id: ipamPrefixes.id,
			name: ipamPrefixes.name,
			cidr: ipamPrefixes.cidr,
			family: ipamPrefixes.family,
			disabled: ipamPrefixes.disabled,
			ipv6UseTransitAddress: ipamPrefixes.ipv6UseTransitAddress,
			whitelistStart: ipamPrefixes.whitelistStart,
			whitelistEnd: ipamPrefixes.whitelistEnd,
			gatewayAddress: ipamPrefixes.gatewayAddress,
			createdAt: ipamPrefixes.createdAt
		})
		.from(ipamPrefixes)
);

// IPAM Allocations

export const analyticsIpamAllocations = analyticsSchema.view('ipam_allocations').as((qb) =>
	qb
		.select({
			id: ipamAllocations.id,
			ipamPrefixId: ipamAllocations.ipamPrefixId,
			associatedVmId: ipamAllocations.associatedVmId,
			family: ipamAllocations.family,
			address: ipamAllocations.address,
			prefix: ipamAllocations.prefix,
			prefixLength: ipamAllocations.prefixLength,
			createdAt: ipamAllocations.createdAt
		})
		.from(ipamAllocations)
);

// IPAM Settings

export const analyticsIpamSettings = analyticsSchema.view('ipam_settings').as((qb) =>
	qb
		.select({
			id: ipamSettings.id,
			defaultPtrFormatIpv4: ipamSettings.defaultPtrFormatIpv4,
			defaultPtrFormatIpv6: ipamSettings.defaultPtrFormatIpv6
		})
		.from(ipamSettings)
);

// IPAM PTR Records

export const analyticsIpamPtrRecords = analyticsSchema.view('ipam_ptr_records').as((qb) =>
	qb
		.select({
			id: ipamPtrRecords.id,
			ipamAllocationId: ipamPtrRecords.ipamAllocationId,
			address: ipamPtrRecords.address,
			value: ipamPtrRecords.value,
			createdAt: ipamPtrRecords.createdAt
		})
		.from(ipamPtrRecords)
);

// SSH Keys

export const analyticsSshKeys = analyticsSchema.view('ssh_keys').as((qb) =>
	qb
		.select({
			id: sshKeys.id,
			userId: sshKeys.userId,
			fingerprint: sshKeys.fingerprint
		})
		.from(sshKeys)
);

// API Tokens

export const analyticsApiTokens = analyticsSchema.view('api_tokens').as((qb) =>
	qb
		.select({
			id: apiTokens.id,
			userId: apiTokens.userId,
			createdAt: apiTokens.createdAt
		})
		.from(apiTokens)
);

// Base Images

export const analyticsBaseImages = analyticsSchema.view('base_images').as((qb) =>
	qb
		.select({
			id: baseImages.id,
			filePath: baseImages.filePath,
			name: baseImages.name,
			version: baseImages.version,
			description: baseImages.description,
			shortName: baseImages.shortName,
			icon: baseImages.icon,
			color: baseImages.color,
			isOfficial: baseImages.isOfficial,
			logoSvg: baseImages.logoSvg,
			accentColor: baseImages.accentColor,
			imageType: baseImages.imageType,
			secureBoot: baseImages.secureBoot,
			isa: baseImages.isa,
			sortOrder: baseImages.sortOrder
		})
		.from(baseImages)
);
