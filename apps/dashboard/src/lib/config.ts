import { dev } from '$app/environment';

export const config = {
	admin: {
		defaultImageImportStorage: dev ? 'stack-volumes' : 'cephfs'
	}
};
