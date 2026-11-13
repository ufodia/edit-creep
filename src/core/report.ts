import type { Analysis } from './analyze.ts';

export interface FileInfo {
  name: string;
  width: number;
  height: number;
}

export const TOOL = { name: 'Edit Creep', version: '1.0.0', url: 'https://github.com/ufodia/edit-creep' };

const round = (value: number, digits = 3) => Number(value.toFixed(digits));

/**
 * A portable JSON report. Region boxes are given both in analysis pixels and
 * in the original image's own pixels, so they can be located in any editor.
 */
export function reportJson(
  analysis: Analysis,
  files: { original: FileInfo; edited: FileInfo },
  now = new Date(),
): string {
  const scaleX = files.original.width / analysis.width;
  const scaleY = files.original.height / analysis.height;
  return (
    JSON.stringify(
      {
        tool: TOOL,
        generatedAt: now.toISOString(),
        files,
        analysisSize: { width: analysis.width, height: analysis.height },
        settings: analysis.options,
        verdict: analysis.verdict,
        summary: {
          regions: analysis.regions.length,
          changedShareOfUntouchedArea: round(analysis.changedFraction, 5),
          intendedShareOfImage: round(analysis.intendedPixels / (analysis.width * analysis.height), 5),
          uncoveredShareOfImage: round(analysis.uncoveredFraction, 5),
        },
        alignment: {
          scale: round(analysis.alignment.scale, 5),
          offsetX: round(analysis.alignment.tx, 2),
          offsetY: round(analysis.alignment.ty, 2),
          overlap: round(analysis.alignment.overlap, 4),
          doubtful: analysis.alignment.doubtful,
        },
        colourDrift: {
          significant: analysis.tone.significant,
          deltaE: round(analysis.tone.shift, 2),
          gain: analysis.tone.gain.map((g) => round(g, 4)),
          offset: analysis.tone.offset.map((o) => round(o, 4)),
          compensated: analysis.options.compensateTone,
        },
        noise: { deltaE: round(analysis.noise.deltaE, 2), dssim: round(analysis.noise.dssim, 4) },
        regions: analysis.regions.map((r) => ({
          id: r.id,
          kind: r.kind,
          severity: r.severity,
          areaShareOfImage: round(r.area, 5),
          meanDeltaE: round(r.meanDeltaE, 2),
          meanDssim: round(r.meanDssim, 4),
          peak: round(r.peak, 2),
          box: { x: r.x, y: r.y, width: r.width, height: r.height },
          boxInOriginal: {
            x: Math.floor(r.x * scaleX),
            y: Math.floor(r.y * scaleY),
            width: Math.ceil((r.x + r.width) * scaleX) - Math.floor(r.x * scaleX),
            height: Math.ceil((r.y + r.height) * scaleY) - Math.floor(r.y * scaleY),
          },
        })),
      },
      null,
      2,
    ) + '\n'
  );
}
