# Deployment

Edit Creep is a static site. `npm run build` writes everything to `dist/`; any static host can serve it.

## Build

```bash
npm ci
npm run check   # strict typecheck, unit tests and production build into dist/
```

`postbuild` runs `scripts/prepare-hosting.mjs`, which only touches `dist/`. On a Vercel production build (`VERCEL_ENV=production` with `VERCEL_PROJECT_PRODUCTION_URL`) it adds a canonical URL, makes the social image absolute and writes `robots.txt` and `sitemap.xml`. Every other build is marked `noindex` with a disallow-all `robots.txt`.

## Security headers

| Header | Value |
| --- | --- |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'none'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `no-referrer` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=()` |
| `Cross-Origin-Opener-Policy` | `same-origin` |

`img-src data: blob:` is needed for slot thumbnails and downloads; `style-src 'unsafe-inline'` only for inline style attributes. Scripts stay same-origin.

## Vercel

[`vercel.json`](../vercel.json) sets the framework (Vite), `npm ci`, `npm run build`, the `dist` output directory and all headers above. Node.js 24 comes from `engines` in `package.json`. No environment variables are needed.

## Netlify, Cloudflare Pages and others

Build with `npm run build`, publish `dist`, and add the headers. For hosts that read a `_headers` file, create `public/_headers` before building:

```
/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'none'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
  Cross-Origin-Opener-Policy: same-origin
```

## Verify a deployment

1. Check the response headers of the page and of `/assets/worker-*.js` in developer tools.
2. Run the demo; the Network panel should show only same-origin files.
3. Run the browser suite against your verified production URL (replace the reserved example domain):

```bash
PLAYWRIGHT_BASE_URL=https://your-deployment.example npx playwright test
```

In PowerShell:

```powershell
$env:PLAYWRIGHT_BASE_URL = 'https://your-deployment.example'
npm run test:browser
Remove-Item Env:PLAYWRIGHT_BASE_URL
```

Check the canonical URL, `robots.txt`, `sitemap.xml`, social image and production assets. Preview builds should remain non-indexable. For a public production update, check the affected URL and sitemap in its authorized Google Search Console property. Submission does not guarantee indexing.

## Restore on a replacement computer

GitHub `main` contains the source, lockfile, artwork, build scripts and non-secret configuration. With Node.js 24 and Git installed:

```bash
git clone https://github.com/ufodia/edit-creep.git
cd edit-creep
git rev-parse HEAD
npm ci
npm run check
npx playwright install chromium
npm run test:browser
```

Compare the checked-out SHA with the completed revision recorded on GitHub `main`. Dependencies, browser binaries, build output and test reports are regenerated. Keep hosting credentials outside the repository.

## Publishing changes

Run the project checks, review the task diff and integrate the checked revision into GitHub `main`. Deploy that revision through the connected Vercel project, then verify the production result. A local commit, preview deployment or unmerged branch is not the production source of record. Repository integration and deployment are separate actions under the maintainer's authorization.

No application API keys, model weights or user-data backups are needed to restore the project.
