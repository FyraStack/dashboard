import { and, eq } from 'drizzle-orm';
import { member, organization, user } from '#lib/server/db/auth.schema.js';
import { initDrizzle } from '#lib/server/db/index.js';

export async function isProjectBillingExempt(projectId: string) {
	const db = initDrizzle();

	const [project] = await db
		.select({ billingExempt: organization.billingExempt })
		.from(organization)
		.where(eq(organization.id, projectId))
		.limit(1);
	if (project?.billingExempt) {
		return true;
	}

	const [exemptOwner] = await db
		.select({ userId: member.userId })
		.from(member)
		.innerJoin(user, eq(user.id, member.userId))
		.where(
			and(
				eq(member.organizationId, projectId),
				eq(member.role, 'owner'),
				eq(user.billingExempt, true)
			)
		)
		.limit(1);

	return Boolean(exemptOwner);
}
