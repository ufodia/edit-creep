import {
  analyze,
  heatmap,
  markIntended,
  prepare,
  toRgba,
  type AnalysisMaps,
  type Options,
  type Prepared,
} from './core/analyze.ts';
import type { WorkerRequest, WorkerResponse } from './protocol.ts';

/** The decoded images stay in the worker; the page receives display buffers and the report. */
let prepared: Prepared | null = null;
let lastMaps: AnalysisMaps | null = null;

const scope = self as unknown as { postMessage(message: WorkerResponse, transfer?: Transferable[]): void };
const post = (message: WorkerResponse, transfer: Transferable[] = []) => scope.postMessage(message, transfer);

function run(job: number, mask: Uint8Array, options: Options) {
  if (!prepared) throw new Error('No images loaded.');
  post({ type: 'progress', job, message: 'Comparing colour and structure…' });
  const { maps, ...analysis } = analyze(prepared, mask, options);
  lastMaps = maps;
  const heat = heatmap(maps, prepared.valid);
  const maskCopy = mask.slice();
  post(
    {
      type: 'result',
      job,
      analysis,
      heatmap: heat.buffer as ArrayBuffer,
      mask: maskCopy.buffer as ArrayBuffer,
    },
    [heat.buffer as ArrayBuffer, maskCopy.buffer as ArrayBuffer],
  );
}

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    if (request.type === 'load') {
      post({ type: 'progress', job: request.job, message: 'Aligning the edited image…' });
      prepared = prepare(
        new Uint8ClampedArray(request.original.rgba),
        request.original.width,
        request.original.height,
        new Uint8ClampedArray(request.edited.rgba),
        request.edited.width,
        request.edited.height,
      );
      const aligned = toRgba(prepared.aligned);
      post(
        {
          type: 'prepared',
          job: request.job,
          aligned: aligned.buffer as ArrayBuffer,
          alignment: prepared.alignment,
        },
        [aligned.buffer as ArrayBuffer],
      );
      run(request.job, new Uint8Array(request.mask), request.options);
    } else if (request.type === 'analyze') {
      run(request.job, new Uint8Array(request.mask), request.options);
    } else if (request.type === 'intend') {
      if (!prepared || !lastMaps) throw new Error('Analyse the images first.');
      const mask = markIntended(
        new Uint8Array(request.mask),
        lastMaps.labels,
        request.ids,
        prepared.width,
        prepared.height,
      );
      run(request.job, mask, request.options);
    }
  } catch (error) {
    post({
      type: 'error',
      job: request.job,
      message:
        error instanceof RangeError
          ? 'These images are too large for this browser tab.'
          : String((error as Error).message || error),
    });
  }
});
