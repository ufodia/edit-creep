/** Procedural test scenes: a continuous picture that can be rendered at any scale and offset. */

export type Color = [number, number, number];
export type Scene = (x: number, y: number) => Color;

/** Coordinates are in original-image pixels of a 200×150 frame. */
export const baseScene: Scene = (x, y) => {
  // Soft background gradient.
  let c: Color = [0.85 - y * 0.001, 0.82 - x * 0.0008, 0.75];
  // A "product" block with a label and a "logo".
  if (x > 70 && x < 130 && y > 30 && y < 120) c = [0.18, 0.31, 0.27];
  if (x > 78 && x < 122 && y > 60 && y < 95) c = [0.95, 0.92, 0.85];
  if ((x - 100) ** 2 + (y - 45) ** 2 < 49) c = [0.78, 0.33, 0.24];
  // Text-like stripes inside the label.
  if (
    x > 82 &&
    x < 118 &&
    y > 66 &&
    y < 89 &&
    Math.floor((y - 66) / 3) % 2 === 0 &&
    Math.floor(x / 2) % 3 !== 0
  )
    c = [0.2, 0.2, 0.22];
  // A plant on the left (the area users will mark as intended).
  if ((x - 35) ** 2 / 300 + (y - 80) ** 2 / 900 < 1) c = [0.25, 0.55, 0.3];
  // A picture frame top right.
  if (x > 150 && x < 185 && y > 15 && y < 45)
    c = x < 154 || x > 181 || y < 19 || y > 41 ? [0.35, 0.25, 0.2] : [0.4, 0.6, 0.8];
  return c;
};

export function render(
  scene: Scene,
  width: number,
  height: number,
  map = (u: number, v: number) => [u, v] as const,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let v = 0; v < height; v++)
    for (let u = 0; u < width; u++) {
      const sum = [0, 0, 0];
      // 3×3 supersampling for anti-aliased edges.
      for (let sy = 0; sy < 3; sy++)
        for (let sx = 0; sx < 3; sx++) {
          const [x, y] = map(u + (sx + 0.5) / 3 - 0.5, v + (sy + 0.5) / 3 - 0.5);
          const c = scene(x, y);
          sum[0] += c[0];
          sum[1] += c[1];
          sum[2] += c[2];
        }
      const o = (v * width + u) * 4;
      out[o] = (sum[0] / 9) * 255;
      out[o + 1] = (sum[1] / 9) * 255;
      out[o + 2] = (sum[2] / 9) * 255;
      out[o + 3] = 255;
    }
  return out;
}

/** Deterministic pseudo-random noise, like re-encoding by a generative model. */
export function addNoise(rgba: Uint8ClampedArray, amplitude: number, seed = 7): Uint8ClampedArray {
  const out = rgba.slice();
  let s = seed;
  for (let i = 0; i < out.length; i++) {
    if (i % 4 === 3) continue;
    s = (s * 1664525 + 1013904223) >>> 0;
    out[i] = out[i] + ((s / 2 ** 32) * 2 - 1) * amplitude;
  }
  return out;
}

export function rectMask(
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask[y * width + x] = 1;
  return mask;
}
