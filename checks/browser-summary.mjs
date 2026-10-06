#!/usr/bin/env node
// Turn Playwright's JSON results into a short, readable summary (Markdown).
import fs from 'node:fs';

const file = process.argv[2] || 'results/browser.json';
if (!fs.existsSync(file)) {
  console.log('## Browser checks\n\n❌ The browser checks did not produce results (they may have crashed). See the run log.');
  process.exit(0);
}
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const strip = s => (s || '').replace(/\x1b\[[0-9;]*m/g, '');
const rows = [];
let passed = 0, failed = 0, flaky = 0, skipped = 0;
const known = [];

(function walk(suite, trail = []) {
  for (const s of suite.suites || []) walk(s, [...trail, s.title]);
  for (const spec of suite.specs || []) {
    for (const t of spec.tests) {
      const last = t.results.at(-1);
      for (const a of t.annotations || []) if (/known issue/.test(a.type)) known.push(`${t.projectName}: ${spec.title}: ${a.description}`);
      if (t.status === 'skipped') { skipped++; continue; }
      if (t.status === 'expected') { passed++; continue; }
      if (t.status === 'flaky') { flaky++; continue; }
      failed++;
      const msg = strip(last?.error?.message).split('\n').find(l => l.trim() && !/^\s*expect\(/.test(l)) || 'failed';
      rows.push(`| ❌ | ${t.projectName} | ${spec.title} | ${msg.replace(/\|/g, '\\|').slice(0, 220)} |`);
    }
  }
})(data);

const out = [
  '## Browser checks (desktop and phone)',
  '',
  `${failed ? '❌' : '✅'} ${passed} passed, ${failed} failed${flaky ? `, ${flaky} passed on a second try` : ''}${skipped ? `, ${skipped} not applicable` : ''}`,
];
if (rows.length) out.push('', '| | Where | Check | What went wrong |', '|---|---|---|---|', ...rows);
if (known.length) out.push('', '**Known issues** (listed in sites.mjs, not counted as failures):', ...known.map(k => `- ${k}`));
console.log(out.join('\n'));
