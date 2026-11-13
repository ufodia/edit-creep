# Privacy

Images under review are often unreleased products, client work or news material. Edit Creep processes the images you open in your browser and provides no image-upload endpoint.

| Behaviour | How it is implemented |
| --- | --- |
| No upload | Images are decoded by the browser and compared in a Web Worker. There is no server endpoint. The production configuration sends `Content-Security-Policy: connect-src 'none'`, which blocks `fetch`, XHR, WebSocket, EventSource and beacons from the page and its worker. |
| No third-party code | `default-src 'self'` and zero runtime dependencies: no analytics, fonts, CDNs or models. |
| No application persistence | The app does not write images or results to cookies, `localStorage`, `sessionStorage` or IndexedDB. Browser memory, history, static-asset caching and downloads follow normal browser behavior. |
| Local exports | PNG and JSON files are generated in the tab and saved through the browser's download mechanism (`blob:` URLs). |

## What remains your responsibility

- **Exports contain your images.** The comparison sheet and heatmap include the pictures; the JSON report includes file names and dimensions.
- **Your device.** Browser extensions with page access, installed security software, screen recording or malware are outside the app's control.
- **Hosting.** The headers above are defined in [`vercel.json`](../vercel.json). If you host a copy elsewhere, configure the same headers (see [deployment](deployment.md)). The Vite development server does not send those production headers. Loading the hosted site requests application assets and can produce ordinary hosting access logs.

Closing the tab does not delete saved downloads. Reports can reveal project or client names through file names. For sensitive material, review the source, use a trusted browser and serve a checked local build. Local processing does not protect against a compromised device, browser extension, installed security software or modified hosted copy.

Report a way to make the page send data, or to execute content from an image file, privately as described in [SECURITY.md](../SECURITY.md).
