import { error } from '@sveltejs/kit';
import { and, eq, isNull, lt } from 'drizzle-orm';
import { runInBackground } from '#lib/server/background.js';
import {
	ensureLocalProjectBillingCustomer,
	ensureProjectCustomer
} from '#lib/server/billing/autumn.js';
import type { Database } from '#lib/server/db/index.js';
import { projectCreateRequests } from '#lib/server/db/schema.js';

const PROJECT_CREATE_CLAIM_STALE_MS = 2 * 60_000;

type ProjectCreateClaim = { status: 'claimed' } | { status: 'existing'; projectId: string };

function requestKey(userId: string, requestId: string) {
	return and(
		eq(projectCreateRequests.userId, userId),
		eq(projectCreateRequests.requestId, requestId)
	);
}

async function claimProjectCreateRequest(
	db: Database,
	userId: string,
	requestId: string
): Promise<ProjectCreateClaim> {
	const now = Date.now();
	const [inserted] = await db
		.insert(projectCreateRequests)
		.values({ userId, requestId, createdAt: now })
		.onConflictDoNothing()
		.returning({ userId: projectCreateRequests.userId });
	if (inserted) {
		return { status: 'claimed' };
	}

	const [existing] = await db
		.select({ projectId: projectCreateRequests.projectId })
		.from(projectCreateRequests)
		.where(requestKey(userId, requestId))
		.limit(1);
	if (existing?.projectId) {
		return { status: 'existing', projectId: existing.projectId };
	}

	const [reclaimed] = await db
		.update(projectCreateRequests)
		.set({ createdAt: now })
		.where(
			and(
				requestKey(userId, requestId),
				isNull(projectCreateRequests.projectId),
				lt(projectCreateRequests.createdAt, now - PROJECT_CREATE_CLAIM_STALE_MS)
			)
		)
		.returning({ userId: projectCreateRequests.userId });
	if (reclaimed) {
		return { status: 'claimed' };
	}

	error(409, 'This project is already being created. Try again in a moment.');
}

export async function createProjectOnce(
	db: Database,
	input: { userId: string; requestId: string },
	create: () => Promise<{ id: string }>
): Promise<{ id: string; created: boolean }> {
	const claim = await claimProjectCreateRequest(db, input.userId, input.requestId);
	if (claim.status === 'existing') {
		return { id: claim.projectId, created: false };
	}

	let projectId: string;
	try {
		({ id: projectId } = await create());
	} catch (err) {
		await db
			.delete(projectCreateRequests)
			.where(
				and(requestKey(input.userId, input.requestId), isNull(projectCreateRequests.projectId))
			);
		throw err;
	}

	await db
		.update(projectCreateRequests)
		.set({ projectId })
		.where(requestKey(input.userId, input.requestId));

	await ensureLocalProjectBillingCustomer(projectId);
	runInBackground(ensureProjectCustomer(projectId), `project-customer-${projectId}`);

	return { id: projectId, created: true };
}
