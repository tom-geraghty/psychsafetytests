#!/usr/bin/env node
// Fast checks that don't need a browser.
//
//   node checks/run.mjs --mode smoke   # every hour: is anything on fire?
//   node checks/run.mjs --mode full    # daily / before and after updates: every page, every product, redirects
//   add --site psychsafety (or iterum) to check one site only
//
// Exit code is 1 if any check fails, so a scheduler can raise the alarm.
import tls from 'node:tls';
import fs from 'node:fs';
import path from 'node:path';
import { SITES, siteBase, isLive } from '../sites.mjs';
import { get, traceRedirects, pool } from './http.mjs';
import {
  findErrors as findErrorsQuick, inspectPage, isNoindex, robotsBlocksEverything, extractLinks,
  extractSitemapUrls, findCf7Form, findPaymentLinks,
} from './inspect.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const MODE = opt('mode', 'smoke');
const ONLY = opt('site', null);
const OUT_DIR = opt('out', 'results');

const results = [];
const record = (site, check, target, status, detail = '') => results.push({ site, check, target, status, detail });
const pass = (s, c, t, d) => record(s, c, t, 'pass', d);
const fail = (s, c, t, d) => record(s, c, t, 'fail', d);
const warn = (s, c, t, d) => record(s, c, t, 'warn', d);

const bust = url => url + (url.includes('?') ? '&' : '?') + 'sitecheck=' + Date.now();

async function checkPages(key, site, base, live) {
  // Cache-busted, so we see what PHP produces right now rather than an old cached copy.
  await pool(site.smoke, 3, async page => {
    const url = base + page.path;
    const r = await get(bust(url), { siteKey: key });
    const problems = inspectPage(r, { mustHave: [...site.everyPageHas, ...(page.has || [])], live });
    if (problems.length) fail(key, 'page works', page.path, problems.join('; '));
    else if (r.ms > 8000) warn(key, 'page works', page.path, `slow: ${(r.ms / 1000).toFixed(1)}s`);
    else pass(key, 'page works', page.path, `${(r.ms / 1000).toFixed(1)}s`);
  });
}

async function checkIndexable(key, site, base) {
  for (const p of site.mustBeIndexable) {
    const r = await get(base + p, { siteKey: key });
    if (!r.ok || r.status !== 200) continue; // already reported by the page check
    if (isNoindex(r.text, r.headers)) fail(key, 'visible to search engines', p, 'page is set to noindex (often a dev setting copied to live)');
    else pass(key, 'visible to search engines', p);
  }
  const robots = await get(base + '/robots.txt', { siteKey: key });
  if (!robots.ok || robots.status !== 200) warn(key, 'visible to search engines', '/robots.txt', `HTTP ${robots.status || robots.error}`);
  else if (robotsBlocksEverything(robots.text)) fail(key, 'visible to search engines', '/robots.txt', 'robots.txt blocks the whole site');
  else pass(key, 'visible to search engines', '/robots.txt');
}

async function checkWordPressApi(key, base) {
  const r = await get(bust(base + '/wp-json/'), { siteKey: key });
  let name = null;
  try { name = JSON.parse(r.text).name; } catch { /* not JSON */ }
  if (r.status === 200 && name) pass(key, 'WordPress API', '/wp-json/', name);
  else fail(key, 'WordPress API', '/wp-json/', r.ok ? `HTTP ${r.status}, ${name ? '' : 'not valid JSON'}` : r.error);
}

async function checkContactForm(key, site, base) {
  if (!site.contactPage) return;
  const page = await get(base + site.contactPage, { siteKey: key });
  const form = findCf7Form(page.text);
  if (!form) return fail(key, 'contact form', site.contactPage, 'no Contact Form 7 form found on the page');
  // Submit it EMPTY: the plugin should reject it as incomplete. This proves the
  // form handler is alive without sending anyone an email.
  const body = new FormData();
  for (const [k, v] of Object.entries(form.fields)) body.append(k, v);
  const r = await get(`${base}/wp-json/contact-form-7/v1/contact-forms/${form.id}/feedback`, { siteKey: key, method: 'POST', body });
  let status = null;
  try { status = JSON.parse(r.text).status; } catch { /* not JSON */ }
  if (status === 'validation_failed') pass(key, 'contact form', site.contactPage, 'form handler responds (tested with an empty form, nothing sent)');
  else if (status === 'mail_sent') fail(key, 'contact form', site.contactPage, 'UNEXPECTED: an empty form was accepted and sent');
  else fail(key, 'contact form', site.contactPage, `form handler not responding properly (HTTP ${r.status}${status ? `, status ${status}` : ''}${r.error ? `, ${r.error}` : ''})`);
}

async function checkSearch(key, site, base) {
  if (!site.search) return;
  const target = `/?s=${encodeURIComponent(site.search.term)}`;
  const r = await get(base + target, { siteKey: key });
  if (r.status !== 200) return fail(key, 'site search', target, `HTTP ${r.status || r.error}`);
  if (/class="[^"]*\bsearch-no-results\b/.test(r.text)) return fail(key, 'site search', target, 'search returned no results');
  if (!/class="[^"]*\bsearch-results\b/.test(r.text)) return warn(key, 'site search', target, 'could not confirm the results page');
  pass(key, 'site search', target);
}

async function checkFeeds(key, site, base) {
  for (const f of site.feeds) {
    const r = await get(base + f, { siteKey: key });
    if (r.status === 200 && /<rss|<feed/.test(r.text) && /<item>|<entry>/.test(r.text)) pass(key, 'RSS feed', f);
    else fail(key, 'RSS feed', f, r.ok ? `HTTP ${r.status}, no items` : r.error);
  }
}

async function checkPayments(key, site, base, all) {
  if (!site.productListPages.length) return;
  const links = new Set();
  for (const p of site.productListPages) {
    const r = await get(base + p, { siteKey: key });
    for (const l of findPaymentLinks(r.text, base)) links.add(l);
  }
  if (!links.size) return fail(key, 'buy buttons', site.productListPages.join(', '), 'no Buy Now links found');
  const targets = all ? [...links] : [...links].slice(0, 1);
  await pool(targets, 2, async url => {
    const short = url.replace(base, '');
    const r = await get(bust(url), { siteKey: key });
    const problems = inspectPage(r, { minBytes: 3000, live: isLive(key) });
    if (!/id="submit-btn"[^>]*>\s*Pay\b/.test(r.text)) problems.push('no Pay button');
    if (!/js\.stripe\.com/.test(r.text)) problems.push('Stripe not loaded');
    const price = r.text.match(/Pay\s+(£[\d.,]+)/)?.[1];
    if (problems.length) fail(key, 'payment page', short, problems.join('; '));
    else pass(key, 'payment page', short, `${r.text.match(/<title>(.*?)<\/title>/)?.[1] || ''} ${price || ''}`.trim());
  });
  if (!all) pass(key, 'buy buttons', site.productListPages.join(', '), `${links.size} Buy Now links found`);
}

async function checkRedirects(key, site) {
  for (const { from, to } of site.redirects) {
    const { hops, final } = await traceRedirects(from, { siteKey: key });
    const chain = hops.map(h => `${h.status || h.error}`).join(' → ');
    const landed = final.url;
    if (final.error) { fail(key, 'redirect', from, `no response (${final.error})`); continue; }
    if (landed !== to || final.status !== 200) { fail(key, 'redirect', from, `ends at ${landed} (${chain}), expected ${to}`); continue; }
    const temp = hops.slice(0, -1).some(h => h.status === 302 || h.status === 307);
    if (temp) warn(key, 'redirect', from, `works, but uses a temporary redirect (${chain}); search engines prefer 301`);
    else pass(key, 'redirect', from, chain);
  }
}

function certDaysLeft(host) {
  return new Promise(resolve => {
    const s = tls.connect({ host, port: 443, servername: host, timeout: 15000 }, () => {
      const cert = s.getPeerCertificate();
      s.end();
      resolve({ days: Math.floor((new Date(cert.valid_to) - Date.now()) / 86400000), to: cert.valid_to });
    });
    s.on('error', e => resolve({ error: e.message }));
    s.on('timeout', () => { s.destroy(); resolve({ error: 'timeout' }); });
  });
}

async function checkCertificate(key, base) {
  if (process.env.SKIP_TLS_CHECK) return;
  const host = new URL(base).hostname;
  const c = await certDaysLeft(host);
  if (c.error) return warn(key, 'security certificate', host, `couldn't check (${c.error})`);
  if (c.days < 10) fail(key, 'security certificate', host, `expires in ${c.days} days (${c.to})`);
  else if (c.days < 21) warn(key, 'security certificate', host, `expires in ${c.days} days; it should renew automatically`);
  else pass(key, 'security certificate', host, `${c.days} days left`);
}

async function crawl(key, site, base, live) {
  // Every page and post in the sitemaps, plus every internal link in the
  // header/footer. Normal (cached) requests, four at a time.
  const urls = new Set();
  const home = await get(base + '/', { siteKey: key });
  for (const l of extractLinks(home.text, base)) urls.add(l.split('?')[0]);
  for (const sm of [site.pageSitemap, site.pageSitemap?.replace('page-', 'post-')].filter(Boolean)) {
    const r = await get(base + sm, { siteKey: key });
    for (const u of extractSitemapUrls(r.text)) urls.add(u.replace(SITES[key].base, base));
  }
  const list = [...urls].filter(u => !/\/(wp-admin|wp-login|feed)\b|\.(pdf|jpe?g|png|zip|docx?|xlsx?|pptx?)$/i.test(u));
  let bad = 0;
  let offsite = 0;
  let throttled = 0;
  // One page at a time with a pause in between, so the site's firewall
  // (Wordfence) doesn't mistake us for an aggressive crawler.
  const pause = Number(process.env.CRAWL_DELAY_MS || 1000);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const firewall = t => /wordfence|access to this site has been (temporarily )?limited|too many requests/i.test(t);
  for (const url of list) {
    const short = url.replace(base, '') || '/';
    // Follow redirects ourselves: ones that leave the site (e.g. to the course
    // platform or Measure) are fine and aren't ours to check here.
    let current = url;
    let r;
    let left = false;
    for (let hop = 0; hop < 5; hop++) {
      r = await get(current, { siteKey: key, timeoutMs: 45000, redirect: 'manual' });
      if ((r.status === 429 || r.status === 503) && !findErrorsQuick(r.text).length) {
        // Slowed down by the firewall or a busy server: wait, then try once more.
        await sleep(30000);
        r = await get(current, { siteKey: key, timeoutMs: 45000, redirect: 'manual' });
      }
      const loc = r.headers.get('location');
      if (!(r.status >= 300 && r.status < 400 && loc)) break;
      const nextUrl = new URL(loc, current);
      if (nextUrl.origin !== new URL(base).origin) { offsite++; left = true; break; }
      current = nextUrl.toString();
    }
    await sleep(pause);
    if (left) continue;
    if ((r.status === 429 || r.status === 503) && firewall(r.text)) { throttled++; continue; }
    const ct = r.headers.get('content-type') || '';
    if (r.ok && r.status === 200 && !ct.includes('text/html')) continue; // a PDF or similar: it loads, that's enough
    const problems = inspectPage(r, { minBytes: 5000, live });
    if (problems.length) { bad++; fail(key, 'every page', short, problems.join('; ')); }
  }
  if (throttled) warn(key, 'every page', `${throttled} pages`, "skipped: the site's firewall asked us to slow down (not a problem with the site)");
  if (!bad) pass(key, 'every page', `${list.length - throttled} pages`, `all load without errors${offsite ? ` (${offsite} redirect to other sites)` : ''}`);
}

async function runSite(key) {
  const site = SITES[key];
  const base = siteBase(key);
  const live = isLive(key);
  console.log(`\n▶ ${site.name} (${base}) — ${MODE}`);
  await checkPages(key, site, base, live);
  if (live) await checkIndexable(key, site, base);
  await checkWordPressApi(key, base);
  await checkContactForm(key, site, base);
  await checkSearch(key, site, base);
  await checkFeeds(key, site, base);
  await checkPayments(key, site, base, MODE === 'full');
  await checkCertificate(key, base);
  if (MODE === 'full') {
    if (live) await checkRedirects(key, site);
    await crawl(key, site, base, live);
  }
}

function summarise() {
  const icon = { pass: '✅', warn: '⚠️', fail: '❌' };
  const counts = { pass: 0, warn: 0, fail: 0 };
  for (const r of results) counts[r.status]++;
  const lines = [];
  lines.push(`## Site checks (${MODE}) — ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC`);
  lines.push('');
  lines.push(`${counts.fail ? '❌' : '✅'} ${counts.pass} passed, ${counts.warn} warnings, ${counts.fail} failed`);
  const shown = results.filter(r => r.status !== 'pass').sort((a, b) => (a.status === 'fail' ? 0 : 1) - (b.status === 'fail' ? 0 : 1));
  const MAX = 40;
  if (shown.length) {
    lines.push('', '| | Site | Check | Where | Detail |', '|---|---|---|---|---|');
    for (const r of shown.slice(0, MAX)) lines.push(`| ${icon[r.status]} | ${SITES[r.site].name} | ${r.check} | \`${r.target}\` | ${r.detail.replace(/\|/g, '\\|')} |`);
    if (shown.length > MAX) lines.push('', `…and ${shown.length - MAX} more (see results/${MODE}.json in the run's files).`);
  }
  lines.push('', '<details><summary>Everything that passed</summary>', '');
  for (const r of results.filter(r => r.status === 'pass')) lines.push(`- ${SITES[r.site].name}: ${r.check} \`${r.target}\` ${r.detail}`);
  lines.push('', '</details>');
  return { md: lines.join('\n'), counts };
}

const keys = ONLY ? [ONLY] : Object.keys(SITES);
for (const k of keys) {
  if (!SITES[k]) { console.error(`Unknown site "${k}". Options: ${Object.keys(SITES).join(', ')}`); process.exit(2); }
  await runSite(k);
}

const { md, counts } = summarise();
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, `${MODE}.json`), JSON.stringify({ mode: MODE, at: new Date().toISOString(), results }, null, 2));
fs.writeFileSync(path.join(OUT_DIR, `${MODE}.md`), md);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');

for (const r of results) {
  if (r.status !== 'pass' || process.env.VERBOSE) console.log(`${r.status.toUpperCase().padEnd(4)} ${SITES[r.site].name} | ${r.check} | ${r.target} | ${r.detail}`);
}
console.log(`\n${counts.pass} passed, ${counts.warn} warnings, ${counts.fail} failed`);
if (process.env.GITHUB_ACTIONS) {
  // Show problems on the run's page in GitHub (and keep them readable via the API).
  const clean = t => String(t).replace(/\r?\n/g, ' ').replace(/::/g, ': ');
  for (const r of results.filter(x => x.status !== 'pass')) {
    console.log(`::${r.status === 'fail' ? 'error' : 'warning'} title=${clean(`${SITES[r.site].name}: ${r.check}`)}::${clean(`${r.target} ${r.detail}`)}`);
  }
  console.log(`::notice title=${MODE} checks::${counts.pass} passed, ${counts.warn} warnings, ${counts.fail} failed`);
}
process.exit(counts.fail ? 1 : 0);
