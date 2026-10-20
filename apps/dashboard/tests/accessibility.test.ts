import { styleText } from 'node:util';
import { expect } from '@playwright/test';
import { localURL, pages, test } from './accessibility';

function formatImpact(impact: string | null | undefined) {
	if (!impact) {
		return 'unknown';
	}

	const impactKey: Record<string, string> = {
		minor: styleText('blue', impact),
		moderate: styleText('yellowBright', impact),
		serious: styleText('yellow', impact),
		critical: styleText('red', impact)
	};

	return impactKey[impact] ?? impact;
}

const modes = [
	{ label: 'dark', mode: 'dark', theme: '' },
	{ label: 'light', mode: 'light', theme: '' },
	{ label: 'dark high contrast', mode: 'dark', theme: 'high-contrast' },
	{ label: 'light high contrast', mode: 'light', theme: 'high-contrast' }
] as const;

for (const { label: modeLabel, mode, theme } of modes) {
	for (const { label, path } of pages) {
		test(`Testing for accessibility violations on ${label} in ${modeLabel} mode.`, async ({
			page,
			makeAxeBuilder
		}) => {
			await page.addInitScript(
				([selectedMode, selectedTheme]) => {
					window.localStorage.setItem('mode-watcher-mode', selectedMode);
					window.localStorage.setItem('mode-watcher-theme', selectedTheme);
				},
				[mode, theme] as const
			);
			await page.goto(`${localURL}${path}`, { waitUntil: 'networkidle' });

			const { violations } = await makeAxeBuilder().analyze();
			const reportMessage = `Found ${violations.length} accessibility violations on ${label} in ${modeLabel} mode.`;

			if (violations.length === 0) {
				expect(violations, reportMessage).toHaveLength(0);
				return;
			}

			const violationLog = violations
				.map((violation, violationIndex) => {
					const nodes = violation.nodes
						.map(
							(node, nodeIndex) => `
${styleText('redBright', `  Node ${nodeIndex + 1} HTML:`)} ${node.html}
${styleText('redBright', `  Node ${nodeIndex + 1} CSS:`)} ${node.target.join(', ')}
${styleText('green', '  Suggested fix:')}
  ${node.failureSummary ?? 'No failure summary provided.'}`
						)
						.join('\n');

					return `
${styleText(['redBright', 'bold'], `Violation ${violationIndex + 1}:`)}
${styleText('redBright', '  Violation ID:')} ${violation.id}
${styleText('redBright', '  Violation Impact:')} ${formatImpact(violation.impact)}
${styleText('redBright', '  Violation Description:')} ${violation.help}
${styleText('redBright', '  More info:')} ${violation.helpUrl}
${nodes}`;
				})
				.join('\n\n');

			throw new Error(`${violationLog}\n\n${reportMessage}`);
		});
	}
}
