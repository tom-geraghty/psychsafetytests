#!/usr/bin/env node
// Turn Playwright's JSON results into a short, readable summary (Markdown).
import fs from 'node:fs';

const file = process.argv.slice(2).find(a => !a.startsWith('--')) || 'results/browser.json';
if (!fs.existsSync(file)) {
  console.log('## Browser checks\n\n❌ The browser checks did not produce results (they may have crashed). See the run log.');
  process.exit(0);
}
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const strip = s => (s || '').replace(/\x1b\[[0-9;]*m/g, '');
const rows = [];
let passed = 0, failed = 0, flaky = 0, skipped = 0;
const known = [];
const uniq = a => [...new Set(a)];

(function walk(suite, trail = []) {
  for (const s of suite.suites || []) walk(s, [...trail, s.title]);
  for (const spec of suite.specs || []) {
    for (const t of spec.tests) {
      const last = t.results.at(-1);
      // Annotations added while a test runs are stored on each result; static ones on the test.
      for (const a of [...(t.annotations || []), ...t.results.flatMap(r => r.annotations || [])]) {
        if (/known issue/.test(a.type)) known.push(`${t.projectName}: ${spec.title}: ${a.description}`);
      }
      if (t.status === 'skipped') { skipped++; continue; }
      if (t.status === 'expected') { passed++; continue; }
      if (t.status === 'flaky') { flaky++; continue; }
      failed++;
      const lines = strip(last?.error?.message).split('\n');
      let msg = lines.find(l => l.trim() && !/^\s*expect\(/.test(l)) || 'failed';
      // Add what was actually found (e.g. which file failed to load), if Playwright reported it.
      const found = lines.filter(l => /^\s*\+\s+"/.test(l)).map(l => l.replace(/^\s*\+\s+/, '').replace(/,$/, '')).slice(0, 3);
      const received = lines.find(l => /^Received:/.test(l.trim()));
      if (found.length) msg += ` → ${found.join('; ')}`;
      else if (received) msg += ` → ${received.trim()}`;
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
if (known.length) out.push('', '**Known issues** (listed in sites.mjs, not counted as failures):', ...uniq(known).map(k => `- ${k}`));
// With --annotate, print GitHub annotations instead of the Markdown summary.
if (!process.argv.includes('--annotate')) console.log(out.join('\n'));
else {
  // GitHub's annotation syntax: escape %, CR, LF in messages, plus : and , in titles.
  const msg = t => String(t).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  const prop = t => msg(t).replace(/:/g, '%3A').replace(/,/g, '%2C');
  for (const r of rows) {
    const [, , where, check, what] = r.split('|').map(x => x.trim());
    console.log(`::error title=${prop(`Browser - ${where}`)}::${msg(`${check}: ${what}`)}`);
  }
  for (const k of uniq(known)) console.log(`::warning title=Known issue::${msg(k)}`);
  console.log(`::notice title=Browser checks::${passed} passed, ${failed} failed${flaky ? `, ${flaky} passed on a second try` : ''}`);
}
