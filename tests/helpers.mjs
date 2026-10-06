import { test } from '@playwright/test';
import { SITES } from '../sites.mjs';
import { findErrors } from '../checks/inspect.mjs';

export function currentSite() {
  const { site, kind } = test.info().project.metadata;
  return { key: site, kind, site: SITES[site] };
}

// Third-party services (Stripe, Google reCAPTCHA, Mailchimp) can't be reached
// from some sandboxes. Set SKIP_THIRD_PARTY=1 there; never set it on GitHub.
export const skipThirdParty = !!process.env.SKIP_THIRD_PARTY;

// Watch for problems while a page loads: our own scripts crashing, and our own
// files (CSS, JS, images) failing to load.
export function watch(page, baseURL) {
  const origin = new URL(baseURL).origin;
  const problems = [];
  page.on('pageerror', err => {
    const where = err.stack || '';
    // Only count errors from our own site's scripts; third-party noise is not ours to fix.
    if (where.includes(origin) || !/https?:\/\//.test(where)) problems.push(`script error: ${err.message.slice(0, 200)}`);
  });
  page.on('response', res => {
    const u = res.url();
    if (u.startsWith(origin) && res.status() >= 400 && res.request().resourceType() !== 'document') {
      if (!/\.map$|favicon/i.test(u)) problems.push(`failed to load ${res.request().resourceType()} ${u.replace(origin, '')} (HTTP ${res.status()})`);
    }
  });
  return problems;
}

// Scroll down the page in steps, like a reader would, so lazy images load and
// scroll-triggered animations fire. Then go back to the top.
export async function readThrough(page, { slow = false } = {}) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const vh = page.viewportSize()?.height || 800;
  const step = Math.floor(vh * (slow ? 0.35 : 0.6));
  const pause = slow ? 500 : 200;
  for (let y = 0; y < height; y += step) {
    await page.evaluate(yy => window.scrollTo(0, yy), y);
    await page.waitForTimeout(pause);
  }
  await page.waitForTimeout(slow ? 2500 : 1000);
}

export async function pageHasErrorText(page) {
  return findErrors(await page.content());
}

// Everything below runs inside the page.
export const inPage = {
  // Logos visible near the top of the page. Two means two headers.
  topLogos: () => {
    const vis = e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity) > 0.05; };
    // An <img> whose file name, alt text or class says "logo", or an inline <svg> labelled as a logo.
    return [...document.querySelectorAll('img, svg')]
      .filter(e => /logo/i.test(`${e.getAttribute('src') || ''} ${e.getAttribute('alt') || ''} ${e.getAttribute('class') || ''} ${e.getAttribute('aria-label') || ''}`))
      .filter(e => vis(e) && e.getBoundingClientRect().top + window.scrollY < 250 && e.getBoundingClientRect().top >= 0)
      .map(e => e.getAttribute('src') || 'svg');
  },
  // Visible link texts in a horizontal band of the page.
  linksBetween: ([fromY, toY]) => {
    const vis = e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity) > 0.05; };
    const H = document.documentElement.scrollHeight;
    const lo = fromY < 0 ? H + fromY : fromY;
    const hi = toY <= 0 ? H + toY : toY;
    return [...document.querySelectorAll('a')].filter(a => {
      const top = a.getBoundingClientRect().top + window.scrollY;
      return vis(a) && top >= lo && top <= hi;
    }).map(a => a.innerText.trim()).filter(Boolean);
  },
  // Text that is still invisible after the reader has scrolled past it.
  stuckInvisible: () => {
    const out = [];
    const inChrome = e => e.closest('header, footer, nav, [role=dialog], [aria-hidden="true"], [data-elementor-post-type="header"], [data-elementor-post-type="footer"], [data-elementor-post-type="popup"], .sub-menu, [class*="mobile_menu"], [class*="popup"], [class*="modal"], .mc4wp-form, .elementor-tab-content, .elementor-toggle, [class*="accordion"], [class*="slick"], [class*="swiper"], [class*="carousel"]');
    for (const e of document.querySelectorAll('.elementor-invisible')) {
      if (!inChrome(e) && e.innerText.trim().length > 10) out.push(e.innerText.trim().slice(0, 60));
    }
    for (const e of document.querySelectorAll('main p, main h1, main h2, main h3, article p, article h1, article h2, [data-elementor-post-type="page"] p, [data-elementor-post-type="page"] h1, [data-elementor-post-type="page"] h2, [data-elementor-post-type="page"] h3')) {
      if (inChrome(e) || e.innerText.trim().length < 15) continue;
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      let n = e, hidden = false;
      while (n && n !== document.body) { const cs = getComputedStyle(n); if (parseFloat(cs.opacity) < 0.05 || cs.visibility === 'hidden') { hidden = true; break; } n = n.parentElement; }
      if (hidden) out.push(e.innerText.trim().slice(0, 60));
    }
    return [...new Set(out)];
  },
  brokenImages: origin => [...document.images]
    .filter(i => i.complete && i.naturalWidth === 0 && i.currentSrc.startsWith(origin) && i.getBoundingClientRect().width > 0)
    .map(i => i.currentSrc.replace(origin, '')),
  wordCount: () => document.body.innerText.split(/\s+/).filter(Boolean).length,
  fontInUse: () => {
    const p = [...document.querySelectorAll('p')].find(e => e.innerText.trim().length > 40 && e.getBoundingClientRect().width > 0);
    return p ? getComputedStyle(p).fontFamily : getComputedStyle(document.body).fontFamily;
  },
};
