import { requireFeature } from '#lib/feature-gate.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ parent }) => requireFeature(parent, 'firewall');
