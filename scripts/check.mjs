import { readdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
for (const name of await readdir('src')) if (name.endsWith('.js')) execFileSync(process.execPath, ['--check', `src/${name}`], { stdio: 'inherit' });
const manifest = JSON.parse(await readFile('src/manifest.json'));
for (const file of [manifest.action.default_popup, manifest.background.service_worker, ...manifest.content_scripts.flatMap(s => s.js)]) await readFile(`src/${file}`);
console.log('JavaScript and manifest checks passed');
