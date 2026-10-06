// Do the checks spot real failures, and stay quiet on normal pages?
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectPage, findErrors, isNoindex, robotsBlocksEverything, findCf7Form, findPaymentLinks } from '../checks/inspect.mjs';

const page = (text, status = 200, ct = 'text/html; charset=UTF-8') => ({ ok: true, status, text, headers: new Headers({ 'content-type': ct }) });
const normal = '<html><head><title>Psych Safety</title></head><body>' + 'Psych Safety words '.repeat(600) + ' Iterum Ltd</body></html>';

test('a normal page passes', () => {
  assert.deepEqual(inspectPage(page(normal), { mustHave: ['Psych Safety', 'Iterum Ltd'] }), []);
});

test('WordPress critical error page is caught', () => {
  const html = '<html><body><p>There has been a critical error on this website.</p><a href="https://wordpress.org/documentation/article/faq-troubleshooting/">Learn more</a></body></html>';
  const p = inspectPage(page(html, 500));
  assert.ok(p.some(x => x.includes('HTTP 500')));
  assert.ok(p.some(x => x.includes('critical error')));
  assert.ok(p.some(x => x.includes('suspiciously small')));
});

test('stuck maintenance mode is caught (a failed update leaves this behind)', () => {
  assert.deepEqual(findErrors('<h1>Briefly unavailable for scheduled maintenance. Check back in a minute.</h1>'), ['site stuck in maintenance mode (usually a failed update)']);
});

test('database down is caught', () => {
  assert.ok(findErrors('<h1>Error establishing a database connection</h1>').length === 1);
});

test('PHP fatal and warnings printed into the page are caught', () => {
  assert.equal(findErrors('<br />\n<b>Fatal error</b>:  Uncaught Error: Call to undefined function dotlife_foo() in /var/www/x.php:12').length, 1);
  assert.equal(findErrors('<b>Warning</b>:  Undefined array key "x" in <b>/var/www/wp-content/themes/dotlife/functions.php</b> on line <b>42</b>').length, 1);
  assert.equal(findErrors('PHP Fatal error:  Allowed memory size of 268435456 bytes exhausted').length, 2);
});

test('ordinary article text about errors is NOT flagged', () => {
  const prose = '<p>It was a fatal error: the crew missed the warning. A 503 service unavailable message is a gateway error.</p><p>Warning: this is about Tenerife.</p>';
  assert.deepEqual(findErrors(prose), []);
});

test('white screen (tiny or empty page) is caught', () => {
  assert.ok(inspectPage(page('')).some(x => x.includes('suspiciously small')));
});

test('dev site links and lorem ipsum on live are caught, but allowed when checking dev', () => {
  const html = normal + '<a href="https://dev.psychsafety.com/contact/">x</a> Lorem ipsum dolor';
  assert.equal(inspectPage(page(html), { live: true }).length, 2);
  assert.equal(inspectPage(page(html), { live: false }).length, 0);
});

test('noindex is caught in the page and in headers', () => {
  assert.ok(isNoindex("<meta name='robots' content='noindex, nofollow' />", new Headers()));
  assert.ok(isNoindex('<html></html>', new Headers({ 'x-robots-tag': 'noindex' })));
  assert.ok(!isNoindex("<meta name='robots' content='index, follow, max-image-preview:large' />", new Headers()));
});

test('robots.txt blocking the whole site is caught', () => {
  assert.ok(robotsBlocksEverything('User-agent: *\nDisallow: /\n'));
  assert.ok(!robotsBlocksEverything('User-agent: *\nDisallow:\n\nSitemap: https://psychsafety.com/sitemap_index.xml'));
  assert.ok(!robotsBlocksEverything('User-agent: BadBot\nDisallow: /\n\nUser-agent: *\nDisallow: /wp-admin/\n'));
});

test('contact form details and buy links are found', () => {
  const html = '<input type="hidden" name="_wpcf7" value="1697" /><input type="hidden" name="_wpcf7_unit_tag" value="wpcf7-f1697-p1-o1" /><a href="https://psychsafety.com/asp-payment-box/?product_id=1091">Buy</a>';
  assert.equal(findCf7Form(html).id, '1697');
  assert.deepEqual(findPaymentLinks(html, 'https://psychsafety.com'), ['https://psychsafety.com/asp-payment-box/?product_id=1091']);
});
