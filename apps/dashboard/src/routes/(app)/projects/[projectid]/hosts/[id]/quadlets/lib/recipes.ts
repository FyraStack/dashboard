import type {
	ManagedHostQuadletDetail,
	ManagedHostQuadletResource,
	ManagedHostQuadletScope
} from '$lib/remote/managed-hosts.remote';

export type NginxSiteOptions = {
	appId: string;
	siteTitle: string;
	serverName: string;
	hostPort: number;
};

export type NextcloudOptions = {
	appId: string;
	domain: string;
	hostPort: number;
	adminUser: string;
	adminPassword: string;
	databaseName: string;
	databaseUser: string;
	databasePassword: string;
	enableRedis: boolean;
	phpMemoryLimit: string;
	uploadLimit: string;
	trustedProxies: string;
	overwriteProtocol: 'http' | 'https';
};

export type QuadletRecipeOption = {
	id: 'nginx-site' | 'nextcloud';
	name: string;
	description: string;
	category: string;
};

export type RecipeDetail = ManagedHostQuadletDetail & {
	recipeName: string;
	resources: ManagedHostQuadletResource[];
};

export const quadletRecipeOptions: QuadletRecipeOption[] = [
	{
		id: 'nginx-site',
		name: 'Nginx static site',
		description: 'Serve mutable site files with a Quadlet-managed nginx container.',
		category: 'Web'
	},
	{
		id: 'nextcloud',
		name: 'Nextcloud',
		description: 'Run Nextcloud with MariaDB, optional Redis, managed volumes, and web defaults.',
		category: 'Apps'
	}
];

export function buildRecipeDetail(
	recipeId: QuadletRecipeOption['id'],
	scope: ManagedHostQuadletScope,
	options: NginxSiteOptions | NextcloudOptions
): RecipeDetail {
	switch (recipeId) {
		case 'nginx-site':
			return buildNginxSiteRecipe(scope, options as NginxSiteOptions);
		case 'nextcloud':
			return buildNextcloudRecipe(scope, options as NextcloudOptions);
	}
}

export function defaultNginxSiteOptions(): NginxSiteOptions {
	return {
		appId: 'demo-web',
		siteTitle: 'Demo Web',
		serverName: '_',
		hostPort: 8080
	};
}

export function defaultNextcloudOptions(): NextcloudOptions {
	return {
		appId: 'nextcloud',
		domain: 'cloud.example.com',
		hostPort: 8081,
		adminUser: 'admin',
		adminPassword: 'change-me-admin-password',
		databaseName: 'nextcloud',
		databaseUser: 'nextcloud',
		databasePassword: 'change-me-db-password',
		enableRedis: true,
		phpMemoryLimit: '512M',
		uploadLimit: '2G',
		trustedProxies: '',
		overwriteProtocol: 'https'
	};
}

function buildNginxSiteRecipe(
	scope: ManagedHostQuadletScope,
	options: NginxSiteOptions
): RecipeDetail {
	const appId = normalizeAppId(options.appId, 'demo-web');
	const siteTitle = options.siteTitle.trim() || 'Demo Web';
	const serverName = options.serverName.trim() || '_';
	const hostPort = clampPort(options.hostPort, 8080);
	const filesBaseDir = bundleDir(scope, appId);
	const contents = `[Unit]
Description=${siteTitle} web site

[Container]
ContainerName=${appId}
Image=docker.io/library/nginx:alpine
PublishPort=${hostPort}:80
Volume=${filesBaseDir}:/usr/share/nginx/html:ro
Volume=${filesBaseDir}/default.conf:/etc/nginx/conf.d/default.conf:ro

[Service]
Restart=always

[Install]
WantedBy=default.target
`;
	const filename = `${appId}.container`;
	const resources = [{ filename, contents }];

	return {
		scope,
		recipeName: 'Nginx static site',
		baseDir: quadletBaseDir(scope),
		filesBaseDir,
		filename,
		contents,
		resources,
		files: [
			{
				filename: 'index.html',
				contents:
					`<!doctype html>\n<title>${escapeHtml(siteTitle)}</title>\n<h1>${escapeHtml(siteTitle)}</h1>\n<p>This page is served from a Tetra-managed Quadlet companion file.</p>\n`
			},
			{
				filename: 'default.conf',
				contents:
					`server {\n  listen 80;\n  server_name ${serverName};\n  root /usr/share/nginx/html;\n  index index.html;\n}\n`
			}
		]
	};
}

function buildNextcloudRecipe(
	scope: ManagedHostQuadletScope,
	options: NextcloudOptions
): RecipeDetail {
	const appId = normalizeAppId(options.appId, 'nextcloud');
	const domain = options.domain.trim() || 'cloud.example.com';
	const hostPort = clampPort(options.hostPort, 8081);
	const adminUser = safeEnv(options.adminUser, 'admin');
	const adminPassword = safeEnv(options.adminPassword, 'change-me-admin-password');
	const databaseName = safeEnv(options.databaseName, 'nextcloud');
	const databaseUser = safeEnv(options.databaseUser, 'nextcloud');
	const databasePassword = safeEnv(options.databasePassword, 'change-me-db-password');
	const phpMemoryLimit = safeEnv(options.phpMemoryLimit, '512M');
	const uploadLimit = safeEnv(options.uploadLimit, '2G');
	const trustedProxies = options.trustedProxies.trim();
	const overwriteProtocol = options.overwriteProtocol === 'http' ? 'http' : 'https';

	const resources: ManagedHostQuadletResource[] = [
		{
			filename: `${appId}-net.network`,
			contents: `[Network]
NetworkName=${appId}-net
Driver=bridge
`
		},
		{
			filename: `${appId}-data.volume`,
			contents: `[Volume]
VolumeName=${appId}-data
`
		},
		{
			filename: `${appId}-db.volume`,
			contents: `[Volume]
VolumeName=${appId}-db
`
		},
		{
			filename: `${appId}-db.container`,
			contents: `[Unit]
Description=Nextcloud database

[Container]
ContainerName=${appId}-db
Image=docker.io/library/mariadb:11
Network=${appId}-net.network
Volume=${appId}-db.volume:/var/lib/mysql
Environment=MARIADB_DATABASE=${databaseName}
Environment=MARIADB_USER=${databaseUser}
Environment=MARIADB_PASSWORD=${databasePassword}
Environment=MARIADB_ROOT_PASSWORD=${databasePassword}

[Service]
Restart=always

[Install]
WantedBy=default.target
`
		}
	];

	if (options.enableRedis) {
		resources.push({
			filename: `${appId}-redis.container`,
			contents: `[Unit]
Description=Nextcloud Redis cache

[Container]
ContainerName=${appId}-redis
Image=docker.io/library/redis:7-alpine
Network=${appId}-net.network

[Service]
Restart=always

[Install]
WantedBy=default.target
`
		});
	}

	const appContents = `[Unit]
Description=Nextcloud application
Requires=${appId}-db.service
After=${appId}-db.service
${options.enableRedis ? `Wants=${appId}-redis.service\nAfter=${appId}-redis.service\n` : ''}
[Container]
ContainerName=${appId}-app
Image=docker.io/library/nextcloud:latest
Network=${appId}-net.network
Volume=${appId}-data.volume:/var/www/html
Environment=NEXTCLOUD_TRUSTED_DOMAINS=${domain}
Environment=OVERWRITEHOST=${domain}
Environment=OVERWRITEPROTOCOL=${overwriteProtocol}
Environment=MYSQL_HOST=${appId}-db
Environment=MYSQL_DATABASE=${databaseName}
Environment=MYSQL_USER=${databaseUser}
Environment=MYSQL_PASSWORD=${databasePassword}
Environment=NEXTCLOUD_ADMIN_USER=${adminUser}
Environment=NEXTCLOUD_ADMIN_PASSWORD=${adminPassword}
Environment=PHP_MEMORY_LIMIT=${phpMemoryLimit}
Environment=PHP_UPLOAD_LIMIT=${uploadLimit}
${trustedProxies ? `Environment=TRUSTED_PROXIES=${trustedProxies}\n` : ''}${options.enableRedis ? `Environment=REDIS_HOST=${appId}-redis\n` : ''}PublishPort=${hostPort}:80

[Service]
Restart=always

[Install]
WantedBy=default.target
`;
	const filename = `${appId}-app.container`;
	resources.push({ filename, contents: appContents });

	return {
		scope,
		recipeName: 'Nextcloud',
		baseDir: quadletBaseDir(scope),
		filesBaseDir: null,
		filename,
		contents: appContents,
		resources,
		files: []
	};
}

function quadletBaseDir(scope: ManagedHostQuadletScope) {
	return scope === 'system' ? '/etc/containers/systemd' : '/home/a11y/.config/containers/systemd';
}

function bundleDir(scope: ManagedHostQuadletScope, appId: string) {
	return scope === 'system'
		? `/var/lib/tetra/quadlets/${appId}`
		: `/home/a11y/.local/share/tetra/quadlets/${appId}`;
}

function normalizeAppId(value: string, fallback: string) {
	return (
		value
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9_.-]+/g, '-')
			.replace(/^-+|-+$/g, '') || fallback
	);
}

function clampPort(value: number, fallback: number) {
	const port = Number.isFinite(value) ? Math.trunc(value) : fallback;
	return Math.max(1, Math.min(65535, port));
}

function safeEnv(value: string, fallback: string) {
	return value.trim().replace(/\s+/g, '_') || fallback;
}

function escapeHtml(value: string) {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}
