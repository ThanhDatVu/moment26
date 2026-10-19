import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createProxy } from '../server.js';

test('gallery rewriting, downloads, ranges, redirects and restricted routes', async t => {
  let upstreamOrigin;
  const upstream = http.createServer((req, res) => {
    if (req.url === '/e?s=redirect') {
      res.writeHead(302, { location: `${upstreamOrigin}/e?s=next` });
      return res.end();
    }
    if (req.url === '/e?s=external') {
      res.writeHead(302, { location: 'https://example.org/file' });
      return res.end();
    }
    if (req.url.startsWith('/e?')) {
      res.setHeader('content-type', 'text/html');
      return res.end(`<a href="${upstreamOrigin}/e/zip?s=test">Download</a>`);
    }
    if (req.headers.range) {
      res.writeHead(206, { 'content-range': 'bytes 0-2/6', 'accept-ranges': 'bytes' });
      return res.end('abc');
    }
    res.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': 'attachment; filename="photos.zip"' });
    res.end(Buffer.from([0x50, 0x4b, 0, 255]));
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  upstreamOrigin = `http://127.0.0.1:${upstream.address().port}`;
  const proxy = createProxy({ upstream: upstreamOrigin, defaultEvent: 'test' });
  proxy.listen(0, '127.0.0.1');
  await once(proxy, 'listening');
  t.after(() => { proxy.closeAllConnections(); proxy.close(); upstream.closeAllConnections(); upstream.close(); });
  const base = `http://127.0.0.1:${proxy.address().port}`;
  assert.equal(await (await fetch(base + '/e?s=test')).text(), '<a href="/e/zip?s=test">Download</a>');
  const root = await fetch(base, { redirect: 'manual' });
  assert.equal(root.headers.get('location'), '/e?s=test');
  const zip = await fetch(base + '/e/zip?s=test');
  assert.equal(zip.headers.get('content-disposition'), 'attachment; filename="photos.zip"');
  assert.deepEqual(Buffer.from(await zip.arrayBuffer()), Buffer.from([0x50, 0x4b, 0, 255]));
  const range = await fetch(base + '/f/id/video.mp4', { headers: { range: 'bytes=0-2' } });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get('content-range'), 'bytes 0-2/6');
  assert.equal(await range.text(), 'abc');
  const redirect = await fetch(base + '/e?s=redirect', { redirect: 'manual' });
  assert.equal(redirect.headers.get('location'), '/e?s=next');
  assert.equal((await fetch(base + '/e?s=external')).status, 502);
  assert.equal((await fetch(base + '/admin')).status, 404);
  assert.equal((await fetch(base + '/e', { method: 'POST' })).status, 405);
  assert.equal((await fetch(base + '//example.org/e')).status, 400);
  assert.equal((await fetch(base + '/f/id/image.jpg', { method: 'HEAD' })).status, 200);
});
