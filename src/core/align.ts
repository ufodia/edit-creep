import { gradient, luma, resize, sample, type Plane, type RgbImage } from './image.ts';

/**
 * Maps a pixel of the original to the edited image:
 * `editX = scale × x + tx`, `editY = scale × y + ty`.
 * AI editors often return a different size, a small crop or padding; a
 * uniform scale plus translation covers those cases without rotation.
 */
export interface Transform {
  scale: number;
  tx: number;
  ty: number;
}

export interface Alignment extends Transform {
  /** Mean absolute gradient difference after alignment, relative to the mean gradient (lower is better). */
  error: number;
  /** Share of the original covered by the edited image after alignment. */
  overlap: number;
  /** True when the images probably do not show the same scene. */
  doubtful: boolean;
}

interface Level {
  orig: Plane;
  edit: Plane;
  factor: number;
  meanGradient: number;
}

const COARSE_SIDE = 64;

function pyramid(orig: RgbImage, edit: RgbImage): Level[] {
  const levels: Level[] = [];
  let factor = 1;
  for (;;) {
    const ow = Math.max(8, Math.round(orig.width / factor));
    const oh = Math.max(8, Math.round(orig.height / factor));
    const ew = Math.max(8, Math.round(edit.width / factor));
    const eh = Math.max(8, Math.round(edit.height / factor));
    const o = factor === 1 ? orig : resize(orig, ow, oh);
    const e = factor === 1 ? edit : resize(edit, ew, eh);
    const og = gradient(luma(o));
    let total = 0;
    for (const value of og.data) total += value;
    levels.unshift({ orig: og, edit: gradient(luma(e)), factor, meanGradient: total / og.data.length });
    if (Math.max(ow, oh) <= COARSE_SIDE * 1.5) break;
    factor *= 2;
  }
  return levels;
}

function samplePlane(plane: Plane, x: number, y: number): number {
  if (x < 0 || y < 0 || x > plane.width - 1 || y > plane.height - 1) return NaN;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, plane.width - 1);
  const y1 = Math.min(y0 + 1, plane.height - 1);
  const fx = x - x0;
  const fy = y - y0;
  const w = plane.width;
  const d = plane.data;
  const a = d[y0 * w + x0];
  const b = d[y0 * w + x1];
  const c = d[y1 * w + x0];
  const e = d[y1 * w + x1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + e) * fx * fy;
}

/**
 * Mean absolute gradient difference over the overlap, divided by the original's
 * mean gradient (a constant per level, so it cannot bias the search), or
 * Infinity when the overlap is too small.
 */
function cost(level: Level, t: Transform, step: number): { error: number; overlap: number } {
  const { orig, edit } = level;
  let sum = 0;
  let count = 0;
  let total = 0;
  for (let y = 1; y < orig.height - 1; y += step)
    for (let x = 1; x < orig.width - 1; x += step) {
      total++;
      const v = samplePlane(edit, t.scale * x + t.tx, t.scale * y + t.ty);
      if (Number.isNaN(v)) continue;
      // Gradients are per pixel: an edit at scale s has edges s× steeper per pixel.
      sum += Math.abs(orig.data[y * orig.width + x] - v * t.scale);
      count++;
    }
  const overlap = total ? count / total : 0;
  if (overlap < 0.5 || !count || level.meanGradient === 0) return { error: Infinity, overlap };
  return { error: sum / count / level.meanGradient, overlap };
}

/**
 * Coarse-to-fine search over scale and translation on gradient magnitude.
 * Gradients make the match robust to the colour and brightness shifts that
 * generative editors commonly introduce.
 */
export function align(orig: RgbImage, edit: RgbImage): Alignment {
  const ratios = [edit.width / orig.width, edit.height / orig.height];
  // Uniform scale and modest cropping are the supported model. Extreme ratios
  // otherwise expand the coarse translation search into billions of candidates.
  if (ratios.some((ratio) => ratio < 1 / 8 || ratio > 8))
    throw new Error(
      'These image sizes are too different for reliable alignment. Compare images with similar dimensions.',
    );
  const aspectChange = ratios[0] / ratios[1];
  if (aspectChange < 0.5 || aspectChange > 2)
    throw new Error(
      'These aspect ratios cannot be aligned reliably. Use the same scene without rotation, stretching or a large crop.',
    );
  const levels = pyramid(orig, edit);
  const baseScales = Math.abs(ratios[0] - ratios[1]) < 0.01 ? [(ratios[0] + ratios[1]) / 2] : ratios;

  // Coarsest level: exhaustive search.
  const top = levels[0];
  let best: Transform = { scale: baseScales[0], tx: 0, ty: 0 };
  let bestError = Infinity;
  for (const base of baseScales)
    for (let s = base * 0.9; s <= base * 1.1 + 1e-9; s += base * 0.01) {
      const ew = top.edit.width;
      const eh = top.edit.height;
      const spanX = Math.max(Math.abs(ew - s * top.orig.width), ew * 0.12);
      const spanY = Math.max(Math.abs(eh - s * top.orig.height), eh * 0.12);
      for (let tx = -spanX; tx <= spanX; tx += 1)
        for (let ty = -spanY; ty <= spanY; ty += 1) {
          const { error } = cost(top, { scale: s, tx, ty }, 2);
          if (error < bestError) {
            bestError = error;
            best = { scale: s, tx, ty };
          }
        }
    }

  // Finer levels: local refinement around the doubled estimate.
  for (let i = 1; i < levels.length; i++) {
    const level = levels[i];
    const ratio = levels[i - 1].factor / level.factor;
    let center: Transform = { scale: best.scale, tx: best.tx * ratio, ty: best.ty * ratio };
    bestError = Infinity;
    const step =
      level.factor === 1 ? Math.max(1, Math.round(Math.max(level.orig.width, level.orig.height) / 512)) : 1;
    const cx = level.orig.width / 2;
    const cy = level.orig.height / 2;
    for (let pass = 0; pass < 2; pass++) {
      let improved = center;
      for (let ds = -2; ds <= 2; ds++)
        for (let dx = -2; dx <= 2; dx++)
          for (let dy = -2; dy <= 2; dy++) {
            // Scale around the image centre so scale and shift are searched independently.
            const scale = center.scale * (1 + ds * 0.0025);
            const t = {
              scale,
              tx: center.tx + dx - (scale - center.scale) * cx,
              ty: center.ty + dy - (scale - center.scale) * cy,
            };
            const { error } = cost(level, t, step);
            if (error < bestError) {
              bestError = error;
              improved = t;
            }
          }
      if (improved === center) break;
      center = improved;
    }
    best = center;
  }

  // Sub-pixel polish at full resolution: half a pixel of error on a sharp edge looks like a change.
  const finest = levels[levels.length - 1];
  const polishStep = Math.max(1, Math.round(Math.max(finest.orig.width, finest.orig.height) / 512));
  for (const [scaleStep, shiftStep] of [
    [0.001, 0.5],
    [0.0004, 0.25],
    [0.00015, 0.1],
  ] as const) {
    let bestPolish = cost(finest, best, polishStep).error;
    const center = best;
    for (let ds = -2; ds <= 2; ds++)
      for (let dx = -2; dx <= 2; dx++)
        for (let dy = -2; dy <= 2; dy++) {
          const scale = center.scale + ds * scaleStep;
          const t = {
            scale,
            tx: center.tx + dx * shiftStep - ds * scaleStep * (finest.orig.width / 2),
            ty: center.ty + dy * shiftStep - ds * scaleStep * (finest.orig.height / 2),
          };
          const { error } = cost(finest, t, polishStep);
          if (error < bestPolish) {
            bestPolish = error;
            best = t;
          }
        }
  }

  // Prefer the exact identity (or plain resize) when it is as good as the search result.
  for (const base of baseScales) {
    // A plain resize maps pixel centres: (x + 0.5) × s − 0.5 = s·x + (s − 1) / 2.
    const plain = { scale: base, tx: (base - 1) / 2, ty: (base - 1) / 2 };
    const plainCost = cost(finest, plain, 1).error;
    const bestCost = cost(finest, best, 1).error;
    if (plainCost <= bestCost * 1.02) best = plain;
  }
  const final = cost(finest, best, 1);
  return {
    ...best,
    error: final.error,
    overlap: final.overlap,
    doubtful: final.error > 0.9 || final.overlap < 0.75,
  };
}

/** Resample the edited image into the original's frame. `valid` marks pixels that exist in the edit. */
export function warp(
  edit: RgbImage,
  t: Transform,
  width: number,
  height: number,
): { image: RgbImage; valid: Uint8Array } {
  const data = new Float32Array(width * height * 3);
  const valid = new Uint8Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const sx = t.scale * x + t.tx;
      const sy = t.scale * y + t.ty;
      const i = y * width + x;
      const r = sample(edit, sx, sy, 0);
      if (Number.isNaN(r)) continue;
      valid[i] = 1;
      data[i * 3] = r;
      data[i * 3 + 1] = sample(edit, sx, sy, 1);
      data[i * 3 + 2] = sample(edit, sx, sy, 2);
    }
  return { image: { width, height, data }, valid };
}
