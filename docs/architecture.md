# Architecture

Edit Creep is a static Vite application in strict TypeScript with **no runtime dependencies**. The image pipeline is plain code on typed arrays, so it runs identically in a Web Worker and in Node tests.

```
index.html            intro, drop slots, explanation
src/main.ts           page state, decoding, canvas viewer, mask tools, results panel, exports
src/worker.ts         holds decoded images; runs alignment and analysis off the main thread
src/protocol.ts       typed page ↔ worker messages
src/demo.ts           procedurally drawn synthetic original and AI edit
src/dom.ts            text-only element factory and download helper
src/core/
  image.ts            RGB planes, bilinear sampling, area resize, luma, Sobel, box blur, sRGB → CIELAB
  align.ts            pyramid, coarse-to-fine scale/offset search, sub-pixel polish, warp
  tone.ts             robust per-channel gain/offset fit and compensation
  diff.ts             anti-aliasing-tolerant ΔE, shift-tolerant SSIM
  regions.ts          dilation, erosion, closing, connected components
  analyze.ts          prepare (align, resolution matching), analyze (intent, scoring, regions, verdict), heatmap
  report.ts           JSON report
```

## Data flow

1. The page decodes each file with `createImageBitmap` (EXIF orientation applied) and draws it into a canvas whose longer side is at most 1024 pixels.
2. The RGBA buffers and the current mask are **transferred** to the worker.
3. `prepare` checks alignment compatibility, aligns the edit, builds the resolution-matched reference and warps the edit into the original's frame. Before building its pyramid, the matcher rejects working-axis edited/original ratios outside `[1/8, 8]` or an aspect-ratio factor outside `[0.5, 2]`. The worker reports a readable error for rejected pairs; otherwise it posts aligned RGBA back for display. See [method bounds](method.md#1-alignment).
4. `analyze` runs with the mask and options and returns the analysis plus an RGBA heatmap. Label maps stay in the worker.
5. Mask edits and setting changes send `analyze`; **This was intended** sends `intend`, which grows the chosen regions into the mask before re-analysis.

Every request carries a `job` number; the page ignores answers to superseded jobs, so superseded responses can be discarded. The page also guards asynchronous file loading and reset operations; pending analysis disables actions that require current results.

## Worker protocol

| Page → worker | Purpose |
| --- | --- |
| `{ type: 'load', job, original, edited, mask, options }` | decode results in, align, analyse |
| `{ type: 'analyze', job, mask, options }` | re-analyse with a new mask or settings |
| `{ type: 'intend', job, ids, mask, options }` | add regions to the mask, then re-analyse |

| Worker → page | Purpose |
| --- | --- |
| `{ type: 'progress', job, message }` | status text |
| `{ type: 'prepared', job, aligned, alignment }` | aligned edit for display |
| `{ type: 'result', job, analysis, heatmap, mask }` | analysis, heatmap RGBA and the effective mask |
| `{ type: 'error', job, message }` | a readable error |

## Report format

```json
{
  "tool": { "name": "Edit Creep", "version": "1.0.0", "url": "https://github.com/ufodia/edit-creep" },
  "generatedAt": "2026-11-13T12:00:00.000Z",
  "analysisSize": { "width": 1024, "height": 768 },
  "settings": { "sensitivity": "balanced", "compensateTone": true },
  "verdict": "minor",
  "regions": [
    {
      "id": 1,
      "kind": "color",
      "severity": "minor",
      "box": { "x": 100, "y": 50, "width": 24, "height": 20 },
      "boxInOriginal": { "x": 200, "y": 100, "width": 48, "height": 40 }
    }
  ]
}
```

This is an illustrative, abridged example rather than a complete schema. Actual reports also include `files`, `summary`, `alignment`, `colourDrift`, `noise` and per-region measurement fields. `box` uses analysis pixels; `boxInOriginal` scales each axis independently to the original file dimensions, flooring starts and ceiling ends so the original-pixel box contains the analysis box. It does not locate the region in the unaligned edited file. See `src/core/report.ts` for the serialized contract.

## Testing

- **Unit tests** (`tests/`, Vitest): colour conversion, resizing, morphology, components, tone fitting, and end-to-end analysis on procedurally rendered scenes — identical copies, re-encoding noise, intended edits with and without a mask, recoloured logos, rewritten text, colour casts with and without compensation, resized-and-shifted and upscaled edits, unrelated images, moved objects and a 1024 × 768 performance budget.
- **Browser tests** (`e2e/`, Playwright): the demo, all view modes, highlighting, marking as intended, sensitivity and drift settings, JSON and PNG exports, uploading two generated PNGs and drawing a box, identical images, an undecodable file and the phone layout.
