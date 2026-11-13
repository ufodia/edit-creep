import { describe, expect, it } from 'vitest';
import { analyze, DEFAULT_OPTIONS, heatmap, markIntended, prepare } from '../src/core/analyze.ts';
import { addNoise, baseScene, rectMask, render, type Scene } from './scene.ts';

const W = 200;
const H = 150;
const original = render(baseScene, W, H);
const empty = new Uint8Array(W * H);
const plantMask = rectMask(W, H, 12, 45, 60, 118);

const run = (edit: Uint8ClampedArray, mask: Uint8Array = empty, options = DEFAULT_OPTIONS, ew = W, eh = H) =>
  analyze(prepare(original, W, H, edit, ew, eh), mask, options);

/** The "intended" edit: the plant becomes a lamp. */
const withLamp: Scene = (x, y) => {
  if (x > 30 && x < 40 && y > 60 && y < 115) return [0.3, 0.3, 0.32];
  if (x > 20 && x < 50 && y > 50 && y < 62) return [0.98, 0.85, 0.5];
  if ((x - 35) ** 2 / 300 + (y - 80) ** 2 / 900 < 1) return baseScene(200, 150);
  return baseScene(x, y);
};

describe('identical and noisy images', () => {
  it('reports a clean result for an identical copy', () => {
    const result = run(original.slice());
    expect(result.alignment).toMatchObject({ scale: 1, tx: 0, ty: 0 });
    expect(result.verdict).toBe('clean');
    expect(result.regions).toEqual([]);
    expect(result.tone.significant).toBe(false);
  });

  it('ignores re-encoding noise', () => {
    const result = run(addNoise(original, 4));
    expect(result.verdict).toBe('clean');
    expect(result.noise.deltaE).toBeGreaterThan(0);
  });
});

describe('intended versus unintended changes', () => {
  it('flags the intended edit when no mask is drawn', () => {
    const result = run(render(withLamp, W, H));
    expect(result.regions.length).toBeGreaterThan(0);
    const first = result.regions[0];
    expect(first.x).toBeLessThan(40);
    expect(first.x + first.width).toBeGreaterThan(30);
  });

  it('ignores changes inside the marked area', () => {
    const result = run(render(withLamp, W, H), plantMask);
    expect(result.verdict).toBe('clean');
  });

  it('finds a recoloured logo outside the mask and classifies it as colour', () => {
    const scene: Scene = (x, y) =>
      (x - 100) ** 2 + (y - 45) ** 2 < 49 ? [0.85, 0.55, 0.15] : withLamp(x, y);
    const result = run(render(scene, W, H), plantMask);
    expect(result.regions).toHaveLength(1);
    const logo = result.regions[0];
    expect(logo.x).toBeGreaterThanOrEqual(90);
    expect(logo.x + logo.width).toBeLessThanOrEqual(112);
    expect(logo.kind).toBe('color');
    expect(result.verdict).not.toBe('clean');
  });

  it('finds changed label text as a detail change', () => {
    const scene: Scene = (x, y) =>
      x > 82 && x < 118 && y > 66 && y < 89
        ? Math.floor((y - 66) / 3) % 2 === 0 && Math.floor(x / 2) % 2 === 0
          ? [0.2, 0.2, 0.22]
          : [0.95, 0.92, 0.85]
        : withLamp(x, y);
    const result = run(render(scene, W, H), plantMask);
    expect(result.regions.length).toBeGreaterThanOrEqual(1);
    const label = result.regions[0];
    expect(label.x).toBeGreaterThanOrEqual(76);
    expect(label.kind).not.toBe('color');
  });

  it('can mark a region as intended and re-analyse cleanly', () => {
    const scene: Scene = (x, y) =>
      (x - 100) ** 2 + (y - 45) ** 2 < 49 ? [0.85, 0.55, 0.15] : withLamp(x, y);
    const prepared = prepare(original, W, H, render(scene, W, H), W, H);
    const first = analyze(prepared, plantMask);
    const mask = markIntended(plantMask, first.maps.labels, [1], W, H);
    expect(analyze(prepared, mask).verdict).toBe('clean');
  });
});

describe('global tone drift', () => {
  const warmer = (() => {
    const out = original.slice();
    for (let i = 0; i < out.length; i += 4) {
      out[i] = Math.min(255, out[i] * 1.08 + 6);
      out[i + 2] = out[i + 2] * 0.92;
    }
    return out;
  })();

  it('is reported but compensated before local comparison', () => {
    const result = run(warmer);
    expect(result.tone.significant).toBe(true);
    expect(result.tone.shift).toBeGreaterThan(2);
    expect(result.verdict).toBe('clean');
  });

  it('shows up everywhere when compensation is off', () => {
    const result = run(warmer, empty, { ...DEFAULT_OPTIONS, compensateTone: false });
    expect(result.changedFraction).toBeGreaterThan(0.3);
  });
});

describe('alignment', () => {
  it('rejects extreme aspect changes before starting an unbounded translation search', () => {
    expect(() =>
      prepare(new Uint8ClampedArray(128 * 32 * 4), 128, 32, new Uint8ClampedArray(32 * 128 * 4), 32, 128),
    ).toThrow('aspect ratios');
  });

  it('rejects extreme size differences instead of searching huge translation ranges', () => {
    expect(() =>
      prepare(new Uint8ClampedArray(4), 1, 1, new Uint8ClampedArray(1024 * 1024 * 4), 1024, 1024),
    ).toThrow('image sizes');
  });

  it('recovers a resized and shifted edit', () => {
    const s = 0.94;
    const tx = 3;
    const ty = 2;
    const ew = 190;
    const eh = 143;
    const edit = render(baseScene, ew, eh, (u, v) => [(u - tx) / s, (v - ty) / s] as const);
    const result = run(edit, empty, DEFAULT_OPTIONS, ew, eh);
    expect(result.alignment.scale).toBeCloseTo(s, 1);
    expect(Math.abs(result.alignment.scale - s)).toBeLessThan(0.01);
    expect(Math.abs(result.alignment.tx - tx)).toBeLessThan(1.6);
    expect(Math.abs(result.alignment.ty - ty)).toBeLessThan(1.6);
    expect(result.alignment.doubtful).toBe(false);
    expect(['clean', 'minor']).toContain(result.verdict);
  });

  it('handles an upscaled edit without aliasing false alarms', () => {
    const s = 1.5;
    const edit = render(baseScene, 300, 225, (u, v) => [u / s, v / s] as const);
    const result = run(edit, empty, DEFAULT_OPTIONS, 300, 225);
    expect(Math.abs(result.alignment.scale - s)).toBeLessThan(0.02);
    expect(['clean', 'minor']).toContain(result.verdict);
  });

  it('marks unrelated images as doubtful', () => {
    const other: Scene = (x, y) =>
      Math.floor(x / 9) % 2 === Math.floor(y / 13) % 2 ? [0.1, 0.1, 0.1] : [0.9, 0.9, 0.9];
    const result = run(render(other, W, H));
    expect(result.alignment.doubtful).toBe(true);
  });
});

describe('heatmap', () => {
  it('is transparent where nothing changed and tints the intended area', () => {
    const result = run(render(withLamp, W, H), plantMask);
    const prepared = prepare(original, W, H, render(withLamp, W, H), W, H);
    const rgba = heatmap(result.maps, prepared.valid);
    expect(rgba.length).toBe(W * H * 4);
    const corner = (5 * W + 195) * 4;
    expect(rgba[corner + 3]).toBe(0);
    const inside = (80 * W + 35) * 4;
    expect(rgba[inside + 1]).toBe(242);
  });
});

describe('performance', () => {
  it('analyses a 1024 × 768 pair in a few seconds', () => {
    const big = (u: number, v: number) => [u / 5.12, v / 5.12] as const;
    const a = render(baseScene, 1024, 768, big);
    const b = addNoise(a, 3);
    const started = performance.now();
    const result = analyze(prepare(a, 1024, 768, b, 1024, 768), new Uint8Array(1024 * 768));
    expect(result.verdict).toBe('clean');
    expect(performance.now() - started).toBeLessThan(8000);
  });
});

describe('region grouping', () => {
  it('merges the two crescents of a moved object into one region', () => {
    const moved: Scene = (x, y) => {
      if ((x - 168) ** 2 + (y - 30) ** 2 < 36) return [0.9, 0.3, 0.2];
      return withLamp(x, y);
    };
    const shifted: Scene = (x, y) => {
      if ((x - 172) ** 2 + (y - 27) ** 2 < 36) return [0.9, 0.3, 0.2];
      return withLamp(x, y);
    };
    const prepared = prepare(render(moved, W, H), W, H, render(shifted, W, H), W, H);
    const result = analyze(prepared, plantMask);
    expect(result.regions).toHaveLength(1);
    expect(result.maps.labels.some((label) => label === 1)).toBe(true);
  });
});
