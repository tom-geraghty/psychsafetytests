// End to end: point the quick check at a fake, broken copy of the site and
// make sure they fail loudly (and pass on a healthy copy).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { SITES } from '../sites.mjs';

const site = SITES.psychsafety;
const filler = 'Psych Safety Organisational Training Online Workshops Buy Now mc4wp-form wpcf7 How to Measure Psychological Safety '.repeat(200);
const healthyPage = path => `<!doctype html><html><head><title>Psych Safety</title><meta name='robots' content='index, follow' /></head><body class="${path.startsWith('/?s=') ? 'search search-results' : ''}">
  <input type="hidden" name="_wpcf7" value="1" /><input type="hidden" name="_wpcf7_unit_tag" value="wpcf7-f1-p1-o1" />
  <a href="/asp-payment-box/?product_id=1">Buy Now</a> ${filler} Iterum Ltd</body></html>`;
const paymentPage = `<html><head><title>Tool Kit</title><script src="https://js.stripe.com/v3/"></script></head><body>${'x'.repeat(4000)}<button type="submit" id="submit-btn">Pay £24.95</button> Psych Safety Iterum Ltd</body></html>`;

function serve(mode) {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const url = req.url;
      const html = (code, body) => { res.writeHead(code, { 'content-type': 'text/html; charset=UTF-8' }); res.end(body); };
      if (mode === 'critical' && url.startsWith('/contact/')) {
        return html(500, '<html><body><p>There has been a critical error on this website.</p></body></html>');
      }
      if (mode === 'maintenance') return html(503, '<h1>Briefly unavailable for scheduled maintenance. Check back in a minute.</h1>');
      if (url.startsWith('/wp-json/contact-form-7/')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ status: mode === 'formdead' ? 'mail_failed' : 'validation_failed' }));
      }
      if (url.startsWith('/wp-json/')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"name":"Psych Safety"}'); }
      if (url.startsWith('/feed/')) { res.writeHead(200, { 'content-type': 'application/rss+xml' }); return res.end('<rss><channel><item><title>x</title></item></channel></rss>'); }
      if (url.startsWith('/robots.txt')) { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('User-agent: *\nDisallow:\n'); }
      if (url.startsWith('/asp-payment-box/')) return html(200, paymentPage);
      if (mode === 'twoheaders' && url.startsWith('/about/')) return html(200, healthyPage(url).replace('Iterum Ltd', ''));
      return html(200, healthyPage(url));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function runAgainst(mode) {
  const server = await serve(mode);
  const { port } = server.address();
  // Run the real checks in a separate process (async, so this process can keep serving the fake site).
  const child = spawn(process.execPath, ['checks/run.mjs', '--mode', 'smoke', '--site', 'psychsafety', '--out', `results/selftest-${mode}`], {
    env: { ...process.env, SITE_URL_PSYCHSAFETY: `http://127.0.0.1:${port}`, SKIP_TLS_CHECK: '1', NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost', GITHUB_STEP_SUMMARY: '' },
  });
  let out = '';
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { out += d; });
  const code = await new Promise(resolve => child.on('close', resolve));
  server.close();
  return { code, out };
}

test('healthy copy passes', async () => {
  const { code, out } = await runAgainst('healthy');
  assert.equal(code, 0, out);
});

test('critical error on one page fails the run', async () => {
  const { code, out } = await runAgainst('critical');
  assert.equal(code, 1);
  assert.match(out, /FAIL .*\/contact\/.*critical error/);
});

test('site stuck in maintenance mode fails the run', async () => {
  const { code, out } = await runAgainst('maintenance');
  assert.equal(code, 1);
  assert.match(out, /maintenance mode/);
});

test('contact form that stops responding properly fails the run', async () => {
  const { code, out } = await runAgainst('formdead');
  assert.equal(code, 1);
  assert.match(out, /contact form/);
});

test('missing footer text fails the run', async () => {
  const { code, out } = await runAgainst('twoheaders');
  assert.equal(code, 1);
  assert.match(out, /\/about\/.*missing expected text "Iterum Ltd"/);
});

test('sites.mjs keeps the quick-check list short', () => {
  assert.ok(site.smoke.length <= 15);
});
