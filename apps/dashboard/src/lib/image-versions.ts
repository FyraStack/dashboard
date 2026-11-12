const archTokenPattern = /(x86[-_]64|amd64|aarch64|arm64|i[3-6]86|ppc64le|s390x)/gi;
const imageExtensionPattern = /\.(qcow2|img|raw|vmdk|ova|xz|gz|zst)$/i;
const pathSeparatorPattern = /[/:]/;
const versionTokenPattern = /(?:^|[^0-9a-z])v?(\d+(?:\.\d+)*)(?=$|[^0-9])/i;

export function compareVersionsDesc(a: string, b: string): number {
	return b.localeCompare(a, undefined, { numeric: true });
}

export function guessVersionFromFilename(filePath: string): string {
	let name = filePath.split(pathSeparatorPattern).pop() ?? '';
	while (imageExtensionPattern.test(name)) {
		name = name.replace(imageExtensionPattern, '');
	}
	name = name.replace(archTokenPattern, '');
	return name.match(versionTokenPattern)?.[1] ?? '';
}
