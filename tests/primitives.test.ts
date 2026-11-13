import { describe, expect, it } from 'vitest';
import { boxBlur, fitSize, fromRgba, resize, rgbToLab, toRgba } from '../src/core/image.ts';
import { close, components, dilate, erode } from '../src/core/regions.ts';
import { compensate, fitTone } from '../src/core/tone.ts';

describe('image primitives', () => {
  it('converts sRGB to CIELAB', () => {
    const white = rgbToLab(1, 1, 1);
    expect(white[0]).toBeCloseTo(100, 1);
    expect(Math.abs(white[1])).toBeLessThan(0.01);
    const red = rgbToLab(1, 0, 0);
    expect(red[0]).toBeCloseTo(53.24, 1);
    expect(red[1]).toBeCloseTo(80.09, 0);
  });

  it('composites transparent pixels on white and round-trips', () => {
    const rgba = new Uint8ClampedArray([255, 0, 0, 0, 0, 0, 255, 255]);
    const image = fromRgba(rgba, 2, 1);
    expect([...image.data.slice(0, 3)]).toEqual([1, 1, 1]);
    expect([...toRgba(image)]).toEqual([255, 255, 255, 255, 0, 0, 255, 255]);
  });

  it('resizes by area averaging and fits sizes', () => {
    const image = fromRgba(new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]), 2, 1);
    expect(resize(image, 1, 1).data[0]).toBeCloseTo(0.5, 5);
    expect(fitSize(4000, 3000, 1024)).toEqual({ width: 1024, height: 768 });
    expect(fitSize(300, 200, 1024)).toEqual({ width: 300, height: 200 });
  });

  it('box blur keeps the mean of a constant plane', () => {
    const plane = { width: 5, height: 5, data: new Float32Array(25).fill(0.4) };
    expect(boxBlur(plane, 2).data.every((v) => Math.abs(v - 0.4) < 1e-6)).toBe(true);
  });
});

describe('morphology and components', () => {
  const w = 7;
  const h = 7;
  const dot = new Uint8Array(w * h);
  dot[3 * w + 3] = 1;

  it('dilates and erodes symmetrically', () => {
    const grown = dilate(dot, w, h, 1);
    expect(grown.reduce((a, b) => a + b, 0)).toBe(9);
    expect(erode(grown, w, h, 1).reduce((a, b) => a + b, 0)).toBe(1);
  });

  it('closing joins nearby fragments', () => {
    const two = new Uint8Array(w * h);
    two[3 * w + 2] = 1;
    two[3 * w + 4] = 1;
    expect(components(two, w, h).list).toHaveLength(2);
    expect(components(close(two, w, h, 1), w, h).list).toHaveLength(1);
  });

  it('labels 8-connected components with bounding boxes', () => {
    const mask = new Uint8Array(w * h);
    mask[0] = 1;
    mask[w + 1] = 1;
    mask[6 * w + 6] = 1;
    const { list, labels } = components(mask, w, h);
    expect(list.map((c) => c.pixels)).toEqual([2, 1]);
    expect(list[0]).toMatchObject({ x0: 0, y0: 0, x1: 1, y1: 1 });
    expect(labels[w + 1]).toBe(1);
  });
});

describe('tone fitting', () => {
  it('recovers a per-channel gain and offset and undoes it', () => {
    const n = 400;
    const data = new Float32Array(n * 3);
    for (let i = 0; i < data.length; i++) data[i] = ((i * 37) % 97) / 120;
    const orig = { width: 20, height: 20, data };
    const shifted = { width: 20, height: 20, data: data.map((v, i) => (i % 3 === 0 ? v * 1.1 + 0.02 : v)) };
    const fit = fitTone(orig, shifted, () => true);
    expect(fit.gain[0]).toBeCloseTo(1.1, 2);
    expect(fit.offset[0]).toBeCloseTo(0.02, 2);
    expect(fit.significant).toBe(true);
    const back = compensate(shifted, fit);
    expect(Math.abs(back.data[30] - data[30])).toBeLessThan(1e-3);
  });

  it('is neutral when there is nothing to fit', () => {
    const image = { width: 2, height: 2, data: new Float32Array(12) };
    expect(fitTone(image, image, () => false)).toMatchObject({ gain: [1, 1, 1], significant: false });
  });
});
