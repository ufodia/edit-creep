/** Binary morphology and connected components on Uint8 masks (1 = set). */

/** Square dilation with radius `r`, computed with running counts (O(n)). */
export function dilate(mask: Uint8Array, width: number, height: number, r: number): Uint8Array {
  if (r <= 0) return mask.slice();
  return boxCount(mask, width, height, r, (count) => count > 0);
}

/** Square erosion with radius `r`; pixels near the border erode. */
export function erode(mask: Uint8Array, width: number, height: number, r: number): Uint8Array {
  if (r <= 0) return mask.slice();
  const full = (2 * r + 1) ** 2;
  return boxCount(mask, width, height, r, (count) => count === full);
}

/** Closing (dilate then erode) joins fragments of one change into one region. */
export function close(mask: Uint8Array, width: number, height: number, r: number): Uint8Array {
  return erode(dilate(mask, width, height, r), width, height, r);
}

function boxCount(
  mask: Uint8Array,
  width: number,
  height: number,
  r: number,
  keep: (count: number) => boolean,
): Uint8Array {
  const rows = new Uint16Array(width * height);
  for (let y = 0; y < height; y++) {
    let count = 0;
    for (let x = -r; x <= r; x++) if (x >= 0 && x < width) count += mask[y * width + x];
    for (let x = 0; x < width; x++) {
      rows[y * width + x] = count;
      const add = x + r + 1;
      const remove = x - r;
      if (add < width) count += mask[y * width + add];
      if (remove >= 0) count -= mask[y * width + remove];
    }
  }
  const out = new Uint8Array(width * height);
  for (let x = 0; x < width; x++) {
    let count = 0;
    for (let y = -r; y <= r; y++) if (y >= 0 && y < height) count += rows[y * width + x];
    for (let y = 0; y < height; y++) {
      out[y * width + x] = keep(count) ? 1 : 0;
      const add = y + r + 1;
      const remove = y - r;
      if (add < height) count += rows[add * width + x];
      if (remove >= 0) count -= rows[remove * width + x];
    }
  }
  return out;
}

export interface Component {
  id: number;
  pixels: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 8-connected component labelling. Returns labels (0 = background) and component boxes. */
export function components(
  mask: Uint8Array,
  width: number,
  height: number,
): { labels: Int32Array; list: Component[] } {
  const labels = new Int32Array(width * height);
  const list: Component[] = [];
  const stack = new Int32Array(width * height);
  let next = 0;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue;
    next++;
    const c: Component = { id: next, pixels: 0, x0: width, y0: height, x1: 0, y1: 0 };
    let top = 0;
    stack[top++] = start;
    labels[start] = next;
    while (top) {
      const i = stack[--top];
      const x = i % width;
      const y = (i - x) / width;
      c.pixels++;
      if (x < c.x0) c.x0 = x;
      if (x > c.x1) c.x1 = x;
      if (y < c.y0) c.y0 = y;
      if (y > c.y1) c.y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const j = ny * width + nx;
          if (mask[j] && !labels[j]) {
            labels[j] = next;
            stack[top++] = j;
          }
        }
      }
    }
    list.push(c);
  }
  return { labels, list };
}
