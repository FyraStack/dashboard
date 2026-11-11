import { requireFeature } from '#lib/feature-gate.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ parent }) => requireFeature(parent, 'colocation');
