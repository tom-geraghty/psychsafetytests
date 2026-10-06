// Small HTTP helper: timeouts, optional proxy, optional basic auth for dev sites.
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

if (process.env.HTTPS_PROXY || process.env.https_proxy) {
  // Only used where the machine sits behind a proxy (not on GitHub Actions).
  setGlobalDispatcher(new EnvHttpProxyAgent());
}

const UA = 'PsychSafety-SiteChecks/1.0 (+https://github.com/tom-geraghty/psychsafetytests)';

export function authHeaderFor(siteKey) {
  // SITE_AUTH_PSYCHSAFETY="user:password" for a password-protected dev copy.
  const cred = process.env[`SITE_AUTH_${siteKey.toUpperCase()}`];
  return cred ? { Authorization: 'Basic ' + Buffer.from(cred).toString('base64') } : {};
}

export async function get(url, { siteKey, timeoutMs = 30000, redirect = 'follow', method = 'GET', body, headers = {} } = {}) {
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      body,
      redirect,
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-GB', ...(siteKey ? authHeaderFor(siteKey) : {}), ...headers },
    });
    const text = method === 'HEAD' ? '' : await res.text();
    return { ok: true, status: res.status, headers: res.headers, text, ms: Date.now() - started, url: res.url };
  } catch (err) {
    const reason = err.name === 'AbortError' ? `no response within ${timeoutMs / 1000}s` : (err.cause?.code || err.message);
    return { ok: false, status: 0, headers: new Headers(), text: '', ms: Date.now() - started, url, error: reason };
  } finally {
    clearTimeout(timer);
  }
}

// Follow redirects one hop at a time so we can see each status code.
export async function traceRedirects(url, { siteKey, maxHops = 6 } = {}) {
  const hops = [];
  let current = url;
  for (let i = 0; i < maxHops; i++) {
    const r = await get(current, { siteKey, redirect: 'manual', method: 'GET' });
    hops.push({ url: current, status: r.status, error: r.error });
    if (!r.ok) break;
    const loc = r.headers.get('location');
    if (r.status >= 300 && r.status < 400 && loc) {
      current = new URL(loc, current).toString();
      continue;
    }
    break;
  }
  return { hops, final: hops.at(-1) };
}

// Run async tasks with limited concurrency (be gentle with the server).
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
