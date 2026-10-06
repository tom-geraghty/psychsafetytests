// The things people come to the site to do. Nothing here buys anything,
// sends an email or signs anyone up: each journey stops one step short.
import { test, expect } from '@playwright/test';
import { SITES } from '../sites.mjs';
import { skipThirdParty } from './helpers.mjs';

const site = SITES.psychsafety;

test.describe('psychsafety.com journeys', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.metadata.site !== 'psychsafety', 'other site');
  });

  test('search finds articles', async ({ page }) => {
    await page.goto(`/?s=${encodeURIComponent(site.search.term)}`);
    await expect(page.locator('body'), 'results page, not "no results"').toHaveClass(/search-results/);
    // Click the first result that leads to a normal page on the site.
    const first = page.locator('#page_content_wrapper a[href^="/"], main a[href], article a[href], .post_header a[href]').first();
    const href = await first.getAttribute('href');
    expect(href, 'at least one result link').toBeTruthy();
    const res = await page.goto(href);
    expect(res?.status(), 'search result opens').toBe(200);
  });

  test('Buy Now opens a working payment box (no purchase made)', async ({ page }) => {
    await page.goto('/shop/');
    const buy = page.getByRole('link', { name: /buy now/i }).first();
    await expect(buy, 'a Buy Now button on the shop page').toBeVisible();
    await buy.click();
    // The payment box opens in a pop-up over the page (or, on some set-ups, as its own page).
    const popup = page.locator('iframe[src*="asp-payment-box"]').first();
    const box = (await popup.count().then(n => n > 0).catch(() => false)) || await popup.waitFor({ state: 'attached', timeout: 15_000 }).then(() => true).catch(() => false)
      ? page.frameLocator('iframe[src*="asp-payment-box"]').first()
      : page;
    await expect(box.locator('#submit-btn'), 'Pay button shows a price').toContainText(/£\s?\d/, { timeout: 20_000 });
    if (!skipThirdParty) {
      // Stripe's card box is itself an iframe served by Stripe. If it's missing, nobody can pay.
      await expect(box.locator('iframe[src*="js.stripe.com"]').first(), 'Stripe card field loads').toBeAttached({ timeout: 20_000 });
      await expect(box.getByText(/ReferenceError|TypeError|is not defined/), 'no error message in the payment box').toHaveCount(0);
    }
  });

  test('contact form rejects an empty message (nothing is sent)', async ({ page }) => {
    test.skip(skipThirdParty, 'needs Google reCAPTCHA');
    await page.goto(site.contactPage);
    const form = page.locator('form.wpcf7-form').first();
    // The form fades in as you scroll to it, so scroll to it first.
    await form.scrollIntoViewIfNeeded();
    await expect(form, 'contact form on the page').toBeVisible();
    await form.locator('[type=submit]').first().click();
    await expect(page.locator('.wpcf7-not-valid-tip').first(), 'form checks the required fields').toBeVisible({ timeout: 20_000 });
  });

  test('newsletter sign-up form is there (not submitted)', async ({ page }) => {
    await page.goto('/newsletter/');
    const email = page.locator('form.mc4wp-form input[type=email]').first();
    await expect(email, 'email box on the newsletter page').toBeVisible();
    await expect(page.locator('form.mc4wp-form [type=submit]').first(), 'subscribe button').toBeVisible();
  });
});
