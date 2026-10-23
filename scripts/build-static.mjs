// Builds the app as plain files for the static site (ADR-018).
// A script rather than `SITE_MODE=static astro build` so it works in PowerShell too.
import { spawnSync } from 'node:child_process';

const result = spawnSync('npx', ['astro', 'build'], {
	stdio: 'inherit',
	shell: process.platform === 'win32',
	env: { ...process.env, SITE_MODE: 'static' },
});
process.exit(result.status ?? 1);
