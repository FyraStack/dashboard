import type {
	ManagedHostQuadletDetail,
	ManagedHostQuadletResource,
	ManagedHostQuadletScope
} from '$lib/remote/managed-hosts.remote';
import { parse as parseYaml } from 'yaml';

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

export type ComposeOptions = {
	appId: string;
	composeYaml: string;
};

export type QuadletRecipeOption = {
	id: 'nginx-site' | 'nextcloud' | 'compose';
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
	},
	{
		id: 'compose',
		name: 'Compose specification',
		description: 'Paste a Compose file and generate equivalent Quadlet container resources.',
		category: 'Import'
	}
];

export function buildRecipeDetail(
	recipeId: QuadletRecipeOption['id'],
	scope: ManagedHostQuadletScope,
	options: NginxSiteOptions | NextcloudOptions | ComposeOptions
): RecipeDetail {
	switch (recipeId) {
		case 'nginx-site':
			return buildNginxSiteRecipe(scope, options as NginxSiteOptions);
		case 'nextcloud':
			return buildNextcloudRecipe(scope, options as NextcloudOptions);
		case 'compose':
			return buildComposeRecipe(scope, options as ComposeOptions);
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

export function defaultComposeOptions(): ComposeOptions {
	return {
		appId: 'compose-app',
		composeYaml: `services:
  web:
    image: docker.io/library/nginx:alpine
    ports:
      - "8080:80"
    volumes:
      - ./html:/usr/share/nginx/html:ro
    restart: unless-stopped
`
	};
}

export function validateComposeOptions(options: ComposeOptions): string {
	try {
		const compose = parseCompose(options.composeYaml);
		if (compose.error) return compose.error;
		return '';
	} catch (err) {
		return err instanceof Error ? err.message : 'Compose YAML could not be parsed.';
	}
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

function buildComposeRecipe(
	scope: ManagedHostQuadletScope,
	options: ComposeOptions
): RecipeDetail {
	const appId = normalizeAppId(options.appId, 'compose-app');
	const filesBaseDir = bundleDir(scope, appId);
	const parsed = parseCompose(options.composeYaml);
	if (parsed.error || !parsed.compose) {
		const filename = `${appId}-compose.container`;
		return {
			scope,
			recipeName: 'Compose specification',
			baseDir: quadletBaseDir(scope),
			filesBaseDir,
			filename,
			contents: '',
			resources: [],
			files: [{ filename: 'compose.yaml', contents: options.composeYaml.trimEnd() + '\n' }]
		};
	}

	const resources: ManagedHostQuadletResource[] = [];
	const serviceEntries = Object.entries(parsed.compose.services);
	const serviceNames = new Set(serviceEntries.map(([name]) => name));
	const namedVolumes = new Set<string>(Object.keys(parsed.compose.volumes ?? {}));
	const namedNetworks = new Set<string>(Object.keys(parsed.compose.networks ?? {}));
	const useDefaultNetwork =
		serviceEntries.length > 1 && serviceEntries.every(([, service]) => !service.networks);

	for (const [, service] of serviceEntries) {
		for (const volume of service.volumes ?? []) {
			const source = volumeSourceName(volume);
			if (source && !isRelativePath(source) && !isAbsolutePath(source)) namedVolumes.add(source);
		}
		for (const network of serviceNetworkNames(service.networks)) {
			namedNetworks.add(network);
		}
	}

	if (useDefaultNetwork) namedNetworks.add('default');

	for (const volume of namedVolumes) {
		const volumeId = normalizeAppId(volume, 'data');
		resources.push({
			filename: `${appId}-${volumeId}.volume`,
			contents: `[Volume]
VolumeName=${appId}-${volumeId}
`
		});
	}

	for (const network of namedNetworks) {
		const networkId = normalizeAppId(network, 'default');
		resources.push({
			filename: `${appId}-${networkId}.network`,
			contents: `[Network]
NetworkName=${appId}-${networkId}
Driver=bridge
`
		});
	}

	for (const [name, service] of serviceEntries) {
		const serviceId = normalizeAppId(name, 'service');
		const dependencies = serviceDependencyNames(service.depends_on).filter((dependency) =>
			serviceNames.has(dependency)
		);
		const unitDependencies = dependencies
			.map((dependency) => `${appId}-${normalizeAppId(dependency, 'service')}.service`)
			.join(' ');
		const serviceNetworks = serviceNetworkNames(service.networks);
		const networks = serviceNetworks.length
			? serviceNetworks
			: useDefaultNetwork
				? ['default']
				: [];
		const restart = serviceRestartPolicy(service.restart);
		const containerLines = [
			`ContainerName=${appId}-${serviceId}`,
			`Image=${service.image}`,
			...arrayLines('PublishPort', service.ports?.map(formatPort).filter(Boolean) ?? []),
			...arrayLines(
				'Volume',
				(service.volumes ?? []).map((volume) => formatVolume(volume, appId, filesBaseDir)).filter(Boolean)
			),
			...arrayLines(
				'Environment',
				environmentLines(service.environment).concat(service.env_file?.map((file) => `env_file=${file}`) ?? [])
			),
			...arrayLines(
				'Network',
				networks.map((network) => `${appId}-${normalizeAppId(network, 'default')}.network`)
			),
			...arrayLines('Label', labelLines(service.labels)),
			service.user ? `User=${service.user}` : '',
			service.working_dir ? `WorkingDir=${service.working_dir}` : '',
			service.entrypoint ? `Entrypoint=${stringOrList(service.entrypoint)}` : '',
			service.command ? `Exec=${stringOrList(service.command)}` : ''
		].filter(Boolean);

		const contents = `[Unit]
Description=${appId} ${name}
${unitDependencies ? `Requires=${unitDependencies}\nAfter=${unitDependencies}\n` : ''}
[Container]
${containerLines.join('\n')}

[Service]
Restart=${restart}

[Install]
WantedBy=default.target
`;
		resources.push({ filename: `${appId}-${serviceId}.container`, contents });
	}

	const filename = resources.find((resource) => resource.filename.endsWith('.container'))?.filename
		?? `${appId}.container`;
	const contents = resources.find((resource) => resource.filename === filename)?.contents ?? '';

	return {
		scope,
		recipeName: 'Compose specification',
		baseDir: quadletBaseDir(scope),
		filesBaseDir,
		filename,
		contents,
		resources,
		files: [{ filename: 'compose.yaml', contents: options.composeYaml.trimEnd() + '\n' }]
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

type ComposeSpec = {
	services: Record<string, ComposeService>;
	volumes?: Record<string, unknown>;
	networks?: Record<string, unknown>;
};

type ComposeService = {
	image?: string;
	build?: unknown;
	command?: string | string[];
	entrypoint?: string | string[];
	environment?: Record<string, unknown> | string[];
	env_file?: string[];
	ports?: ComposePort[];
	volumes?: ComposeVolume[];
	networks?: string[] | Record<string, unknown>;
	depends_on?: string[] | Record<string, unknown>;
	labels?: Record<string, unknown> | string[];
	restart?: string;
	user?: string;
	working_dir?: string;
};

type ComposePort =
	| string
	| {
			target?: number | string;
			published?: number | string;
			protocol?: string;
	  };

type ComposeVolume =
	| string
	| {
			type?: string;
			source?: string;
			target?: string;
			read_only?: boolean;
	  };

function parseCompose(text: string): { compose?: ComposeSpec; error: string } {
	if (!text.trim()) return { error: 'Paste a Compose specification.' };
	const value = parseYaml(text) as unknown;
	if (!isRecord(value)) return { error: 'Compose YAML must be a mapping.' };
	if (!isRecord(value.services) || Object.keys(value.services).length === 0) {
		return { error: 'Compose YAML must define at least one service.' };
	}

	const services: Record<string, ComposeService> = {};
	for (const [name, service] of Object.entries(value.services)) {
		if (!isRecord(service)) return { error: `Service "${name}" must be a mapping.` };
		if (typeof service.image !== 'string' || !service.image.trim()) {
			return {
				error: `Service "${name}" needs an image. Compose build-only services are not converted yet.`
			};
		}
		services[name] = {
			image: service.image.trim(),
			build: service.build,
			command: stringOrStringArray(service.command),
			entrypoint: stringOrStringArray(service.entrypoint),
			environment: environmentValue(service.environment),
			env_file: stringArray(service.env_file),
			ports: portArray(service.ports),
			volumes: volumeArray(service.volumes),
			networks: networksValue(service.networks),
			depends_on: dependsOnValue(service.depends_on),
			labels: labelsValue(service.labels),
			restart: typeof service.restart === 'string' ? service.restart : undefined,
			user: typeof service.user === 'string' ? service.user : undefined,
			working_dir: typeof service.working_dir === 'string' ? service.working_dir : undefined
		};
	}

	return {
		error: '',
		compose: {
			services,
			volumes: isRecord(value.volumes) ? value.volumes : {},
			networks: isRecord(value.networks) ? value.networks : {}
		}
	};
}

function formatPort(port: ComposePort) {
	if (typeof port === 'string') return port;
	const target = port.target ? String(port.target) : '';
	const published = port.published ? String(port.published) : '';
	if (!target) return '';
	const protocol = port.protocol && port.protocol !== 'tcp' ? `/${port.protocol}` : '';
	return `${published ? `${published}:` : ''}${target}${protocol}`;
}

function formatVolume(volume: ComposeVolume, appId: string, filesBaseDir: string) {
	if (typeof volume === 'string') {
		const parts = volume.split(':');
		if (parts.length < 2) return volume;
		const [source, target, ...rest] = parts;
		return `${formatVolumeSource(source, appId, filesBaseDir)}:${target}${rest.length ? `:${rest.join(':')}` : ''}`;
	}

	if (!volume.target) return '';
	const source = volume.source ? formatVolumeSource(volume.source, appId, filesBaseDir) : '';
	const mode = volume.read_only ? ':ro' : '';
	return source ? `${source}:${volume.target}${mode}` : volume.target;
}

function formatVolumeSource(source: string, appId: string, filesBaseDir: string) {
	if (isRelativePath(source)) return `${filesBaseDir}/${source.replace(/^\.?\//, '')}`;
	if (isAbsolutePath(source)) return source;
	return `${appId}-${normalizeAppId(source, 'data')}.volume`;
}

function volumeSourceName(volume: ComposeVolume) {
	if (typeof volume === 'string') {
		const [source] = volume.split(':');
		return source;
	}
	return volume.source;
}

function environmentLines(environment: ComposeService['environment']) {
	if (Array.isArray(environment)) return environment;
	if (!environment) return [];
	return Object.entries(environment).map(([key, value]) => `${key}=${value ?? ''}`);
}

function labelLines(labels: ComposeService['labels']) {
	if (Array.isArray(labels)) return labels;
	if (!labels) return [];
	return Object.entries(labels).map(([key, value]) => `${key}=${value ?? ''}`);
}

function serviceNetworkNames(networks: ComposeService['networks']) {
	if (Array.isArray(networks)) return networks;
	if (isRecord(networks)) return Object.keys(networks);
	return [];
}

function serviceDependencyNames(dependsOn: ComposeService['depends_on']) {
	if (Array.isArray(dependsOn)) return dependsOn;
	if (isRecord(dependsOn)) return Object.keys(dependsOn);
	return [];
}

function serviceRestartPolicy(restart: string | undefined) {
	switch (restart) {
		case 'no':
			return 'no';
		case 'on-failure':
			return 'on-failure';
		case 'always':
		case 'unless-stopped':
		default:
			return 'always';
	}
}

function arrayLines(key: string, values: string[]) {
	return values.filter(Boolean).map((value) => `${key}=${value}`);
}

function stringOrList(value: string | string[]) {
	return Array.isArray(value) ? value.join(' ') : value;
}

function stringOrStringArray(value: unknown) {
	if (typeof value === 'string') return value;
	if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value;
	return undefined;
}

function stringArray(value: unknown) {
	if (typeof value === 'string') return [value];
	if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value;
	return undefined;
}

function portArray(value: unknown) {
	if (!Array.isArray(value)) return undefined;
	return value.filter((item): item is ComposePort => typeof item === 'string' || isRecord(item));
}

function volumeArray(value: unknown) {
	if (!Array.isArray(value)) return undefined;
	return value.filter((item): item is ComposeVolume => typeof item === 'string' || isRecord(item));
}

function environmentValue(value: unknown) {
	if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value;
	if (isRecord(value)) return value;
	return undefined;
}

function labelsValue(value: unknown) {
	if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value;
	if (isRecord(value)) return value;
	return undefined;
}

function networksValue(value: unknown) {
	if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value;
	if (isRecord(value)) return value;
	return undefined;
}

function dependsOnValue(value: unknown) {
	if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value;
	if (isRecord(value)) return value;
	return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function isRelativePath(value: string) {
	return value.startsWith('./') || value.startsWith('../');
}

function isAbsolutePath(value: string) {
	return value.startsWith('/');
}

function escapeHtml(value: string) {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}
