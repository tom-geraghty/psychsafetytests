// Pure functions that look at a fetched page and say what's wrong with it.
// Kept separate so they can be tested without touching the network.
import { ERROR_PATTERNS, LEAK_PATTERNS } from '../sites.mjs';

export function findErrors(html) {
  return ERROR_PATTERNS.filter(p => p.re.test(html)).map(p => p.why);
}

export function findLeaks(html) {
  return LEAK_PATTERNS.filter(p => p.re.test(html)).map(p => p.why);
}

export function isNoindex(html, headers) {
  const tag = /<meta[^>]+name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html);
  const header = /noindex/i.test(headers?.get?.('x-robots-tag') || '');
  return tag || header;
}

export function robotsBlocksEverything(txt) {
  // Looks for "User-agent: *" followed (in the same group) by "Disallow: /".
  const groups = txt.split(/\n(?=\s*user-agent:)/i);
  return groups.some(g => /user-agent:\s*\*/i.test(g) && /^\s*disallow:\s*\/\s*$/im.test(g));
}

// Inspect one HTML page. Returns a list of problems (empty = fine).
export function inspectPage(r, { minBytes = 5000, mustHave = [], live = true } = {}) {
  const problems = [];
  if (!r.ok) return [`no response (${r.error})`];
  if (r.status !== 200) problems.push(`HTTP ${r.status}`);
  const ct = r.headers.get('content-type') || '';
  if (!ct.includes('text/html')) problems.push(`unexpected content type "${ct}"`);
  if (r.text.length < minBytes) problems.push(`page is suspiciously small (${r.text.length} bytes): possible white screen`);
  for (const e of findErrors(r.text)) problems.push(e);
  if (live) for (const l of findLeaks(r.text)) problems.push(l);
  for (const m of mustHave) if (!r.text.includes(m)) problems.push(`missing expected text "${m}"`);
  return problems;
}

export function extractLinks(html, base) {
  const out = new Set();
  for (const m of html.matchAll(/<a\b[^>]*\bhref=["']([^"'#]+)["']/gi)) {
    try {
      const u = new URL(m[1].replace(/&amp;/g, '&'), base);
      if (u.origin === new URL(base).origin) out.add(u.toString());
    } catch { /* ignore odd hrefs */ }
  }
  return [...out];
}

export function extractSitemapUrls(xml) {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(m => m[1].replace(/&amp;/g, '&'));
}

// Contact Form 7: find the form's hidden fields so we can test it without sending mail.
export function findCf7Form(html) {
  const id = html.match(/name="_wpcf7" value="(\d+)"/)?.[1];
  if (!id) return null;
  const field = n => html.match(new RegExp(`name="${n}" value="([^"]*)"`))?.[1] ?? '';
  return {
    id,
    fields: {
      _wpcf7: id,
      _wpcf7_version: field('_wpcf7_version'),
      _wpcf7_locale: field('_wpcf7_locale'),
      _wpcf7_unit_tag: field('_wpcf7_unit_tag'),
      _wpcf7_container_post: field('_wpcf7_container_post'),
    },
  };
}

export function findPaymentLinks(html, base) {
  const out = new Set();
  for (const m of html.matchAll(/href=["']([^"']*asp-payment-box\/\?product_id=\d+)["']/gi)) {
    out.add(new URL(m[1].replace(/&amp;/g, '&'), base).toString());
  }
  return [...out];
}
