import { type } from 'arktype';
import { totpResetChoices, verificationMethods } from 'stack-shared/auth';
import { defaultIsa, metricsTimeframes, networkingModes } from 'stack-shared/compute';
import { featureFlagKeys } from 'stack-shared/feature-flags';
import { type PermissionLevel, projectRoles } from 'stack-shared/project-roles';
import {
	MAX_TICKET_ATTACHMENTS,
	MAX_TICKET_MESSAGE_LENGTH,
	MAX_TICKET_SUBJECT_LENGTH,
	ticketCategories,
	ticketPriorities,
	ticketStatuses
} from 'stack-shared/support';

const permissionLevels = projectRoles.filter((role): role is PermissionLevel => role !== 'owner');

export const idempotencyKeySchema = type('0 < string <= 128');
export const networkingMode = type.enumerated(...networkingModes);
export const instructionSetArchitecture = type.enumerated(defaultIsa);
export const metricsTimeframe = type.enumerated(...metricsTimeframes);
export const permissionLevel = type.enumerated(...permissionLevels);
export const featureFlagKey = type.enumerated(...featureFlagKeys);
export const verificationMethod = type.enumerated(...verificationMethods);
export const totpResetChoice = type.enumerated(...totpResetChoices);
export const ticketCategory = type.enumerated(...ticketCategories);
export const ticketPriority = type.enumerated(...ticketPriorities);
export const ticketStatus = type.enumerated(...ticketStatuses);
export const ticketSubject = type.string.atLeastLength(1).atMostLength(MAX_TICKET_SUBJECT_LENGTH);
export const ticketBody = type.string.atLeastLength(1).atMostLength(MAX_TICKET_MESSAGE_LENGTH);
export const ticketAttachmentIds = type.string
	.atMostLength(64)
	.array()
	.atMostLength(MAX_TICKET_ATTACHMENTS);

export const createVmFields = {
	vmTypeId: 'string',
	name: 'string',
	'networkingMode?': networkingMode,
	'imageId?': 'string',
	'sshKeyIds?': 'string[]',
	'password?': 'string',
	idempotencyKey: idempotencyKeySchema
} as const;
