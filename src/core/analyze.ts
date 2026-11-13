import { align, warp, type Alignment } from './align.ts';
import { changeMaps } from './diff.ts';
import { fromRgba, resize, sample, toRgba, type RgbImage } from './image.ts';
import { close, components, dilate, erode } from './regions.ts';
import { compensate, fitTone, type ToneFit } from './tone.ts';

export type Sensitivity = 'low' | 'balanced' | 'high';

export interface Options {
  sensitivity: Sensitivity;
  /** Ignore a global colour or brightness drift when looking for local changes. */
  compensateTone: boolean;
}

export const DEFAULT_OPTIONS: Options = { sensitivity: 'balanced', compensateTone: true };

/**
 * Thresholds for one "unit" of change. ΔE ≈ 2.3 is just noticeable; values
 * below the balanced setting are typical of re-encoding noise from generative
 * editors. `minArea` is a fraction of the image.
 */
export const THRESHOLDS: Record<Sensitivity, { deltaE: number; dssim: number; minArea: number }> = {
  low: { deltaE: 12, dssim: 0.2, minArea: 0.0004 },
  balanced: { deltaE: 8, dssim: 0.13, minArea: 0.00012 },
  high: { deltaE: 5, dssim: 0.08, minArea: 0.00005 },
};

export interface Prepared {
  width: number;
  height: number;
  original: RgbImage;
  /**
   * The original as it would look at the edit's resolution. When an editor
   * returns a smaller image, fine detail is lost to resampling, not to an edit;
   * comparing against this reference keeps that loss out of the report.
   */
  reference: RgbImage;
  /** The edited image resampled into the original's frame. */
  aligned: RgbImage;
  /** 1 where the edited image covers the original after alignment. */
  valid: Uint8Array;
  alignment: Alignment;
  editSize: { width: number; height: number };
}

export type RegionKind = 'color' | 'detail' | 'content';
export type Severity = 'major' | 'moderate' | 'minor';

export interface Region {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Changed share of the whole image, 0..1. */
  area: number;
  pixels: number;
  meanDeltaE: number;
  meanDssim: number;
  /** Strongest change in the region, in threshold units. */
  peak: number;
  kind: RegionKind;
  severity: Severity;
}

export type Verdict = 'clean' | 'minor' | 'notable' | 'major';

export interface Analysis {
  width: number;
  height: number;
  options: Options;
  alignment: Alignment;
  editSize: { width: number; height: number };
  tone: ToneFit;
  /** Typical difference outside the intended area: re-encoding noise level. */
  noise: { deltaE: number; dssim: number };
  intendedPixels: number;
  outsidePixels: number;
  changedPixels: number;
  /** Changed share of the area outside the intended edit, 0..1. */
  changedFraction: number;
  uncoveredFraction: number;
  verdict: Verdict;
  regions: Region[];
}

export interface AnalysisMaps {
  /** Per-pixel change in threshold units (≥ 1 counts as changed). */
  score: Float32Array;
  /** Region label per pixel (0 = none); matches `Region.id`. */
  labels: Int32Array;
  /** The intended area after feathering. */
  intended: Uint8Array;
}

export function prepare(
  originalRgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  editRgba: Uint8ClampedArray | Uint8Array,
  editWidth: number,
  editHeight: number,
): Prepared {
  const original = fromRgba(originalRgba, width, height);
  let edit = fromRgba(editRgba, editWidth, editHeight);
  const alignment = align(original, edit);
  let transform = { scale: alignment.scale, tx: alignment.tx, ty: alignment.ty };
  if (alignment.scale > 1.02) {
    // A larger edit is area-averaged down first, so warping does not alias fine detail.
    const w2 = Math.max(1, Math.round(editWidth / alignment.scale));
    const h2 = Math.max(1, Math.round(editHeight / alignment.scale));
    const f = (editWidth / w2 + editHeight / h2) / 2;
    edit = resize(edit, w2, h2);
    // Pixel centres: an index u in the full edit is v = (u − (f − 1) / 2) / f in the shrunk copy.
    transform = {
      scale: alignment.scale / f,
      tx: (alignment.tx - (f - 1) / 2) / f,
      ty: (alignment.ty - (f - 1) / 2) / f,
    };
  }
  const { image, valid } = warp(edit, transform, width, height);
  const reference = alignment.scale < 0.98 ? roundTrip(original, alignment.scale) : original;
  // Pixels the edit does not cover take the reference value, so no artificial edge appears at the border.
  for (let i = 0; i < width * height; i++)
    if (!valid[i]) for (let c = 0; c < 3; c++) image.data[i * 3 + c] = reference.data[i * 3 + c];
  return {
    width,
    height,
    original,
    reference,
    aligned: image,
    valid,
    alignment,
    editSize: { width: editWidth, height: editHeight },
  };
}

/** Downscale by `scale` with area averaging, then upscale back with bilinear sampling. */
export function roundTrip(image: RgbImage, scale: number): RgbImage {
  const small = resize(
    image,
    Math.max(1, Math.round(image.width * scale)),
    Math.max(1, Math.round(image.height * scale)),
  );
  const fx = small.width / image.width;
  const fy = small.height / image.height;
  const data = new Float32Array(image.data.length);
  for (let y = 0; y < image.height; y++)
    for (let x = 0; x < image.width; x++) {
      const sx = Math.min(small.width - 1, Math.max(0, (x + 0.5) * fx - 0.5));
      const sy = Math.min(small.height - 1, Math.max(0, (y + 0.5) * fy - 0.5));
      for (let c = 0; c < 3; c++) data[(y * image.width + x) * 3 + c] = sample(small, sx, sy, c);
    }
  return { width: image.width, height: image.height, data };
}

/** Edits blend into their surroundings; a feather band around the mask is treated as intended. */
export const featherRadius = (width: number, height: number) =>
  Math.max(2, Math.round(Math.max(width, height) * 0.008));

export function analyze(
  p: Prepared,
  mask: Uint8Array,
  options: Options = DEFAULT_OPTIONS,
): Analysis & { maps: AnalysisMaps } {
  const { width: w, height: h } = p;
  const n = w * h;
  const t = THRESHOLDS[options.sensitivity];
  const intended = dilate(mask, w, h, featherRadius(w, h));
  // Stay a few pixels away from the edge of the edit's coverage, where windows straddle the border.
  const covered = erode(p.valid, w, h, 4);
  const outside = new Uint8Array(n);
  let outsidePixels = 0;
  let validPixels = 0;
  let intendedPixels = 0;
  for (let i = 0; i < n; i++) {
    if (p.valid[i]) validPixels++;
    if (intended[i]) intendedPixels++;
    if (covered[i] && !intended[i]) {
      outside[i] = 1;
      outsidePixels++;
    }
  }

  const tone = fitTone(p.reference, p.aligned, (i) => outside[i] === 1);
  const compared = options.compensateTone ? compensate(p.aligned, tone) : p.aligned;
  const { deltaE, dssim, plainDeltaE } = changeMaps(p.reference, compared);

  const score = new Float32Array(n);
  const changed = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!p.valid[i]) continue;
    score[i] = Math.max(deltaE[i] / t.deltaE, dssim[i] / t.dssim);
    if (outside[i] && score[i] >= 1) changed[i] = 1;
  }

  // Close small gaps so one changed object becomes one region, then keep it outside the intent.
  const closed = close(changed, w, h, 2);
  for (let i = 0; i < n; i++) if (!outside[i]) closed[i] = 0;
  const { labels, list } = components(closed, w, h);
  const minPixels = Math.max(12, Math.round(n * t.minArea));

  const sums = list.map(() => ({ dE: 0, ds: 0, peak: 0 }));
  for (let i = 0; i < n; i++) {
    const label = labels[i];
    if (!label) continue;
    const s = sums[label - 1];
    s.dE += deltaE[i];
    s.ds += dssim[i];
    if (score[i] > s.peak) s.peak = score[i];
  }

  // Thin, faint or sparse outlines are resampling artefacts along edges, not edits:
  // keep a region when it is clearly strong, or when it is both sizeable and solid.
  const strong = options.sensitivity === 'high' ? 1.8 : 2.4;
  const kept = list.filter((c) => {
    if (c.pixels < minPixels || Math.min(c.x1 - c.x0, c.y1 - c.y0) < 3) return false;
    const fill = c.pixels / ((c.x1 - c.x0 + 1) * (c.y1 - c.y0 + 1));
    return sums[c.id - 1].peak >= strong || (c.pixels / n >= 0.002 && fill >= 0.25);
  });
  // Regions whose boxes touch describe one changed object (a moved circle leaves two crescents).
  const PAD = 6;
  const parent = new Map<number, number>(kept.map((c) => [c.id, c.id]));
  const find = (id: number): number => {
    while (parent.get(id) !== id) id = parent.get(id)!;
    return id;
  };
  for (let a = 0; a < kept.length; a++)
    for (let b = a + 1; b < kept.length; b++) {
      const A = kept[a];
      const B = kept[b];
      if (A.x0 - PAD <= B.x1 && B.x0 - PAD <= A.x1 && A.y0 - PAD <= B.y1 && B.y0 - PAD <= A.y1)
        parent.set(find(A.id), find(B.id));
    }
  const groups = new Map<
    number,
    { x0: number; y0: number; x1: number; y1: number; pixels: number; dE: number; ds: number; peak: number }
  >();
  for (const c of kept) {
    const root = find(c.id);
    const s = sums[c.id - 1];
    const g = groups.get(root) ?? {
      x0: c.x0,
      y0: c.y0,
      x1: c.x1,
      y1: c.y1,
      pixels: 0,
      dE: 0,
      ds: 0,
      peak: 0,
    };
    g.x0 = Math.min(g.x0, c.x0);
    g.y0 = Math.min(g.y0, c.y0);
    g.x1 = Math.max(g.x1, c.x1);
    g.y1 = Math.max(g.y1, c.y1);
    g.pixels += c.pixels;
    g.dE += s.dE;
    g.ds += s.ds;
    g.peak = Math.max(g.peak, s.peak);
    groups.set(root, g);
  }
  const relabel = new Map<number, number>();
  const regions: Region[] = [...groups.entries()]
    .map(([root, g]) => {
      const meanDeltaE = g.dE / g.pixels;
      const meanDssim = g.ds / g.pixels;
      const area = g.pixels / n;
      const colorUnits = meanDeltaE / t.deltaE;
      const detailUnits = meanDssim / t.dssim;
      const kind: RegionKind =
        detailUnits >= 0.8 && colorUnits < 0.8
          ? 'detail'
          : colorUnits >= 0.8 && detailUnits < 0.8
            ? 'color'
            : 'content';
      const severity: Severity =
        area >= 0.01 || (g.peak >= 3 && area >= 0.002)
          ? 'major'
          : area >= 0.002 || g.peak >= 2.5
            ? 'moderate'
            : 'minor';
      return {
        id: root,
        x: g.x0,
        y: g.y0,
        width: g.x1 - g.x0 + 1,
        height: g.y1 - g.y0 + 1,
        area,
        pixels: g.pixels,
        meanDeltaE,
        meanDssim,
        peak: g.peak,
        kind,
        severity,
      };
    })
    .sort((a, b) => b.area * b.peak - a.area * a.peak)
    .map((region, index) => {
      relabel.set(region.id, index + 1);
      return { ...region, id: index + 1 };
    });
  const keptIds = new Set(kept.map((c) => c.id));

  // Renumber labels to match the sorted region list; drop the tiny ones.
  let changedPixels = 0;
  for (let i = 0; i < n; i++) {
    const label = labels[i];
    if (!label) continue;
    if (!keptIds.has(label)) {
      labels[i] = 0;
      continue;
    }
    labels[i] = relabel.get(find(label))!;
    changedPixels++;
  }

  const changedFraction = outsidePixels ? changedPixels / outsidePixels : 0;
  const verdict: Verdict = !regions.length
    ? 'clean'
    : regions.some((r) => r.severity === 'major') || changedFraction >= 0.05
      ? 'major'
      : changedFraction >= 0.01 || regions.some((r) => r.severity === 'moderate')
        ? 'notable'
        : 'minor';

  return {
    width: w,
    height: h,
    options,
    alignment: p.alignment,
    editSize: p.editSize,
    tone,
    noise: medianNoise(plainDeltaE, dssim, outside),
    intendedPixels,
    outsidePixels,
    changedPixels,
    changedFraction,
    uncoveredFraction: 1 - validPixels / n,
    verdict,
    regions,
    maps: { score, labels, intended },
  };
}

function medianNoise(deltaE: Float32Array, dssim: Float32Array, outside: Uint8Array) {
  const step = Math.max(1, Math.floor(outside.length / 40_000));
  const a: number[] = [];
  const b: number[] = [];
  for (let i = 0; i < outside.length; i += step)
    if (outside[i]) {
      a.push(deltaE[i]);
      b.push(dssim[i]);
    }
  const median = (values: number[]) => {
    if (!values.length) return 0;
    values.sort((x, y) => x - y);
    return values[Math.floor(values.length / 2)];
  };
  return { deltaE: median(a), dssim: median(b) };
}

/** Add whole regions (slightly grown) to the intended mask: "this change was what I asked for". */
export function markIntended(
  mask: Uint8Array,
  labels: Int32Array,
  ids: number[],
  width: number,
  height: number,
): Uint8Array {
  const add = new Uint8Array(mask.length);
  const wanted = new Set(ids);
  for (let i = 0; i < labels.length; i++) if (wanted.has(labels[i])) add[i] = 1;
  const grown = dilate(add, width, height, 3);
  const out = mask.slice();
  for (let i = 0; i < out.length; i++) if (grown[i]) out[i] = 1;
  return out;
}

const STOPS: [number, number, number][] = [
  [72, 32, 160],
  [214, 51, 132],
  [255, 138, 76],
  [255, 230, 109],
];

/** RGBA heat overlay: transparent below half a unit, purple → pink → orange → yellow above. */
export function heatmap(maps: AnalysisMaps, valid: Uint8Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(maps.score.length * 4);
  for (let i = 0; i < maps.score.length; i++) {
    const o = i * 4;
    if (!valid[i]) {
      out[o] = 90;
      out[o + 1] = 90;
      out[o + 2] = 100;
      out[o + 3] = 150;
      continue;
    }
    if (maps.intended[i]) {
      out[o] = 124;
      out[o + 1] = 242;
      out[o + 2] = 200;
      out[o + 3] = 70;
      continue;
    }
    const s = maps.score[i];
    if (s < 0.5) continue;
    const t = Math.min(1, (s - 0.5) / 2.5) * (STOPS.length - 1);
    const k = Math.min(STOPS.length - 2, Math.floor(t));
    const f = t - k;
    for (let c = 0; c < 3; c++) out[o + c] = STOPS[k][c] + (STOPS[k + 1][c] - STOPS[k][c]) * f;
    out[o + 3] = maps.labels[i] ? 215 : 120;
  }
  return out;
}

export { toRgba };
