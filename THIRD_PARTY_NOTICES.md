# Third-party notices

Edit Creep's source code, documentation and artwork are MIT-licensed © 2026 ufodia.

## Runtime dependencies

None. Image decoding uses the browser's built-in `createImageBitmap`; every analysis step is implemented in this repository.

## Development tools

Vite, TypeScript, Vitest, Playwright and Prettier build and test the project and are not shipped to users. Exact versions are pinned in `package-lock.json`, and their licenses are in `node_modules` after `npm ci`.

## Demo images

The demo pair is drawn procedurally in `src/demo.ts`. The brand "Hilltop Roast" is invented for the demo.
