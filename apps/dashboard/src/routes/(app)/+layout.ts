import type { LayoutLoad } from './$types';

export const load: LayoutLoad = ({ data, url }) => {
	// URL changes only select from data we already have; they need no server reload.
	const requestedProjectId = url.searchParams.get('projectId');
	const pathProjectId = url.pathname.match(/^\/projects\/([^/]+)/)?.[1];
	const activeProjectId = requestedProjectId ?? pathProjectId ?? data.activeProjectId;
	const currentProject =
		url.pathname === '/'
			? null
			: (data.projects.find((project) => project.id === activeProjectId) ??
				(requestedProjectId ? null : (data.projects[0] ?? null)));

	return { ...data, currentProject };
};
