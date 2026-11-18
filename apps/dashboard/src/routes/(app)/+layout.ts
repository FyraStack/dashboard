import type { LayoutLoad } from './$types';

const PROJECT_PATH_PATTERN = /^\/projects\/([^/]+)/;
const SUPPORT_PATH_PATTERN = /^\/support(\/|$)/;

export const load: LayoutLoad = ({ data, url }) => {
	const findProject = (projectId: string | null | undefined) =>
		data.projects.find((project) => project.id === projectId) ?? null;

	if (url.pathname === '/') {
		return { ...data, currentProject: null };
	}
	if (SUPPORT_PATH_PATTERN.test(url.pathname)) {
		return { ...data, currentProject: findProject(url.searchParams.get('project')) };
	}

	const pathProjectId = url.pathname.match(PROJECT_PATH_PATTERN)?.[1];
	const currentProject =
		findProject(pathProjectId ?? data.activeProjectId) ?? data.projects[0] ?? null;

	return { ...data, currentProject };
};
