# User guide

## 1. Load two images

| Slot | What to drop |
| --- | --- |
| **1 · Original image** | the picture before the AI edit — ideally the exact file you uploaded to the editor |
| **2 · AI-edited image** | the editor's output, in any size |

Click a slot to choose a file, drop a file on a slot, or drop two files anywhere on the page (the first becomes the original). Supported formats are those your browser decodes — commonly PNG, JPEG, WebP, AVIF, GIF (first frame) and BMP — up to 80 MiB each. EXIF orientation is applied. The size limit does not guarantee that every file below it can be decoded on your device.

**Try the demo pair** loads a synthetic product photo and an "AI edit" of it, with the intended area already marked.

The comparison starts as soon as both images are loaded. Alignment takes one to three seconds.

## 2. Mark what you asked to change

Marked pixels and a small feather band are excluded from the local difference search. If too little comparable, unmarked area remains, the app shows **No unmarked area to compare**; clear or reduce the mask to continue.

| Tool | How |
| --- | --- |
| **Paint** | drag over the canvas; adjust **Size** for the brush |
| **Box** | drag a rectangle |
| **Erase** | drag to remove part of the marked area |
| **Clear** | remove the whole mark |
| **Show intended area** | toggle the mint overlay |

The analysis re-runs automatically when you release the mouse. A small feather band around your mark is treated as intended too, because edits blend into their surroundings.

Faster still: leave the canvas unmarked, look at the regions, and click **This was intended** on the region that is your requested edit.

## 3. Look at the image

| Mode | Use it to |
| --- | --- |
| **Swipe** | drag the **Swipe** slider to compare original (left) and edit (right) |
| **Heatmap** | see change intensity: purple is just above the threshold, yellow is strong |
| **Onion skin** | fade the edit over the original with the **Opacity** slider; good for small shifts |
| **Original** / **Edited** | view one frame alone; the edit is shown aligned to the original |

Numbered boxes mark the regions in every mode. Box colours follow severity: red is major, orange moderate, yellow minor.

## 4. Read the results panel

- **Verdict** — a threshold-based review summary (**No changes detected**, Minor, Notable or Major), the number of regions, and the share of the untouched area that changed.
- **Alignment** — the edit's size and how it was matched (scale and offset). A warning means the images may not show the same scene.
- **Colour drift** — whether the whole picture was recoloured or relit, and by how much (ΔE).
- **Re-render noise** — the typical difference everywhere, for context.
- **Intended area** — how much of the image you marked.
- **Cropped** — appears when part of the original is missing from the edit.

## 5. Review regions

Each card shows the region number, what changed (colour, detail or text, or content), severity, size and peak strength, and zoomed **Original** and **Edited** crops.

- **Highlight** draws a glowing outline on the canvas and scrolls to it.
- **This was intended** adds the region to your marked area and re-runs the analysis.

## 6. Tune

- **Sensitivity** — *Low* for re-rendered photos with lots of noise, *Balanced* for most work, *High* to hunt for subtle changes. See [thresholds](method.md#thresholds).
- **Ignore global colour drift** — on by default. Turn it off when colour accuracy across the whole image matters, for example in product photography with a colour-calibrated reference.

## 7. Export

| Button | File |
| --- | --- |
| **Comparison sheet (PNG)** | `edit-creep-comparison.png`: original and edit side by side with numbered boxes and a verdict footer |
| **Heatmap (PNG)** | `edit-creep-heatmap.png`: the heatmap with numbered boxes and a footer |
| **Report (JSON)** | `edit-creep-report.json`: measurements, settings and region boxes mapped conservatively to the original file's pixels |

## Troubleshooting

| Symptom | Try |
| --- | --- |
| *could not be decoded* | convert the file to PNG or JPEG; HEIC is not supported by most browsers |
| Alignment warning | check that both images show comparable views of the same scene; rotated, stretched or perspective-corrected edits are not supported |
| Image-size or aspect-ratio alignment error | use images with comparable proportions and a modest crop; extreme working-dimension or aspect-ratio differences are rejected before comparison (see [method bounds](method.md#1-alignment)) |
| Many tiny regions along edges | choose **Low** sensitivity |
| Everything is highlighted | turn **Ignore global colour drift** back on, or mark the whole image as intended if you asked for a global change |
| The change you care about is not found | choose **High** sensitivity, or check it is not inside the feathered intended area |

While analysis is pending, result-dependent exports and region actions are disabled. Reset cancels the comparison and pending file choices. Keyboard users can move through view controls with arrow keys, Home and End. Transparent images are displayed and compared on white.
