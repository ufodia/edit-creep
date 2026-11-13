/**
 * Small, dependency-free image primitives. Images are planar Float32 arrays so
 * the same code runs in a Web Worker and in Node tests.
 */

/** An RGB image with channels in 0..1, stored interleaved (r, g, b, r, g, b, …). */
export interface RgbImage {
  width: number;
  height: number;
  data: Float32Array;
}

/** A single-channel float map. */
export interface Plane {
  width: number;
  height: number;
  data: Float32Array;
}

export function fromRgba(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): RgbImage {
  const data = new Float32Array(width * height * 3);
  for (let i = 0, j = 0; i < width * height; i++, j += 4) {
    // Transparent pixels are composited on white, the way most viewers show them.
    const alpha = rgba[j + 3] / 255;
    data[i * 3] = (rgba[j] / 255) * alpha + (1 - alpha);
    data[i * 3 + 1] = (rgba[j + 1] / 255) * alpha + (1 - alpha);
    data[i * 3 + 2] = (rgba[j + 2] / 255) * alpha + (1 - alpha);
  }
  return { width, height, data };
}

export function toRgba(image: RgbImage): Uint8ClampedArray {
  const out = new Uint8ClampedArray(image.width * image.height * 4);
  for (let i = 0, j = 0; i < image.width * image.height; i++, j += 4) {
    out[j] = image.data[i * 3] * 255;
    out[j + 1] = image.data[i * 3 + 1] * 255;
    out[j + 2] = image.data[i * 3 + 2] * 255;
    out[j + 3] = 255;
  }
  return out;
}

/** Bilinear sample of one channel at a fractional position; `NaN` outside the image. */
export function sample(image: RgbImage, x: number, y: number, channel: number): number {
  if (x < 0 || y < 0 || x > image.width - 1 || y > image.height - 1) return NaN;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, image.width - 1);
  const y1 = Math.min(y0 + 1, image.height - 1);
  const fx = x - x0;
  const fy = y - y0;
  const w = image.width;
  const d = image.data;
  const a = d[(y0 * w + x0) * 3 + channel];
  const b = d[(y0 * w + x1) * 3 + channel];
  const c = d[(y1 * w + x0) * 3 + channel];
  const e = d[(y1 * w + x1) * 3 + channel];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + e) * fx * fy;
}

/** Area-average downscale by an integer-free factor (used for pyramids and tests). */
export function resize(image: RgbImage, width: number, height: number): RgbImage {
  const out = new Float32Array(width * height * 3);
  const sx = image.width / width;
  const sy = image.height / height;
  for (let y = 0; y < height; y++) {
    const y0 = y * sy;
    const y1 = Math.min(image.height, (y + 1) * sy);
    for (let x = 0; x < width; x++) {
      const x0 = x * sx;
      const x1 = Math.min(image.width, (x + 1) * sx);
      let r = 0;
      let g = 0;
      let b = 0;
      let weight = 0;
      for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++) {
        const wy = Math.min(y1, yy + 1) - Math.max(y0, yy);
        if (wy <= 0) continue;
        for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
          const wx = Math.min(x1, xx + 1) - Math.max(x0, xx);
          if (wx <= 0) continue;
          const k = (yy * image.width + xx) * 3;
          const wgt = wx * wy;
          r += image.data[k] * wgt;
          g += image.data[k + 1] * wgt;
          b += image.data[k + 2] * wgt;
          weight += wgt;
        }
      }
      const o = (y * width + x) * 3;
      out[o] = r / weight;
      out[o + 1] = g / weight;
      out[o + 2] = b / weight;
    }
  }
  return { width, height, data: out };
}

/** Rec. 709 luma in 0..1. */
export function luma(image: RgbImage): Plane {
  const data = new Float32Array(image.width * image.height);
  for (let i = 0; i < data.length; i++)
    data[i] = 0.2126 * image.data[i * 3] + 0.7152 * image.data[i * 3 + 1] + 0.0722 * image.data[i * 3 + 2];
  return { width: image.width, height: image.height, data };
}

/** Sobel gradient magnitude, robust to global brightness and colour shifts. */
export function gradient(plane: Plane): Plane {
  const { width: w, height: h, data: d } = plane;
  const out = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = d[i - w + 1] + 2 * d[i + 1] + d[i + w + 1] - d[i - w - 1] - 2 * d[i - 1] - d[i + w - 1];
      const gy = d[i + w - 1] + 2 * d[i + w] + d[i + w + 1] - d[i - w - 1] - 2 * d[i - w] - d[i - w + 1];
      out[i] = Math.sqrt(gx * gx + gy * gy);
    }
  return { width: w, height: h, data: out };
}

/** Separable box blur with clamped edges, computed with running sums. */
export function boxBlur(plane: Plane, radius: number): Plane {
  if (radius <= 0) return { ...plane, data: plane.data.slice() };
  const { width: w, height: h } = plane;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const size = radius * 2 + 1;
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += plane.data[y * w + clamp(k, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = sum / size;
      sum +=
        plane.data[y * w + clamp(x + radius + 1, 0, w - 1)] - plane.data[y * w + clamp(x - radius, 0, w - 1)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += tmp[clamp(k, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / size;
      sum += tmp[clamp(y + radius + 1, 0, h - 1) * w + x] - tmp[clamp(y - radius, 0, h - 1) * w + x];
    }
  }
  return { width: w, height: h, data: out };
}

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

/** sRGB (0..1) to CIELAB (D65). */
export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const R = linear(r);
  const G = linear(g);
  const B = linear(b);
  const x = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
  const y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
  const z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Interleaved Lab image (L 0..100). */
export function toLab(image: RgbImage): Float32Array {
  const out = new Float32Array(image.width * image.height * 3);
  for (let i = 0; i < image.width * image.height; i++) {
    const [L, a, b] = rgbToLab(image.data[i * 3], image.data[i * 3 + 1], image.data[i * 3 + 2]);
    out[i * 3] = L;
    out[i * 3 + 1] = a;
    out[i * 3 + 2] = b;
  }
  return out;
}

/** Fit an image inside a maximum side length, preserving aspect ratio. */
export function fitSize(width: number, height: number, maxSide: number): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
