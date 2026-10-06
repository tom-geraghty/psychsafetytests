// What we check, per site. Edit this file when pages move or new journeys matter.
//
// Every URL is a path relative to the site's base URL, so the same checks can
// run against live or against a dev/staging copy (set SITE_URL_<KEY> to point
// a site somewhere else, e.g. SITE_URL_PSYCHSAFETY=https://dev.psychsafety.com).

// Text that should never appear on a working page. Most of these are what
// WordPress, PHP or the host show when something has broken.
export const ERROR_PATTERNS = [
  { re: /There has been a critical error on (this|your) website/i, why: 'WordPress critical error page' },
  { re: /Error establishing a database connection/i, why: 'database connection error' },
  { re: /Briefly unavailable for scheduled maintenance/i, why: 'site stuck in maintenance mode (usually a failed update)' },
  { re: /<b>(Fatal|Parse) error<\/b>:|PHP (Fatal|Parse) error:|Fatal error: (Uncaught|Cannot redeclare|Call to undefined)/i, why: 'PHP fatal error shown on the page' },
  { re: /<b>(Warning|Notice|Deprecated)<\/b>:\s.{0,400}? on line <b>\d+/i, why: 'PHP warning printed into the page' },
  { re: /Allowed memory size of \d+ bytes exhausted/i, why: 'PHP ran out of memory' },
  { re: /<(title|h1)[^>]*>[^<]*(500 Internal Server Error|502 Bad Gateway|503 Service (Temporarily )?Unavailable|504 Gateway Time-?out)/i, why: 'server or gateway error page' },
  { re: /The site is experiencing technical difficulties/i, why: 'WordPress recovery-mode message' },
];

// Text that shows a dev or staging copy has leaked into live.
export const LEAK_PATTERNS = [
  { re: /dev\.psychsafety\.com|staging\.psychsafety\.com|stage\.psychsafety\.co\.uk/i, why: 'link or setting pointing at the dev/staging site' },
  { re: /lorem ipsum/i, why: 'placeholder text (lorem ipsum)' },
];

export const SITES = {
  psychsafety: {
    name: 'psychsafety.com',
    base: 'https://psychsafety.com',
    // Text every normal page should contain (header/footer furniture).
    everyPageHas: ['Psych Safety', 'Iterum Ltd'],
    // Checked on every run (hourly). Keep this list short: these are the pages
    // that matter most if the site falls over.
    smoke: [
      { path: '/', has: ['Organisational Training', 'Online Workshops'] },
      { path: '/blog/' },
      { path: '/measure-psychological-safety/', has: ['How to Measure Psychological Safety'] },
      { path: '/psychological-safety-training-for-individuals/' },
      { path: '/training/' },
      { path: '/shop/', has: ['Buy Now'] },
      { path: '/tool-kit/' },
      { path: '/newsletter/', has: ['mc4wp-form'] },
      { path: '/contact/', has: ['wpcf7'] },
      { path: '/about/' },
    ],
    // Pages that must stay indexable by search engines.
    mustBeIndexable: ['/', '/blog/', '/measure-psychological-safety/', '/training/'],
    // Where to find "Buy Now" buttons; each one is followed to its payment page.
    productListPages: ['/shop/', '/tool-kit/'],
    contactPage: '/contact/',
    search: { term: 'psychological safety' },
    feeds: ['/feed/'],
    sitemap: '/sitemap_index.xml',
    pageSitemap: '/page-sitemap.xml',
    redirects: [
      { from: 'http://psychsafety.com/', to: 'https://psychsafety.com/' },
      { from: 'https://www.psychsafety.com/', to: 'https://psychsafety.com/' },
      { from: 'https://psychsafety.co.uk/', to: 'https://psychsafety.com/' },
      { from: 'https://psychsafety.co.uk/contact/', to: 'https://psychsafety.com/contact/' },
    ],
    // Browser checks (Playwright): pages to open in a real browser.
    browserPages: [
      { path: '/', name: 'home' },
      { path: '/blog/', name: 'articles' },
      { path: '/measure-psychological-safety/', name: 'article', article: true },
      { path: '/psychological-safety-training-for-individuals/', name: 'online-workshops' },
      { path: '/training/', name: 'org-training' },
      // Known issue (found 6 Oct 2026): on phones the Shop page's header has no menu
      // button until you scroll down. Remove the knownIssues line once it's fixed.
      { path: '/shop/', name: 'shop', knownIssues: ['mobile-menu'] },
      { path: '/tool-kit/', name: 'tool-kits' },
      { path: '/newsletter/', name: 'newsletter' },
      { path: '/contact/', name: 'contact' },
      { path: '/about/', name: 'about' },
    ],
    headerLinks: ['Contact'],          // must be in the header on desktop
    footerLinks: ['Privacy Policy', 'Terms of Business'],
    font: 'Jost',
  },

  iterum: {
    name: 'iterum.co.uk',
    base: 'https://iterum.co.uk',
    everyPageHas: ['Iterum'],
    smoke: [
      { path: '/' },
    ],
    mustBeIndexable: ['/'],
    productListPages: [],
    contactPage: null,
    search: null,
    feeds: [],
    sitemap: null,
    pageSitemap: null,
    redirects: [
      { from: 'http://iterum.co.uk/', to: 'https://iterum.co.uk/' },
    ],
    browserPages: [
      // Known issue (found 6 Oct 2026): the home page throws JavaScript errors
      // ("wp is not defined", "tns is not defined"). Usually scripts loading in
      // the wrong order, e.g. a speed plugin delaying them; it can stop a slider
      // working. Remove the knownIssues line once it's fixed.
      { path: '/', name: 'home', knownIssues: ['script-errors'] },
    ],
    headerLinks: [],
    footerLinks: [],
    font: null,
  },
};

// Lets a run point a site at a different copy, e.g. dev.
export function siteBase(key) {
  const override = process.env[`SITE_URL_${key.toUpperCase()}`];
  return (override || SITES[key].base).replace(/\/$/, '');
}

export function isLive(key) {
  return siteBase(key) === SITES[key].base.replace(/\/$/, '');
}
