import { invalidate } from '$app/navigation';

interface OptimisticUpdate {
	apply: () => () => void;
	commit: () => Promise<unknown>;
	invalidates: readonly string[];
}

export async function runOptimistic({ apply, commit, invalidates }: OptimisticUpdate) {
	const rollback = apply();
	try {
		await commit();
	} catch (err) {
		rollback();
		throw err;
	}
	await Promise.allSettled(invalidates.map((key) => invalidate(key)));
}
