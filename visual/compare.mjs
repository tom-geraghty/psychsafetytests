#!/usr/bin/env node
// Compare two sets of page pictures and make a report you can open in a browser.
//
//   npm run compare                      # snapshots/before vs snapshots/after
//   npm run compare -- before after 2    # flag pages where more than 2% changed
//
// Pages whose content changes on its own (latest articles, for example) will
// always show some difference. The report ranks pages by how much changed so
// you can look at the big ones first.
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const [a = 'before', b = 'after', thresholdArg = '2'] = process.argv.slice(2);
const threshold = Number(thresholdArg);
const dirA = path.join('snapshots', a);
const dirB = path.join('snapshots', b);
const out = path.join('snapshots', `compare-${a}-vs-${b}`);
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const list = dir => fs.existsSync(dir)
  ? fs.readdirSync(dir, { recursive: true }).map(String).filter(f => f.endsWith('.png'))
  : [];
const files = [...new Set([...list(dirA), ...list(dirB)])].sort();
if (!files.length) {
  console.error(`No pictures found in ${dirA} or ${dirB}. Run "npm run capture -- ${a}" first.`);
  process.exit(2);
}

// Put a picture on a white canvas of the given size so two different-height pages can be compared.
function pad(img, width, height) {
  if (img.width === width && img.height === height) return img;
  const p = new PNG({ width, height });
  p.data.fill(255);
  PNG.bitblt(img, p, 0, 0, Math.min(img.width, width), Math.min(img.height, height), 0, 0);
  return p;
}

const rows = [];
for (const f of files) {
  const pa = path.join(dirA, f);
  const pb = path.join(dirB, f);
  const id = f.replace(/[\\/]/g, '__').replace(/\.png$/, '');
  if (!fs.existsSync(pa) || !fs.existsSync(pb)) {
    rows.push({ f, id, missing: !fs.existsSync(pa) ? a : b, pct: 100 });
    continue;
  }
  const A = PNG.sync.read(fs.readFileSync(pa));
  const B = PNG.sync.read(fs.readFileSync(pb));
  const w = Math.max(A.width, B.width);
  const h = Math.max(A.height, B.height);
  const diff = new PNG({ width: w, height: h });
  const changed = pixelmatch(pad(A, w, h).data, pad(B, w, h).data, diff.data, w, h, { threshold: 0.15, includeAA: false });
  const pct = (changed / (w * h)) * 100;
  fs.copyFileSync(pa, path.join(out, `${id}.a.png`));
  fs.copyFileSync(pb, path.join(out, `${id}.b.png`));
  fs.writeFileSync(path.join(out, `${id}.diff.png`), PNG.sync.write(diff));
  rows.push({ f, id, pct, hA: A.height, hB: B.height });
}

rows.sort((x, y) => y.pct - x.pct);
const flagged = rows.filter(r => r.pct > threshold);

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Before and after: ${esc(a)} vs ${esc(b)}</title>
<style>
  body{font:15px/1.5 Jost,system-ui,sans-serif;margin:24px;color:#0A0A0A;background:#fff}
  h1{font-weight:700;margin:0 0 4px} .muted{color:#6B6B6B}
  table{border-collapse:collapse;margin:16px 0} td,th{padding:6px 10px;border-bottom:1px solid #E6E6E6;text-align:left}
  .flag{color:#B3261E;font-weight:600} .ok{color:#00897A}
  section{margin:40px 0;border-top:3px solid #0A0A0A;padding-top:12px}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;align-items:start}
  .grid img{width:100%;border:1px solid #E6E6E6}
  @media (max-width:800px){.grid{grid-template-columns:1fr}}
</style>
<h1>Before and after</h1>
<p class="muted">${esc(a)} vs ${esc(b)} · ${rows.length} pictures · ${flagged.length} changed by more than ${threshold}% · made ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC</p>
<p>Red in the third picture shows what changed. Pages with live content (latest articles) always change a little; look at the top of the list first.</p>
<table><tr><th>Page</th><th>Changed</th><th>Height</th></tr>
${rows.map(r => `<tr><td><a href="#${r.id}">${esc(r.f)}</a></td><td class="${r.pct > threshold ? 'flag' : 'ok'}">${r.missing ? `missing in ${esc(r.missing)}` : r.pct.toFixed(2) + '%'}</td><td>${r.missing ? '' : r.hA === r.hB ? `${r.hA}px` : `${r.hA}px → ${r.hB}px`}</td></tr>`).join('\n')}
</table>
${rows.filter(r => !r.missing).map(r => `<section id="${r.id}"><h2>${esc(r.f)} <span class="${r.pct > threshold ? 'flag' : 'ok'}">${r.pct.toFixed(2)}%</span></h2>
<div class="grid"><figure><figcaption>${esc(a)}</figcaption><img loading="lazy" src="${r.id}.a.png"></figure><figure><figcaption>${esc(b)}</figcaption><img loading="lazy" src="${r.id}.b.png"></figure><figure><figcaption>what changed</figcaption><img loading="lazy" src="${r.id}.diff.png"></figure></div></section>`).join('\n')}
`;
fs.writeFileSync(path.join(out, 'index.html'), html);

for (const r of rows) console.log(`${r.pct > threshold ? 'CHANGED' : 'same   '} ${r.missing ? `missing in ${r.missing}` : r.pct.toFixed(2).padStart(6) + '%'}  ${r.f}`);
console.log(`\nReport: ${path.join(out, 'index.html')}`);
const md = [`## Before and after (${a} vs ${b})`, '', `${flagged.length} of ${rows.length} pictures changed by more than ${threshold}%.`, '',
  ...rows.slice(0, 20).map(r => `- ${r.pct > threshold ? '🔶' : '▫️'} \`${r.f}\` ${r.missing ? `missing in ${r.missing}` : r.pct.toFixed(2) + '%'}`)].join('\n');
fs.writeFileSync(path.join(out, 'summary.md'), md);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
