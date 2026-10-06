#!/usr/bin/env node
// Take full-page pictures of every key page, at desktop and phone sizes,
// and keep them under snapshots/<label>/.
//
//   npm run capture -- before     # just before an update
//   npm run capture -- after      # just after
//   npm run compare               # what changed?
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const label = process.argv[2];
if (!label || !/^[\w-]+$/.test(label)) {
  console.error('Usage: npm run capture -- <label>   (e.g. before, after)');
  process.exit(2);
}

fs.rmSync('screenshots', { recursive: true, force: true });
// The page checks save a full-page screenshot of each page as they go.
// We keep the pictures even if some checks fail: that's often when you need them most.
const run = spawnSync('npx', ['playwright', 'test', 'tests/pages.spec.mjs', '--reporter=line', ...process.argv.slice(3)], { stdio: 'inherit' });

const dest = path.join('snapshots', label);
fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync('snapshots', { recursive: true });
if (!fs.existsSync('screenshots')) {
  console.error('No screenshots were taken.');
  process.exit(1);
}
fs.cpSync('screenshots', dest, { recursive: true });
const count = fs.readdirSync(dest, { recursive: true }).filter(f => String(f).endsWith('.png')).length;
console.log(`\nSaved ${count} pictures to ${dest}/` + (run.status ? ' (some checks failed: see above)' : ''));
