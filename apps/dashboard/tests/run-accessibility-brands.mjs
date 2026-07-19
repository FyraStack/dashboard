import { spawnSync } from 'node:child_process';

const runs = [
	{ label: 'stack', env: {} },
	{ label: 'ultramarine', env: { PUBLIC_DASHBOARD_BRAND: 'ultramarine' } }
];

let failed = false;

for (const run of runs) {
	console.log(`\nRunning accessibility checks for ${run.label} branding...\n`);
	const result = spawnSync('pnpm', ['exec', 'playwright', 'test'], {
		stdio: 'inherit',
		env: { ...process.env, ...run.env }
	});

	if (result.status !== 0) {
		failed = true;
		console.error(`\nAccessibility checks failed for ${run.label} branding.\n`);
	}
}

if (failed) {
	process.exit(1);
}
