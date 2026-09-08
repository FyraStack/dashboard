export type VmPlanCapacity = {
	cores: number;
	ramCapacity: number;
	storageAmount: number;
};

export function findPlanDowngrades(current: VmPlanCapacity, target: VmPlanCapacity): string[] {
	const downgrades: string[] = [];
	if (target.cores < current.cores) {
		downgrades.push(`CPU (${current.cores} → ${target.cores} vCPU)`);
	}
	if (target.ramCapacity < current.ramCapacity) {
		downgrades.push(`RAM (${current.ramCapacity}MB → ${target.ramCapacity}MB)`);
	}
	if (target.storageAmount < current.storageAmount) {
		downgrades.push(`disk (${current.storageAmount}GB → ${target.storageAmount}GB)`);
	}
	return downgrades;
}
