import { createContext } from 'svelte';

export type ColoUnitStatus = 'online' | 'offline' | 'provisioning';

export type ColoUnit = {
	id: string;
	name: string;
	rackSize: string;
	location: string;
	powerDraw: string;
	powerBudget: string;
	ip: string;
	status: ColoUnitStatus;
	monthlyRate: string;
	created: string;
};

export type ColocationTab = 'overview' | 'networking' | 'images' | 'ipmi' | 'sensors' | 'settings';

export type ColocationContext = {
	readonly units: ColoUnit[];
	readonly selectedUnit: ColoUnit | undefined;
	readonly selectedUnitId: string;
	tabHref: (tab: ColocationTab, unitId?: string) => string;
	updateSelectedUnit: (changes: Partial<ColoUnit>) => void;
	openDeleteUnitDialog: () => void;
};

export const [getColocationContext, setColocationContext] = createContext<ColocationContext>();
