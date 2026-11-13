import type { Analysis, Options } from './core/analyze.ts';
import type { Alignment } from './core/align.ts';

export interface RawImage {
  rgba: ArrayBuffer;
  width: number;
  height: number;
}

/** Page → worker. `job` lets the page ignore answers to superseded requests. */
export type WorkerRequest =
  | { type: 'load'; job: number; original: RawImage; edited: RawImage; mask: ArrayBuffer; options: Options }
  | { type: 'analyze'; job: number; mask: ArrayBuffer; options: Options }
  | { type: 'intend'; job: number; ids: number[]; mask: ArrayBuffer; options: Options };

/** Worker → page. */
export type WorkerResponse =
  | { type: 'progress'; job: number; message: string }
  | { type: 'prepared'; job: number; aligned: ArrayBuffer; alignment: Alignment }
  | { type: 'result'; job: number; analysis: Analysis; heatmap: ArrayBuffer; mask: ArrayBuffer }
  | { type: 'error'; job: number; message: string };
