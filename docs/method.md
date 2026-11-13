# Method

Edit Creep answers one question: *outside the area I asked to change, what is different?* It is a deterministic pipeline of classic image-processing steps — no model, no training data, no network.

All analysis happens at a working resolution where the original's longer side is at most 1024 pixels. The edited image is scaled by the same rule and may end up a different size.

## 1. Alignment

Generative editors often return a different size (for example 960 × 720 for a 1024 × 768 input), crop a few pixels, or shift the frame. Edit Creep models this as

```
editX = scale × x + tx
editY = scale × y + ty
```

and estimates `scale`, `tx` and `ty` on **gradient magnitude** images, which reduce sensitivity to some colour and brightness changes. Pixel coordinates refer to pixel centres; a plain resize by `s` therefore has `tx = ty = (s - 1) / 2`.

Before building the alignment pyramid, the app checks the working-image dimensions supplied to the matcher. Each edited/original axis ratio must be between `1/8` and `8`, inclusive. The aspect-ratio factor `(editWidth / originalWidth) / (editHeight / originalHeight)` must be between `0.5` and `2`, inclusive. Pairs outside either range are rejected with a readable error instead of starting an excessively large coarse search. These are compatibility guards, not evidence that every pair inside the bounds will align reliably. They apply after browser decoding and working-resolution reduction, not directly to the original file dimensions.

- A pyramid is built until the longer side is about 64–96 pixels.
- At the coarsest level, scale is searched exhaustively within ±10 % of the size ratio (both width and height ratios are tried when the aspect ratio changed) and translation within ±12 %.
- Each finer level refines scale and translation locally. Scale is varied **around the image centre**, so scale and shift are searched independently.
- At full resolution, three polishing passes reach 0.1 px and 0.015 % scale.
- Gradient values are multiplied by the candidate scale, because an image shrunk by `s` has edges `1/s` steeper per pixel.
- The exact identity (or a plain resize) is preferred whenever it is within 2 % of the best cost, avoiding unnecessary sub-pixel warping for simple cases.

The cost is the mean absolute gradient difference over the overlap divided by the original's mean gradient. A final cost above 0.9 or an overlap below 75 % marks the alignment as **doubtful**: the images probably do not show the same scene.

The edited image is then resampled into the original's frame with bilinear interpolation. Pixels it does not cover are reported as **cropped** and excluded.

## 2. Resolution matching

When the edit is smaller (`scale < 0.98`), fine detail is lost to resampling, not to editing. The original is therefore passed through the same loss — area-averaged down by `scale`, then bilinearly up — and this **reference** is what the edit is compared against. When the edit is larger (`scale > 1.02`), it is area-averaged down first so warping does not alias.

## 3. Colour drift

Outside the intended area, a per-channel linear model `edited = gain × reference + offset` is fitted by least squares on up to 60 000 sampled pixels. A second pass drops the 20 % worst residuals, to reduce the influence of local edits. Large or widespread edits can still affect the fit. The drift is **significant** when the CIELAB distance between the mean colours exceeds 2, a gain deviates by more than 3 % or an offset by more than 1.5 %.

With **Ignore global colour drift** on (the default), the edit is corrected by the inverse model before comparison. The drift is always reported.

## 4. Per-pixel change

Two complementary signals are computed on the reference and the (corrected) edit:

| Signal | Definition | Catches |
| --- | --- | --- |
| **ΔE** | CIE76 colour distance in CIELAB (D65), after a 3 × 3 box blur, with anti-aliasing tolerance: for each channel, distance to the range spanned by the edited 3 × 3 neighbourhood | recolouring, added or removed objects |
| **DSSIM** | `(1 − SSIM) / 2` on lightness with a 7 × 7 window, taking the best of the nine one-pixel shifts | changed text, texture, edges and shapes |

The **score** of a pixel is `max(ΔE / ΔE threshold, DSSIM / DSSIM threshold)`; a score of 1 or more counts as changed.

## 5. Intent, grouping and filtering

- The painted mask is dilated by 0.8 % of the image size (a feather band, because edits blend into their surroundings) and excluded.
- Coverage is eroded by 4 pixels so windows that straddle the crop edge are ignored.
- Changed pixels are joined by a morphological closing (radius 2) and labelled as 8-connected components.
- Components smaller than the sensitivity's minimum area, or thinner than four pixels, are dropped.
- A component is kept when its peak score is at least 2.4 (1.8 at high sensitivity), or when it covers at least 0.2 % of the image with a fill ratio of 25 % or more. Faint, sparse outlines along edges are resampling artefacts, not edits.
- Components whose padded boxes touch are merged, so a moved object is one region.

Each region gets a **kind** (colour, detail or content, from the mean ΔE and DSSIM in threshold units), a **severity** (major ≥ 1 % of the image, or peak ≥ 3 and ≥ 0.2 %; moderate ≥ 0.2 % or peak ≥ 2.5; otherwise minor) and is ranked by area × peak.

## 6. Verdict

| Verdict | Rule |
| --- | --- |
| No changes detected | no regions |
| Major | any major region, or ≥ 5 % of the untouched area changed |
| Notable | any moderate region, or ≥ 1 % of the untouched area changed |
| Minor | otherwise |

## Thresholds

| Sensitivity | ΔE | DSSIM | Minimum region |
| --- | ---: | ---: | ---: |
| Low | 12 | 0.20 | 0.04 % |
| Balanced | 8 | 0.13 | 0.012 % |
| High | 5 | 0.08 | 0.005 % |

The **re-render noise** figure in the results is the median plain ΔE outside the intended area — how much the editor changed "everything" without changing anything in particular.

## Limitations

- **Geometry:** only uniform scale, crop and offset are modelled. Rotation, perspective, lens correction or content-aware resizing can produce widespread differences and doubtful alignment. Excessive working-dimension or aspect-ratio differences are rejected before the search; see the compatibility bounds above.
- **Meaning:** a semantically important but tiny change (a decimal point) can fall below the minimum region size, and a harmless large change (regenerated noise or grain) can be reported. Use the sensitivity control and your judgement.
- **Global edits:** if you asked for a global change ("make it night"), mark the whole image as intended or turn off colour-drift compensation and read the heatmap instead.
- **Resolution:** analysis runs at up to 1024 pixels on the longer side. Changes smaller than about one analysis pixel are not measurable.
- **Colour management:** images are compared as decoded by the browser in sRGB. Embedded ICC profiles are honoured by the decoder but wide-gamut differences are not modelled separately.

Labels and verdicts summarize these measurements. They do not identify the editing model, validate text or certify that an image is accurate. Review the before/after crops before making a publication decision.
