import {
	autumnStatus,
	createAutumnClient,
	isBillingConfigured,
	serverEntityFeatureId
} from './autumn.ts';
import { ensureProjectCustomer } from './customers.ts';

interface ServerEntityInput {
	name?: string | null;
	projectId: string;
	serverId: string;
}

export async function ensureServerEntity(input: ServerEntityInput) {
	if (!isBillingConfigured()) {
		return;
	}

	const client = createAutumnClient();

	try {
		await client.entities.get({ customerId: input.projectId, entityId: input.serverId });
		return;
	} catch (err) {
		if (autumnStatus(err) !== 404) {
			throw err;
		}
	}

	try {
		await client.entities.create({
			customerId: input.projectId,
			entityId: input.serverId,
			featureId: serverEntityFeatureId(),
			name: input.name ?? input.serverId
		});
	} catch (err) {
		if (autumnStatus(err) !== 409) {
			throw err;
		}
	}
}

export async function ensureProjectServerEntity(input: ServerEntityInput) {
	if (!isBillingConfigured()) {
		return;
	}

	await ensureProjectCustomer(input.projectId);
	await ensureServerEntity(input);
}

export async function deleteProjectServerEntity(projectId: string, serverId: string) {
	if (!isBillingConfigured()) {
		return;
	}

	try {
		await createAutumnClient().entities.delete({ customerId: projectId, entityId: serverId });
	} catch (err) {
		if (autumnStatus(err) !== 404) {
			throw err;
		}
	}
}
