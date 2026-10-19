import http from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';

const allowed = path => path === '/e' || path === '/e/zip' || /^\/(f|cb)\/[a-zA-Z0-9_./%-]+$/.test(path);

export function createProxy({ upstream = 'https://app.hmphotobooth.net', defaultEvent = process.env.DEFAULT_EVENT, requestTimeoutMs = Number(process.env.REQUEST_TIMEOUT_MS || 3_600_000) } = {}) {
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0) {
    throw new Error('REQUEST_TIMEOUT_MS must be a positive integer in milliseconds');
  }
  const origin = new URL(upstream).origin;
  return http.createServer(async (req, res) => {
    const abort = new AbortController();
    res.on('close', () => { if (!res.writableFinished) abort.abort(); });
    const fail = (status, message) => {
      if (res.headersSent) return res.destroy();
      res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      res.end(message);
    };
    try {
      if (!['GET', 'HEAD'].includes(req.method)) {
        res.setHeader('allow', 'GET, HEAD');
        return fail(405, 'Method not allowed');
      }
      if (!req.url.startsWith('/') || req.url.startsWith('//')) return fail(400, 'Invalid URL');
      const url = new URL(req.url, origin);
      if (url.pathname === '/healthz') return res.end('ok');
      if (url.pathname === '/' && defaultEvent) {
        res.writeHead(302, { location: `/e?s=${encodeURIComponent(defaultEvent)}`, 'cache-control': 'no-store' });
        return res.end();
      }
      if (url.origin !== origin || !allowed(url.pathname)) return fail(404, 'Not found');
      const headers = { 'accept-encoding': 'identity' };
      for (const key of ['accept', 'range', 'if-range', 'if-none-match', 'if-modified-since']) {
        if (req.headers[key]) headers[key] = req.headers[key];
      }
      const response = await fetch(url, {
        method: req.method, headers, redirect: 'manual',
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(requestTimeoutMs)]),
      });
      const location = response.headers.get('location');
      if (location) {
        const target = new URL(location, url);
        // Never redirect a client to the provider or an unexpected external host.
        if (target.origin !== origin || !allowed(target.pathname)) {
          await response.body?.cancel();
          return fail(502, 'Unsupported gallery redirect');
        }
        res.setHeader('location', target.pathname + target.search + target.hash);
      }
      for (const key of ['content-type', 'content-disposition', 'cache-control', 'last-modified', 'accept-ranges', 'content-range', 'etag', 'expires']) {
        const value = response.headers.get(key);
        if (value) res.setHeader(key, value);
      }
      res.setHeader('referrer-policy', 'no-referrer');
      res.setHeader('x-content-type-options', 'nosniff');
      res.statusCode = response.status;
      if (req.method === 'HEAD' || !response.body) return res.end();
      if ((response.headers.get('content-type') || '').includes('text/html')) {
        const html = (await response.text())
          .replaceAll(origin, '')
          .replaceAll(origin.replace('https:', '').replace('http:', ''), '');
        res.removeHeader('etag');
        res.setHeader('cache-control', 'no-store');
        return res.end(html);
      }
      // Stream photos, videos and ZIPs with backpressure; do not buffer large files.
      await pipeline(Readable.fromWeb(response.body), res);
    } catch (error) {
      if (!abort.signal.aborted) {
        console.error('Gallery upstream request failed:', error.code || error.name);
        fail(502, 'Gallery temporarily unavailable. Please try again.');
      }
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 3000);
  createProxy().listen(port, process.env.HOST || '127.0.0.1', () => {
    console.log(`Gallery proxy listening on port ${port}`);
  });
}
