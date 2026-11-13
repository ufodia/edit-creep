import { rgbToLab, type RgbImage } from './image.ts';

/** Per-channel linear correction `edited ≈ gain × original + offset`. */
export interface ToneFit {
  gain: [number, number, number];
  offset: [number, number, number];
  /** CIELAB distance between the mean colours of the original and the edit outside the intended area. */
  shift: number;
  /** True when the whole picture was recoloured or relit noticeably. */
  significant: boolean;
}

const MAX_SAMPLES = 60_000;

/**
 * Generative editors often re-render the whole frame with a slight colour or
 * brightness drift. Fitting that drift outside the intended area lets the
 * local comparison ignore it while still reporting it.
 */
export function fitTone(orig: RgbImage, edit: RgbImage, include: (index: number) => boolean): ToneFit {
  const n = orig.width * orig.height;
  const step = Math.max(1, Math.floor(n / MAX_SAMPLES));
  const indices: number[] = [];
  for (let i = 0; i < n; i += step) if (include(i)) indices.push(i);
  if (indices.length < 50) return { gain: [1, 1, 1], offset: [0, 0, 0], shift: 0, significant: false };

  const gain: [number, number, number] = [1, 1, 1];
  const offset: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    let set = indices;
    for (let pass = 0; pass < 2; pass++) {
      const [g, o] = leastSquares(
        set.map((i) => orig.data[i * 3 + c]),
        set.map((i) => edit.data[i * 3 + c]),
      );
      gain[c] = g;
      offset[c] = o;
      // Second pass drops the 20 % worst residuals: local edits must not bend the global fit.
      const residuals = set.map((i) => Math.abs(edit.data[i * 3 + c] - (g * orig.data[i * 3 + c] + o)));
      const cutoff = [...residuals].sort((a, b) => a - b)[Math.floor(residuals.length * 0.8)];
      set = set.filter((_, k) => residuals[k] <= cutoff);
    }
  }

  const mean = (img: RgbImage) => {
    const sum = [0, 0, 0];
    for (const i of indices) for (let c = 0; c < 3; c++) sum[c] += img.data[i * 3 + c];
    return sum.map((s) => s / indices.length) as [number, number, number];
  };
  const [L1, a1, b1] = rgbToLab(...mean(orig));
  const [L2, a2, b2] = rgbToLab(...mean(edit));
  const shift = Math.hypot(L1 - L2, a1 - a2, b1 - b2);
  const drift = gain.some((g) => Math.abs(g - 1) > 0.03) || offset.some((o) => Math.abs(o) > 0.015);
  return { gain, offset, shift, significant: shift > 2 || drift };
}

function leastSquares(x: number[], y: number[]): [number, number] {
  const n = x.length;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += x[i];
    sy += y[i];
    sxx += x[i] * x[i];
    sxy += x[i] * y[i];
  }
  const denominator = n * sxx - sx * sx;
  if (Math.abs(denominator) < 1e-9) return [1, (sy - sx) / n];
  const gain = (n * sxy - sx * sy) / denominator;
  return [gain, (sy - gain * sx) / n];
}

/** Undo a fitted drift on the edited image: `(edited − offset) / gain`. */
export function compensate(edit: RgbImage, fit: ToneFit): RgbImage {
  const data = new Float32Array(edit.data.length);
  for (let i = 0; i < data.length; i++) {
    const c = i % 3;
    const g = Math.abs(fit.gain[c]) < 0.05 ? 1 : fit.gain[c];
    data[i] = Math.min(1, Math.max(0, (edit.data[i] - fit.offset[c]) / g));
  }
  return { width: edit.width, height: edit.height, data };
}
