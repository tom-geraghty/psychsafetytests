// Opens each key page in a real browser and checks what a visitor would see.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { SITES } from '../sites.mjs';
import { watch, readThrough, pageHasErrorText, inPage, skipThirdParty } from './helpers.mjs';

const THIRD_PARTY_NOISE = /grecaptcha|Stripe is not defined|mc4wp|gtag|chimpstatic/i;

for (const [key, site] of Object.entries(SITES)) {
  test.describe(site.name, () => {
    test.beforeEach(({}, testInfo) => {
      test.skip(testInfo.project.metadata.site !== key, 'other site');
    });

    for (const pg of site.browserPages) {
      test(`${pg.name} page (${pg.path})`, async ({ page, baseURL }, testInfo) => {
        const mobile = testInfo.project.metadata.kind === 'mobile';
        const origin = new URL(baseURL).origin;
        let problems = watch(page, baseURL);

        const res = await page.goto(pg.path, { waitUntil: 'load' });
        expect(res?.status(), 'page should load (HTTP 200)').toBe(200);
        await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

        expect(await pageHasErrorText(page), 'no WordPress/PHP error text on the page').toEqual([]);

        // Header: exactly one, with the logo. Two logos at the top usually means
        // two headers (e.g. the old theme's and Elementor's both showing).
        if (site.headerLinks.length) {
          const logos = await page.evaluate(inPage.topLogos);
          expect(logos.length, `exactly one logo at the top of the page (found: ${logos.join(', ') || 'none'})`).toBe(1);

          if (!mobile) {
            const top = await page.evaluate(inPage.linksBetween, [0, 250]);
            for (const want of site.headerLinks) {
              expect(top.some(t => t.includes(want)), `"${want}" link in the header`).toBe(true);
            }
          } else {
            // On phones the menu is behind an icon: find it, open it, look for the links.
            const opened = await openMobileMenu(page, site.headerLinks[0]);
            if (!opened && pg.knownIssues?.includes('mobile-menu')) {
              testInfo.annotations.push({ type: 'known issue', description: 'no menu button on phones (listed in sites.mjs)' });
            } else {
              expect(opened, `mobile menu opens and shows "${site.headerLinks[0]}"`).toBe(true);
              if (pg.knownIssues?.includes('mobile-menu')) testInfo.annotations.push({ type: 'known issue fixed?', description: 'the mobile menu works now: remove "mobile-menu" from knownIssues in sites.mjs' });
            }
            await page.goto(pg.path, { waitUntil: 'load' });
          }
        }

        // Read the page top to bottom, as a visitor would.
        await readThrough(page);

        let stuck = await page.evaluate(inPage.stuckInvisible);
        if (stuck.length) {
          // Some effects only fire when you scroll slowly. Give them a fair chance before complaining.
          await readThrough(page, { slow: true });
          stuck = await page.evaluate(inPage.stuckInvisible);
        }
        expect(stuck, 'no content stuck invisible after scrolling past it (e.g. fade-in animations not firing)').toEqual([]);

        const broken = await page.evaluate(inPage.brokenImages, origin);
        expect(broken, 'no broken images').toEqual([]);

        if (site.footerLinks.length) {
          const bottom = await page.evaluate(inPage.linksBetween, [-1600, 0]);
          for (const want of site.footerLinks) {
            expect(bottom.some(t => t.includes(want)), `"${want}" link in the footer`).toBe(true);
          }
        }

        if (site.font) {
          const loaded = await page.evaluate(f => document.fonts.check(`16px "${f}"`), site.font);
          expect(loaded, `${site.font} font loaded`).toBe(true);
          expect(await page.evaluate(inPage.fontInUse), `body text uses ${site.font}`).toContain(site.font);
        }

        const words = await page.evaluate(inPage.wordCount);
        expect(words, 'page has real content').toBeGreaterThan(pg.article ? 800 : 120);
        if (pg.article) await expect(page.locator('h1').first(), 'article has a title').toBeVisible();

        // Back-to-top button: appears once you've scrolled, and works.
        if (site.headerLinks.length) {
          await page.evaluate(() => window.scrollTo(0, 2500));
          await page.waitForTimeout(800);
          const handle = await page.evaluateHandle(() => [...document.querySelectorAll('a, button, div, span')].find(e => {
            const cs = getComputedStyle(e); const r = e.getBoundingClientRect();
            const label = `${e.id} ${e.className} ${e.getAttribute('aria-label') || ''} ${e.getAttribute('title') || ''}`;
            return cs.position === 'fixed' && r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.05
              && r.top > window.innerHeight / 2 && /to-?top|back-?to|scroll-?up|go-?up/i.test(label);
          }) || null);
          const btn = handle.asElement();
          expect(btn, 'back-to-top button appears after scrolling').not.toBeNull();
          if (btn) {
            await btn.click();
            await expect.poll(() => page.evaluate(() => window.scrollY), { message: 'back-to-top button scrolls to the top', timeout: 5000 }).toBeLessThan(200);
          }
        }

        if (skipThirdParty) problems = problems.filter(p => !THIRD_PARTY_NOISE.test(p));
        expect(problems, 'no script errors or missing files from our own site').toEqual([]);

        // Keep a full-page picture for the record (and for before/after comparison).
        const dir = path.join('screenshots', testInfo.project.name);
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `${pg.name}.png`);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: file, fullPage: true, animations: 'disabled', scale: 'css' });
        await testInfo.attach(`${pg.name}`, { path: file, contentType: 'image/png' });
      });
    }
  });
}

async function openMobileMenu(page, linkText) {
  const isShown = () => page.evaluate(t => [...document.querySelectorAll('a')].some(a => {
    const r = a.getBoundingClientRect(); const cs = getComputedStyle(a);
    return a.innerText.trim().includes(t) && r.width > 0 && r.height > 0 && r.top >= 0 && r.top < window.innerHeight && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.05;
  }), linkText);
  // Candidates: small clickable things at the top with no text (icon buttons), or labelled as a menu.
  const candidates = await page.evaluateHandle(() => [...document.querySelectorAll('a, button, [role=button]')].filter(e => {
    const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
    const label = `${e.className} ${e.getAttribute('aria-label') || ''}`;
    const href = e.getAttribute('href') || '';
    const navigates = e.tagName === 'A' && href && !href.startsWith('#') && !href.startsWith('javascript');
    return !navigates && r.width > 0 && r.height > 0 && r.top < 150 && cs.visibility !== 'hidden' && cs.display !== 'none'
      && (e.innerText.trim() === '' || /menu|nav|burger/i.test(label));
  }));
  const n = await candidates.evaluate(a => a.length);
  for (let i = 0; i < n; i++) {
    const el = await candidates.evaluateHandle((a, j) => a[j], i);
    try { await el.asElement().click({ timeout: 3000 }); } catch { continue; }
    await page.waitForTimeout(700);
    if (await isShown()) return true;
  }
  return false;
}
