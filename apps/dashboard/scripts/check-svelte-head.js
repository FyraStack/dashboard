#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const ROUTES_DIR = new URL('../src/routes', import.meta.url).pathname;
const OPT_OUT_COMMENT = 'check:allow-missing-head';
const HARD_EXCLUDES = ['src/routes/+layout.svelte'];
const strict = process.argv.includes('--strict');

async function* walk(dir) {
	const entries = await readdir(dir, { withFileTypes: true });
	for (const entry of entries) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			yield* walk(path);
		} else if (entry.isFile()) {
			yield path;
		}
	}
}

async function main() {
	const missing = [];

	for await (const filePath of walk(ROUTES_DIR)) {
		const fileName = filePath.split('/').pop();
		const projectRelative = relative(join(ROUTES_DIR, '..', '..'), filePath);

		if (HARD_EXCLUDES.some((ex) => projectRelative.endsWith(ex))) {
			continue;
		}

		let shouldCheck = false;
		if (fileName === '+page.svelte' || fileName === '+error.svelte') {
			shouldCheck = true;
		}

		if (!shouldCheck) {
			continue;
		}

		const content = await readFile(filePath, 'utf-8');
		if (content.includes('<svelte:head>')) {
			continue;
		}
		if (content.includes('<PageTitle')) {
			continue;
		}
		if (content.includes(OPT_OUT_COMMENT)) {
			continue;
		}

		missing.push(projectRelative);
	}

	if (missing.length === 0) {
		console.log(
			'✓ All routes have a <PageTitle> component, a <svelte:head> section, or an opt-out comment.'
		);
		process.exit(0);
	}

	console.error('✗ Missing <PageTitle> or <svelte:head> in the following route files:\n');
	for (const file of missing) {
		console.error(`  - ${file}`);
	}
	console.error(
		'\nAdd a <PageTitle> component to each file, or add <!-- check:allow-missing-head --> to opt out.'
	);

	if (strict) {
		process.exit(1);
	} else {
		console.error('\n(passing because --strict was not set)');
		process.exit(0);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
