import { createContext } from 'svelte';

export type ColoUnitStatus = 'online' | 'offline' | 'provisioning';

export interface ColoUnit {
	created: string;
	id: string;
	ip: string;
	location: string;
	monthlyRate: string;
	name: string;
	powerBudget: string;
	powerDraw: string;
	rackSize: string;
	status: ColoUnitStatus;
}

export type ColocationTab = 'overview' | 'networking' | 'images' | 'ipmi' | 'sensors' | 'settings';

export type ColocationHref =
	| `projects/${string}/colocation/${string}`
	| `projects/${string}/colocation/${string}/${Exclude<ColocationTab, 'overview'>}`;

export interface ColocationContext {
	openDeleteUnitDialog: () => void;
	readonly selectedUnit: ColoUnit | undefined;
	readonly selectedUnitId: string;
	tabHref: (tab: ColocationTab, unitId?: string) => ColocationHref;
	readonly units: ColoUnit[];
	updateSelectedUnit: (changes: Partial<ColoUnit>) => void;
}

export const [getColocationContext, setColocationContext] = createContext<ColocationContext>();
