# Gallery reverse proxy

Serves the existing HM Photobooth gallery, photos, videos, branding assets and ZIP downloads through your own domain. No dependencies; Node.js 22+.

## Local preview

```sh
cp .env.example .env
node --env-file=.env server.js
```

Open http://127.0.0.1:3000 (redirects to the configured event), or use `/e?s=EVENT_TOKEN` for another event. Existing relative gallery URLs stay on your domain. Same-origin absolute URLs in HTML and redirect locations are rewritten. Unexpected external redirects fail closed.

## Deploy with HTTPS

1. Point your domain's DNS A record (and AAAA only if IPv6 works) to your server.
2. Install Docker with Compose on the server and copy this directory there.
3. Set `DOMAIN=photos.yourbrand.com` and your `DEFAULT_EVENT` in `.env`.
4. Allow inbound TCP ports 80 and 443, then run:

```sh
docker compose up -d --build
```

Caddy obtains and renews the HTTPS certificate. Share `https://photos.yourbrand.com/e?s=EVENT_TOKEN` with clients. The gallery container is reachable only through Caddy. For an existing hosting setup, run Node and route your domain to port 3000 using your existing HTTPS reverse proxy.

## Behavior and limits

- Only GET/HEAD to `/e`, `/e/zip`, `/f/*`, `/cb/*` are forwarded. `/healthz` is local. Provider admin pages are unavailable.
- Preserves download filenames, range requests and conditional media requests; streams binary responses with backpressure. Client disconnects cancel upstream requests. Requests have a ten-minute total limit.
- Browser cookies and authorization headers are not forwarded. This implementation targets the supplied public, token-based gallery.
- Event tokens retain the provider's existing access model. This proxy does not add tenant authorization or make tokens secret. Anyone with a valid event link can use it.
- No persistent photo storage or proxy cache. Media traffic passes through your server, so hosting bandwidth matters.
- Existing gallery logos/text remain unchanged. The upstream domain stays out of normal navigation for the inspected gallery; this is branding, not a guarantee that a technical user cannot identify the provider.
- If the provider changes its routes or introduces external media URLs, the proxy may need updates. External media URLs embedded in future pages are not automatically proxied.

## Tests

```sh
npm test
```
