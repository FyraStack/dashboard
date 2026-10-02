import { dev } from '$app/env';

export const config = {
	admin: {
		defaultImageImportStorage: dev ? 'stack-volumes' : 'cephfs'
	}
};
