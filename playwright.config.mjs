// Browser checks: real Chrome, desktop and phone sizes, both sites.
//   npx playwright test                       # everything
//   npx playwright test --project=psychsafety-desktop
//   SITE_URL_PSYCHSAFETY=https://dev.psychsafety.com SITE_AUTH_PSYCHSAFETY=user:pass npx playwright test
import { defineConfig, devices } from '@playwright/test';
import { siteBase } from './sites.mjs';

const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const creds = key => {
  const c = process.env[`SITE_AUTH_${key.toUpperCase()}`];
  if (!c) return undefined;
  const [username, ...rest] = c.split(':');
  return { username, password: rest.join(':') };
};

const project = (key, kind) => ({
  name: `${key}-${kind}`,
  metadata: { site: key, kind },
  use: {
    ...(kind === 'mobile'
      ? { ...devices['iPhone 13'], defaultBrowserType: 'chromium' }
      : { viewport: { width: 1366, height: 900 } }),
    baseURL: siteBase(key),
    httpCredentials: creds(key),
  },
});

export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'results/browser.json' }],
  ],
  use: {
    locale: 'en-GB',
    timezoneId: 'Europe/London',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...(proxy ? { proxy: { server: proxy } } : {}),
  },
  projects: [
    project('psychsafety', 'desktop'),
    project('psychsafety', 'mobile'),
    project('iterum', 'desktop'),
    project('iterum', 'mobile'),
  ],
});
