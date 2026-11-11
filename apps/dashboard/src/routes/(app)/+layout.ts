import type { LayoutLoad } from './$types';

const PROJECT_PATH_PATTERN = /^\/projects\/([^/]+)/;

export const load: LayoutLoad = ({ data, url }) => {
	const pathProjectId = url.pathname.match(PROJECT_PATH_PATTERN)?.[1];
	const activeProjectId = pathProjectId ?? data.activeProjectId;
	const currentProject =
		url.pathname === '/'
			? null
			: (data.projects.find((project) => project.id === activeProjectId) ??
				data.projects[0] ??
				null);

	return { ...data, currentProject };
};
