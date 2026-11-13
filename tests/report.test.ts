import { describe, expect, it } from 'vitest';
import { analyze, prepare } from '../src/core/analyze.ts';
import { reportJson } from '../src/core/report.ts';
import { baseScene, render } from './scene.ts';

describe('original-coordinate report boxes', () => {
  const rgba = render(baseScene, 200, 150);
  const analysis = analyze(prepare(rgba, 200, 150, rgba, 200, 150), new Uint8Array(200 * 150));

  it('maps each axis independently after aspect-ratio rounding and covers the detected box', () => {
    const region = {
      id: 1,
      x: 13,
      y: 17,
      width: 19,
      height: 21,
      area: 0.01,
      pixels: 399,
      meanDeltaE: 10,
      meanDssim: 0.2,
      peak: 3,
      kind: 'content' as const,
      severity: 'major' as const,
    };
    const report = JSON.parse(
      reportJson(
        { ...analysis, regions: [region] },
        {
          original: { name: 'original.png', width: 1001, height: 752 },
          edited: { name: 'edited.png', width: 1001, height: 752 },
        },
      ),
    );
    expect(report.regions[0].boxInOriginal).toEqual({ x: 65, y: 85, width: 96, height: 106 });
  });

  it('keeps a box that touches the analysis boundary inside the original image', () => {
    const region = {
      id: 1,
      x: 199,
      y: 149,
      width: 1,
      height: 1,
      area: 0.001,
      pixels: 1,
      meanDeltaE: 10,
      meanDssim: 0.2,
      peak: 3,
      kind: 'content' as const,
      severity: 'minor' as const,
    };
    const report = JSON.parse(
      reportJson(
        { ...analysis, regions: [region] },
        {
          original: { name: 'original.png', width: 1001, height: 752 },
          edited: { name: 'edited.png', width: 1001, height: 752 },
        },
      ),
    );
    const box = report.regions[0].boxInOriginal;
    expect(box.x + box.width).toBe(1001);
    expect(box.y + box.height).toBe(752);
  });
});
