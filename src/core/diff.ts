import { boxBlur, toLab, type Plane, type RgbImage } from './image.ts';

export interface ChangeMaps {
  /** CIE76 colour difference per pixel after a light blur (just noticeable ≈ 2.3). */
  deltaE: Float32Array;
  /** Structural dissimilarity per pixel, (1 − SSIM) / 2 on lightness in a 7×7 window. */
  dssim: Float32Array;
  /** Plain per-pixel ΔE without neighbourhood tolerance, used to describe re-render noise. */
  plainDeltaE: Float32Array;
}

/** Neighbour offsets tolerated when comparing: sub-pixel and one-pixel shifts are not edits. */
const OFFSETS: [number, number][] = [];
for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) OFFSETS.push([dx, dy]);

/**
 * Two complementary signals: ΔE catches recolouring, DSSIM catches changed
 * texture, edges and text even when the average colour is unchanged. Both
 * take the best match within one pixel, so resampling and sub-pixel
 * misalignment do not look like changes.
 */
export function changeMaps(orig: RgbImage, edit: RgbImage): ChangeMaps {
  const { width: w, height: h } = orig;
  const n = w * h;
  const labA = toLab(orig);
  const labB = toLab(edit);
  const plane = (lab: Float32Array, c: number): Plane => {
    const data = new Float32Array(n);
    for (let i = 0; i < n; i++) data[i] = lab[i * 3 + c];
    return { width: w, height: h, data };
  };
  // A one-pixel blur absorbs compression noise.
  const A = [0, 1, 2].map((c) => boxBlur(plane(labA, c), 1).data);
  const B = [0, 1, 2].map((c) => boxBlur(plane(labB, c), 1).data);
  // Anti-aliasing tolerance: an original pixel whose colour lies inside the
  // range of the edited 3×3 neighbourhood (per channel) is not a change. Edge
  // pixels blended differently after resampling fall inside that range.
  const deltaE = new Float32Array(n);
  const plainDeltaE = new Float32Array(n);
  for (let i = 0; i < n; i++)
    plainDeltaE[i] = Math.hypot(A[0][i] - B[0][i], A[1][i] - B[1][i], A[2][i] - B[2][i]);
  const ranges = B.map((channel) => neighbourhoodRange(channel, w, h));
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let c = 0; c < 3; c++) {
      const value = A[c][i];
      const over = value - ranges[c].max[i];
      const under = ranges[c].min[i] - value;
      const d = over > 0 ? over : under > 0 ? under : 0;
      sum += d * d;
    }
    deltaE[i] = Math.sqrt(sum);
  }
  const L1 = plane(labA, 0);
  const L2 = plane(labB, 0);
  for (let i = 0; i < n; i++) {
    L1.data[i] /= 100;
    L2.data[i] /= 100;
  }
  return { deltaE, dssim: dssimMap(L1, L2, 3), plainDeltaE };
}

/** Per-pixel minimum and maximum over the 3×3 neighbourhood (separable, clamped edges). */
export function neighbourhoodRange(
  data: Float32Array,
  w: number,
  h: number,
): { min: Float32Array; max: Float32Array } {
  const rowMin = new Float32Array(w * h);
  const rowMax = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const a = data[y * w + Math.max(0, x - 1)];
      const b = data[i];
      const c = data[y * w + Math.min(w - 1, x + 1)];
      rowMin[i] = Math.min(a, b, c);
      rowMax[i] = Math.max(a, b, c);
    }
  const min = new Float32Array(w * h);
  const max = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const up = Math.max(0, y - 1) * w + x;
      const down = Math.min(h - 1, y + 1) * w + x;
      min[i] = Math.min(rowMin[up], rowMin[i], rowMin[down]);
      max[i] = Math.max(rowMax[up], rowMax[i], rowMax[down]);
    }
  return { min, max };
}

/**
 * Windowed SSIM using box statistics (O(n) per offset). The edited plane may
 * shift by up to one pixel; the best (lowest) dissimilarity is kept.
 */
export function dssimMap(a: Plane, b: Plane, radius: number, tolerance = true): Float32Array {
  const { width: w, height: h } = a;
  const n = w * h;
  const product = (f: (i: number) => number): Plane => {
    const data = new Float32Array(n);
    for (let i = 0; i < n; i++) data[i] = f(i);
    return { width: w, height: h, data };
  };
  const muA = boxBlur(a, radius).data;
  const muB = boxBlur(b, radius).data;
  const aa = boxBlur(
    product((i) => a.data[i] * a.data[i]),
    radius,
  ).data;
  const bb = boxBlur(
    product((i) => b.data[i] * b.data[i]),
    radius,
  ).data;
  const C1 = 0.01 ** 2;
  const C2 = 0.03 ** 2;
  const out = new Float32Array(n).fill(1);
  for (const [dx, dy] of tolerance ? OFFSETS : [[0, 0] as [number, number]]) {
    const at = (x: number, y: number) =>
      Math.min(h - 1, Math.max(0, y + dy)) * w + Math.min(w - 1, Math.max(0, x + dx));
    const ab = boxBlur(
      product((i) => a.data[i] * b.data[at(i % w, Math.floor(i / w))]),
      radius,
    ).data;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const j = at(x, y);
        const va = Math.max(0, aa[i] - muA[i] * muA[i]);
        const vb = Math.max(0, bb[j] - muB[j] * muB[j]);
        const cov = ab[i] - muA[i] * muB[j];
        const ssim =
          ((2 * muA[i] * muB[j] + C1) * (2 * cov + C2)) / ((muA[i] ** 2 + muB[j] ** 2 + C1) * (va + vb + C2));
        const d = Math.min(1, Math.max(0, (1 - ssim) / 2));
        if (d < out[i]) out[i] = d;
      }
  }
  return out;
}
