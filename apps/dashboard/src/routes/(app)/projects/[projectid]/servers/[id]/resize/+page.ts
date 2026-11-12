import { listVmTypes } from '#lib/remote/vm-types.remote.js';
import type { PageLoad } from './$types';

export const load: PageLoad = async () => ({ vmTypes: await listVmTypes() });
