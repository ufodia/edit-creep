import './style.css';
import {
  DEFAULT_OPTIONS,
  THRESHOLDS,
  type Analysis,
  type Options,
  type Region,
  type Sensitivity,
} from './core/analyze.ts';
import { fitSize } from './core/image.ts';
import { reportJson } from './core/report.ts';
import { demoPair } from './demo.ts';
import { byId, download, h } from './dom.ts';
import type { WorkerRequest, WorkerResponse } from './protocol.ts';

/** Analysis resolution: the longer side of the original is scaled to this. */
const MAX_SIDE = 1024;
const MAX_FILE_BYTES = 80 * 1024 * 1024;

type Mode = 'swipe' | 'heatmap' | 'onion' | 'original' | 'edited';
type Tool = 'brush' | 'erase' | 'rect';

interface Loaded {
  name: string;
  canvas: HTMLCanvasElement;
  naturalWidth: number;
  naturalHeight: number;
}

const MODES: { id: Mode; label: string }[] = [
  { id: 'swipe', label: 'Swipe' },
  { id: 'heatmap', label: 'Heatmap' },
  { id: 'onion', label: 'Onion skin' },
  { id: 'original', label: 'Original' },
  { id: 'edited', label: 'Edited' },
];

const VERDICT = {
  clean: {
    title: 'No changes detected',
    text: 'No differences met the detection thresholds outside the marked area. Check important details yourself.',
  },
  minor: {
    title: 'Minor unintended changes',
    text: 'Small differences outside your edit. Check them before you publish.',
  },
  notable: {
    title: 'Notable unintended changes',
    text: 'The edit changed things you did not ask for. Review each region.',
  },
  major: {
    title: 'Major unintended changes',
    text: 'Large or strong changes outside your edit. Compare carefully before using this image.',
  },
} as const;

const KIND = {
  color: 'Colour changed',
  detail: 'Detail or text changed',
  content: 'Content changed',
} as const;

let worker: Worker | null = null;
let job = 0;
let original: Loaded | null = null;
let edited: Loaded | null = null;
let W = 0;
let H = 0;
let originalCanvas: HTMLCanvasElement | null = null;
let alignedCanvas: HTMLCanvasElement | null = null;
let heatCanvas: HTMLCanvasElement | null = null;
let maskCanvas: HTMLCanvasElement | null = null;
let analysis: Analysis | null = null;
let options: Options = { ...DEFAULT_OPTIONS };
let mode: Mode = 'swipe';
let tool: Tool = 'brush';
let brush = 36;
let split = 0.5;
let onion = 0.5;
let showMask = true;
let selected: number | null = null;
let busy = false;
let analyzeTimer = 0;
let workspaceBuilt = false;
let loadGeneration = 0;
const loadIds = { original: 0, edited: 0 };

const intro = byId('intro');
const progress = byId('progress');
const workspace = byId('workspace');
const introError = byId('intro-error');

// ——— Worker ———

function getWorker(): Worker {
  if (worker) return worker;
  const engine = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker = engine;
  engine.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
    if (worker === engine) onMessage(event.data);
  });
  const stopped = () => {
    if (worker !== engine) return;
    reset();
    fail('The comparison engine stopped unexpectedly. Choose the images again to start a new comparison.');
  };
  engine.addEventListener('error', stopped);
  engine.addEventListener('messageerror', stopped);
  return engine;
}

function send(request: WorkerRequest, transfer: Transferable[] = []) {
  try {
    getWorker().postMessage(request, transfer);
  } catch {
    reset();
    fail('The comparison engine could not start. Try a current browser with Web Worker support.');
  }
}

function stopWorker() {
  worker?.terminate();
  worker = null;
  job++;
}

function onMessage(message: WorkerResponse) {
  if (message.job !== job) return;
  if (message.type === 'progress') {
    byId('progress-message').textContent = message.message;
    setBusy(true, message.message);
  } else if (message.type === 'prepared') {
    alignedCanvas = canvasFrom(new Uint8ClampedArray(message.aligned), W, H);
  } else if (message.type === 'result') {
    analysis = message.analysis;
    heatCanvas = canvasFrom(new Uint8ClampedArray(message.heatmap), W, H);
    paintMask(new Uint8Array(message.mask));
    if (selected && !analysis.regions.some((r) => r.id === selected)) selected = null;
    setBusy(false);
    showView('workspace');
    if (!workspaceBuilt) buildWorkspace();
    renderPanel();
    draw();
  } else if (message.type === 'error') {
    fail(message.message);
  }
}

function canvasFrom(rgba: Uint8ClampedArray, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas
    .getContext('2d')!
    .putImageData(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);
  return canvas;
}

function showView(view: 'intro' | 'progress' | 'workspace') {
  intro.hidden = view !== 'intro';
  progress.hidden = view !== 'progress';
  workspace.hidden = view !== 'workspace';
  document.body.dataset.view = view;
}

function fail(message: string) {
  setBusy(false);
  if (analysis) {
    toast(message);
    showView('workspace');
  } else {
    showView('intro');
    introError.textContent = message;
    introError.hidden = false;
  }
}

function toast(message: string) {
  const note = h('div', { class: 'toast', role: 'status' }, message);
  document.body.append(note);
  setTimeout(() => note.remove(), 4200);
}

function setBusy(state: boolean, message = 'Analysing…') {
  busy = state;
  const badge = document.getElementById('busy');
  if (badge) {
    badge.hidden = !state;
    badge.textContent = message;
  }
  workspace.setAttribute('aria-busy', String(state));
  for (const button of workspace.querySelectorAll<HTMLButtonElement>(
    '.exports button, .region-actions button',
  ))
    button.disabled = state;
}

// ——— Loading images ———

async function decode(file: Blob, name: string): Promise<Loaded> {
  if (file.size > MAX_FILE_BYTES) throw new Error(`${name} is larger than 80 MB.`);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(`${name} could not be decoded. Use PNG, JPEG, WebP, AVIF or GIF.`);
  }
  try {
    const canvas = toCanvas(bitmap, bitmap.width, bitmap.height);
    return { name, canvas, naturalWidth: bitmap.width, naturalHeight: bitmap.height };
  } finally {
    bitmap.close();
  }
}

function toCanvas(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const size = fitSize(width, height, MAX_SIDE);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  // Display the same white composite that the comparison engine measures.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.drawImage(source, 0, 0, size.width, size.height);
  return canvas;
}

function showSlot(which: 'original' | 'edited', loaded: Loaded) {
  const slot = byId(`slot-${which}`);
  slot.classList.add('filled');
  slot.querySelector('.slot-thumb')?.remove();
  const thumb = h('img', { class: 'slot-thumb', alt: '', src: loaded.canvas.toDataURL('image/jpeg', 0.7) });
  slot.prepend(thumb);
  byId(`name-${which}`).textContent = `${loaded.name} · ${loaded.naturalWidth} × ${loaded.naturalHeight}`;
}

async function choose(which: 'original' | 'edited', file: File) {
  const generation = loadGeneration;
  const id = ++loadIds[which];
  introError.hidden = true;
  try {
    const loaded = await decode(file, file.name);
    if (generation !== loadGeneration || id !== loadIds[which]) return;
    if (which === 'original') original = loaded;
    else edited = loaded;
    showSlot(which, loaded);
    if (original && edited) start();
  } catch (error) {
    if (generation !== loadGeneration || id !== loadIds[which]) return;
    fail((error as Error).message);
  }
}

function imageData(canvas: HTMLCanvasElement) {
  return canvas
    .getContext('2d', { willReadFrequently: true })!
    .getImageData(0, 0, canvas.width, canvas.height);
}

function start(intended?: { x: number; y: number; width: number; height: number }) {
  if (!original || !edited) return;
  clearTimeout(analyzeTimer);
  stopWorker();
  analysis = null;
  alignedCanvas = null;
  heatCanvas = null;
  selected = null;
  workspaceBuilt = false;
  workspace.replaceChildren();
  W = original.canvas.width;
  H = original.canvas.height;
  originalCanvas = original.canvas;
  maskCanvas = document.createElement('canvas');
  maskCanvas.width = W;
  maskCanvas.height = H;
  if (intended) {
    const ctx = maskCanvas.getContext('2d')!;
    ctx.fillStyle = '#7cf2c8';
    const sx = W / original.naturalWidth;
    const sy = H / original.naturalHeight;
    ctx.fillRect(intended.x * sx, intended.y * sy, intended.width * sx, intended.height * sy);
  }
  const a = imageData(original.canvas);
  const b = imageData(edited.canvas);
  const mask = readMask();
  showView('progress');
  setBusy(true);
  byId('progress-message').textContent = 'Aligning the edited image…';
  send(
    {
      type: 'load',
      job: ++job,
      original: { rgba: a.data.buffer as ArrayBuffer, width: a.width, height: a.height },
      edited: { rgba: b.data.buffer as ArrayBuffer, width: b.width, height: b.height },
      mask: mask.buffer,
      options,
    },
    [a.data.buffer as ArrayBuffer, b.data.buffer as ArrayBuffer, mask.buffer],
  );
}

function readMask(): Uint8Array<ArrayBuffer> {
  const data = maskCanvas!.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4 + 3] > 40 ? 1 : 0;
  return mask;
}

function paintMask(mask: Uint8Array) {
  const image = new ImageData(W, H);
  for (let i = 0; i < mask.length; i++)
    if (mask[i]) {
      image.data[i * 4] = 124;
      image.data[i * 4 + 1] = 242;
      image.data[i * 4 + 2] = 200;
      image.data[i * 4 + 3] = 255;
    }
  maskCanvas!.getContext('2d')!.putImageData(image, 0, 0);
}

function reanalyze(delay = 0) {
  clearTimeout(analyzeTimer);
  const nextJob = ++job;
  setBusy(true, 'Re-analysing…');
  analyzeTimer = window.setTimeout(() => {
    if (nextJob !== job || !maskCanvas || !original || !edited) return;
    const mask = readMask();
    send({ type: 'analyze', job: nextJob, mask: mask.buffer, options }, [mask.buffer]);
  }, delay);
}

function markIntended(ids: number[]) {
  if (busy || !analysis) return;
  clearTimeout(analyzeTimer);
  const mask = readMask();
  setBusy(true, 'Marking as intended…');
  send({ type: 'intend', job: ++job, ids, mask: mask.buffer, options }, [mask.buffer]);
}

// ——— Intro wiring ———

for (const which of ['original', 'edited'] as const) {
  const input = byId<HTMLInputElement>(`file-${which}`);
  input.addEventListener('change', () => {
    if (input.files?.[0]) void choose(which, input.files[0]);
    input.value = '';
  });
  const slot = byId(`slot-${which}`);
  slot.addEventListener('dragover', (event) => {
    event.preventDefault();
    slot.classList.add('over');
  });
  slot.addEventListener('dragleave', () => slot.classList.remove('over'));
  slot.addEventListener('drop', (event) => {
    event.preventDefault();
    event.stopPropagation();
    slot.classList.remove('over');
    const file = event.dataTransfer?.files[0];
    if (file) void choose(which, file);
  });
}
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => {
  event.preventDefault();
  const files = [...(event.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/'));
  if (files.length >= 2) {
    void (async () => {
      await choose('original', files[0]);
      await choose('edited', files[1]);
    })();
  } else if (files.length === 1) void choose(original ? 'edited' : 'original', files[0]);
});

byId('demo-button').addEventListener('click', () => {
  loadGeneration++;
  const pair = demoPair();
  original = {
    name: 'demo-original.png',
    canvas: toCanvas(pair.original, pair.original.width, pair.original.height),
    naturalWidth: pair.original.width,
    naturalHeight: pair.original.height,
  };
  edited = {
    name: 'demo-ai-edit.png',
    canvas: toCanvas(pair.edited, pair.edited.width, pair.edited.height),
    naturalWidth: pair.edited.width,
    naturalHeight: pair.edited.height,
  };
  showSlot('original', original);
  showSlot('edited', edited);
  start(pair.intended);
});

// ——— Workspace ———

let stage: HTMLCanvasElement;
let rangeInput: HTMLInputElement;
let rangeLabel: HTMLElement;
let panel: HTMLElement;

function buildWorkspace() {
  workspaceBuilt = true;
  stage = h('canvas', {
    id: 'stage',
    width: W,
    height: H,
    'aria-label': 'Comparison canvas. Paint to mark the area you asked to change.',
    role: 'img',
  });
  const modebar = h('div', { class: 'modebar', role: 'tablist', 'aria-label': 'View' });
  for (const m of MODES)
    modebar.append(
      h(
        'button',
        {
          type: 'button',
          role: 'tab',
          class: 'mode',
          'data-mode': m.id,
          'aria-selected': String(m.id === mode),
          tabindex: m.id === mode ? 0 : -1,
          onclick: () => setMode(m.id),
        },
        m.label,
      ),
    );
  modebar.addEventListener('keydown', (event) => {
    const index = MODES.findIndex((m) => m.id === mode);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? MODES.length - 1
          : event.key === 'ArrowRight'
            ? (index + 1) % MODES.length
            : event.key === 'ArrowLeft'
              ? (index + MODES.length - 1) % MODES.length
              : -1;
    if (next < 0) return;
    event.preventDefault();
    setMode(MODES[next].id);
    modebar.querySelector<HTMLButtonElement>(`[data-mode="${mode}"]`)?.focus();
  });

  rangeLabel = h('label', { for: 'view-range', class: 'range-label' }, 'Swipe');
  rangeInput = h('input', { id: 'view-range', type: 'range', min: 0, max: 100, value: 50 });
  rangeInput.addEventListener('input', () => {
    if (mode === 'onion') onion = Number(rangeInput.value) / 100;
    else split = Number(rangeInput.value) / 100;
    draw();
  });

  const toolButton = (id: Tool, label: string, icon: string) =>
    h(
      'button',
      {
        type: 'button',
        class: 'tool',
        'data-tool': id,
        'aria-pressed': String(tool === id),
        title: label,
        onclick: () => setTool(id),
      },
      h('span', { 'aria-hidden': 'true' }, icon),
      label,
    );
  const size = h('input', {
    id: 'brush-size',
    type: 'range',
    min: 6,
    max: 120,
    value: brush,
    'aria-label': 'Brush size',
  });
  size.addEventListener('input', () => (brush = Number(size.value)));
  const maskToggle = h('input', { id: 'show-mask', type: 'checkbox', checked: showMask });
  maskToggle.addEventListener('change', () => {
    showMask = maskToggle.checked;
    draw();
  });

  const controls = h(
    'div',
    { class: 'controls' },
    h('div', { class: 'control-group' }, rangeLabel, rangeInput),
    h(
      'div',
      { class: 'control-group tools', role: 'group', 'aria-label': 'Mark the intended area' },
      toolButton('brush', 'Paint', '✎'),
      toolButton('rect', 'Box', '▭'),
      toolButton('erase', 'Erase', '⌫'),
      h('label', { class: 'size' }, 'Size', size),
      h('button', { type: 'button', class: 'tool', onclick: () => clearMask() }, 'Clear'),
      h('label', { class: 'check' }, maskToggle, 'Show intended area'),
    ),
  );

  const head = h(
    'div',
    { class: 'ws-head' },
    h(
      'div',
      {},
      h('p', { class: 'eyebrow' }, 'Comparison'),
      h('h1', {}, `${original!.name} → ${edited!.name}`),
    ),
    h(
      'div',
      { class: 'ws-actions' },
      h('span', { id: 'busy', class: 'busy', hidden: true }, 'Analysing…'),
      h('button', { class: 'button ghost small', type: 'button', onclick: () => reset() }, 'New comparison'),
    ),
  );

  panel = h('aside', { class: 'panel', 'aria-label': 'Results' });
  const viewer = h(
    'div',
    { class: 'viewer' },
    modebar,
    h('div', { class: 'stage-wrap' }, stage),
    controls,
    h(
      'p',
      { class: 'hint' },
      'Paint or draw a box over the area you asked the AI to change. Comparable pixels outside it are checked at the selected sensitivity.',
    ),
  );
  workspace.replaceChildren(head, h('div', { class: 'ws-grid' }, viewer, panel));
  wireStage();
  setMode(mode);
}

function setMode(next: Mode) {
  mode = next;
  for (const button of workspace.querySelectorAll<HTMLButtonElement>('.mode')) {
    button.setAttribute('aria-selected', String(button.dataset.mode === mode));
    button.tabIndex = button.dataset.mode === mode ? 0 : -1;
  }
  const usesRange = mode === 'swipe' || mode === 'onion';
  rangeInput.disabled = !usesRange;
  rangeLabel.textContent = mode === 'onion' ? 'Opacity' : 'Swipe';
  rangeInput.value = String(Math.round((mode === 'onion' ? onion : split) * 100));
  draw();
}

function setTool(next: Tool) {
  tool = next;
  for (const button of workspace.querySelectorAll<HTMLButtonElement>('.tool[data-tool]'))
    button.setAttribute('aria-pressed', String(button.dataset.tool === tool));
}

function clearMask() {
  maskCanvas!.getContext('2d')!.clearRect(0, 0, W, H);
  draw();
  reanalyze();
}

const SEVERITY_COLOR = { major: '#ff6b6b', moderate: '#ffb454', minor: '#ffe66d' } as const;

function draw(preview?: { x: number; y: number; w: number; h: number }) {
  if (!stage || !originalCanvas) return;
  const ctx = stage.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);
  const editedView = alignedCanvas ?? originalCanvas;
  if (mode === 'swipe') {
    ctx.drawImage(originalCanvas, 0, 0);
    ctx.save();
    ctx.beginPath();
    ctx.rect(split * W, 0, W - split * W, H);
    ctx.clip();
    ctx.drawImage(editedView, 0, 0);
    ctx.restore();
  } else if (mode === 'heatmap') {
    ctx.filter = 'grayscale(1) brightness(0.75)';
    ctx.drawImage(originalCanvas, 0, 0);
    ctx.filter = 'none';
    if (heatCanvas) ctx.drawImage(heatCanvas, 0, 0);
  } else if (mode === 'onion') {
    ctx.drawImage(originalCanvas, 0, 0);
    ctx.globalAlpha = onion;
    ctx.drawImage(editedView, 0, 0);
    ctx.globalAlpha = 1;
  } else {
    ctx.drawImage(mode === 'original' ? originalCanvas : editedView, 0, 0);
  }
  const px = W / Math.max(1, stage.getBoundingClientRect().width || W);
  if (showMask && maskCanvas && mode !== 'heatmap') {
    ctx.globalAlpha = 0.32;
    ctx.drawImage(maskCanvas, 0, 0);
    ctx.globalAlpha = 1;
  }
  if (mode === 'swipe') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(split * W - px, 0, 2 * px, H);
    const labels: [string, number, CanvasTextAlign][] = [
      ['ORIGINAL', split * W - 10 * px, 'right'],
      ['EDITED', split * W + 10 * px, 'left'],
    ];
    ctx.font = `700 ${12 * px}px system-ui, sans-serif`;
    for (const [text, x, align] of labels) {
      ctx.textAlign = align;
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      const width = ctx.measureText(text).width + 12 * px;
      ctx.fillRect(align === 'right' ? x - width + 6 * px : x - 6 * px, 10 * px, width, 22 * px);
      ctx.fillStyle = '#fff';
      ctx.fillText(text, x, 26 * px);
    }
  }
  for (const r of analysis?.regions ?? []) drawRegion(ctx, r, px, r.id === selected);
  if (preview) {
    ctx.setLineDash([6 * px, 4 * px]);
    ctx.strokeStyle = '#7cf2c8';
    ctx.lineWidth = 2 * px;
    ctx.strokeRect(preview.x, preview.y, preview.w, preview.h);
    ctx.setLineDash([]);
  }
}

function drawRegion(ctx: CanvasRenderingContext2D, r: Region, px: number, active: boolean) {
  const pad = 4 * px;
  const color = SEVERITY_COLOR[r.severity];
  ctx.lineWidth = (active ? 4 : 2) * px;
  ctx.strokeStyle = color;
  if (active) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 12 * px;
  }
  ctx.strokeRect(r.x - pad, r.y - pad, r.width + 2 * pad, r.height + 2 * pad);
  ctx.shadowBlur = 0;
  const size = 22 * px;
  const x = Math.max(0, r.x - pad);
  const y = Math.max(0, r.y - pad - size);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y < 0 ? 0 : y, size, size, 6 * px);
  ctx.fill();
  ctx.fillStyle = '#10201c';
  ctx.font = `800 ${13 * px}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(r.id), x + size / 2, (y < 0 ? 0 : y) + size / 2 + px);
  ctx.textBaseline = 'alphabetic';
}

function wireStage() {
  let drawing = false;
  let start: { x: number; y: number } | null = null;
  let last: { x: number; y: number } | null = null;
  const point = (event: PointerEvent) => {
    const rect = stage.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * W,
      y: ((event.clientY - rect.top) / rect.height) * H,
    };
  };
  const stroke = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const ctx = maskCanvas!.getContext('2d')!;
    const scale = W / stage.getBoundingClientRect().width;
    ctx.globalCompositeOperation = tool === 'erase' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = '#7cf2c8';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = brush * scale;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x + 0.01, to.y);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  };
  stage.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    stage.setPointerCapture(event.pointerId);
    clearTimeout(analyzeTimer);
    job++;
    setBusy(true, 'Marking intended area…');
    drawing = true;
    showMask = true;
    byId<HTMLInputElement>('show-mask').checked = true;
    const p = point(event);
    start = p;
    last = p;
    if (tool !== 'rect') stroke(p, p);
    draw();
  });
  stage.addEventListener('pointermove', (event) => {
    if (!drawing || !start || !last) return;
    const p = point(event);
    if (tool === 'rect')
      draw({
        x: Math.min(start.x, p.x),
        y: Math.min(start.y, p.y),
        w: Math.abs(p.x - start.x),
        h: Math.abs(p.y - start.y),
      });
    else {
      stroke(last, p);
      last = p;
      draw();
    }
  });
  const finish = (event: PointerEvent) => {
    if (!drawing || !start) return;
    drawing = false;
    if (tool === 'rect' && event.type === 'pointerup') {
      const p = point(event);
      const ctx = maskCanvas!.getContext('2d')!;
      ctx.fillStyle = '#7cf2c8';
      ctx.fillRect(
        Math.min(start.x, p.x),
        Math.min(start.y, p.y),
        Math.abs(p.x - start.x),
        Math.abs(p.y - start.y),
      );
    }
    start = null;
    last = null;
    draw();
    reanalyze(120);
  };
  stage.addEventListener('pointerup', finish);
  stage.addEventListener('pointercancel', finish);
}
window.addEventListener('resize', () => draw());

// ——— Results panel ———

const pct = (v: number) => (v < 0.001 && v > 0 ? '<0.1' : (v * 100).toFixed(v < 0.1 ? 1 : 0));

function renderPanel() {
  if (!analysis || !panel) return;
  const focused = document.activeElement;
  const focusKey =
    focused instanceof HTMLElement && panel.contains(focused) ? focused.dataset.focusKey : undefined;
  const a = analysis;
  const verdict = a.outsidePixels
    ? VERDICT[a.verdict]
    : {
        title: 'No unmarked area to compare',
        text: 'The intended area or image boundaries leave no comparable pixels. Clear part of the mask to review the rest.',
      };
  const intendedShare = a.intendedPixels / (a.width * a.height);
  const facts: [string, string, boolean?][] = [
    [
      'Alignment',
      `Edited ${a.editSize.width} × ${a.editSize.height} px matched at ${(a.alignment.scale * 100).toFixed(1)} % scale, offset ${a.alignment.tx.toFixed(1)} × ${a.alignment.ty.toFixed(1)} px.${a.alignment.doubtful ? ' Alignment is uncertain: compare the views manually; detected regions may be misleading.' : ''}`,
      a.alignment.doubtful,
    ],
    [
      'Colour drift',
      a.tone.significant
        ? `The whole picture shifted by ΔE ${a.tone.shift.toFixed(1)}. ${a.options.compensateTone ? 'Set aside before comparing.' : 'Included in the comparison.'}`
        : 'No global colour or brightness drift.',
      a.tone.significant,
    ],
    [
      'Typical difference',
      `Median colour difference ΔE ${a.noise.deltaE.toFixed(1)} outside your mask; colour threshold ${THRESHOLDS[a.options.sensitivity].deltaE}. Structural changes are checked separately.`,
    ],
    [
      'Intended area',
      intendedShare > 0
        ? `${pct(intendedShare)} % of the image is marked as intended.`
        : 'Nothing marked yet. Paint the area you asked to change.',
      intendedShare === 0,
    ],
  ];
  if (a.uncoveredFraction > 0.01)
    facts.push(['Cropped', `${pct(a.uncoveredFraction)} % of the original is missing from the edit.`, true]);

  const sensitivity = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Sensitivity' });
  const sensitivities: Sensitivity[] = ['low', 'balanced', 'high'];
  const setSensitivity = (s: Sensitivity) => {
    options = { ...options, sensitivity: s };
    reanalyze();
    renderPanel();
    panel.querySelector<HTMLButtonElement>('[role="radio"][aria-checked="true"]')?.focus();
  };
  for (const s of sensitivities)
    sensitivity.append(
      h(
        'button',
        {
          type: 'button',
          role: 'radio',
          'aria-checked': String(options.sensitivity === s),
          tabindex: options.sensitivity === s ? 0 : -1,
          'data-focus-key': `sensitivity-${s}`,
          onclick: () => setSensitivity(s),
        },
        s[0].toUpperCase() + s.slice(1),
      ),
    );
  sensitivity.addEventListener('keydown', (event) => {
    const index = sensitivities.indexOf(options.sensitivity);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? sensitivities.length - 1
          : event.key === 'ArrowRight' || event.key === 'ArrowDown'
            ? (index + 1) % sensitivities.length
            : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
              ? (index + sensitivities.length - 1) % sensitivities.length
              : -1;
    if (next < 0) return;
    event.preventDefault();
    setSensitivity(sensitivities[next]);
  });
  const compensate = h('input', {
    type: 'checkbox',
    checked: options.compensateTone,
    'data-focus-key': 'tone',
  });
  compensate.addEventListener('change', () => {
    options = { ...options, compensateTone: compensate.checked };
    reanalyze();
  });

  const regions = h('ol', { class: 'regions' }, ...a.regions.map((r) => regionCard(r)));
  panel.replaceChildren(
    h(
      'section',
      { class: `verdict v-${a.verdict}` },
      h('p', { class: 'eyebrow' }, 'Verdict'),
      h('h2', {}, verdict.title),
      h('p', {}, verdict.text),
      h(
        'div',
        { class: 'verdict-stats' },
        h(
          'div',
          {},
          h('strong', {}, String(a.regions.length)),
          h('span', {}, a.regions.length === 1 ? 'region' : 'regions'),
        ),
        h(
          'div',
          {},
          h('strong', {}, `${pct(a.changedFraction)} %`),
          h('span', {}, 'of the untouched area changed'),
        ),
      ),
    ),
    h(
      'section',
      { class: 'facts' },
      ...facts.map(([title, text, warn]) =>
        h('div', { class: `fact ${warn ? 'warn' : ''}` }, h('h3', {}, title), h('p', {}, text)),
      ),
    ),
    h(
      'section',
      { class: 'settings' },
      h('h3', {}, 'Sensitivity'),
      sensitivity,
      h('label', { class: 'check' }, compensate, 'Ignore global colour drift'),
    ),
    h(
      'section',
      { class: 'region-list' },
      h('h3', {}, a.regions.length ? 'Unintended changes' : 'No regions to review'),
      a.regions.length
        ? regions
        : h('p', { class: 'muted' }, 'Try a higher sensitivity to look for subtler changes.'),
    ),
    h(
      'section',
      { class: 'exports' },
      h('h3', {}, 'Export'),
      h(
        'button',
        { class: 'button small primary', type: 'button', onclick: () => exportSheet() },
        'Comparison sheet (PNG)',
      ),
      h('button', { class: 'button small', type: 'button', onclick: () => exportHeatmap() }, 'Heatmap (PNG)'),
      h(
        'button',
        {
          class: 'button small',
          type: 'button',
          onclick: () => download('edit-creep-report.json', reportJson(a, files())),
        },
        'Report (JSON)',
      ),
    ),
  );
  setBusy(busy);
  if (focusKey) panel.querySelector<HTMLElement>(`[data-focus-key="${focusKey}"]`)?.focus();
}

function files() {
  return {
    original: { name: original!.name, width: original!.naturalWidth, height: original!.naturalHeight },
    edited: { name: edited!.name, width: edited!.naturalWidth, height: edited!.naturalHeight },
  };
}

function crop(source: HTMLCanvasElement, r: Region, size = 132): HTMLCanvasElement {
  const side = Math.max(48, Math.max(r.width, r.height) * 1.5);
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const sx = Math.max(0, Math.min(W - side, cx - side / 2));
  const sy = Math.max(0, Math.min(H - side, cy - side / 2));
  const canvas = h('canvas', { width: size, height: size, class: 'crop' });
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, sx, sy, Math.min(side, W), Math.min(side, H), 0, 0, size, size);
  return canvas;
}

function regionCard(r: Region) {
  return h(
    'li',
    { class: `region sev-${r.severity} ${r.id === selected ? 'active' : ''}` },
    h(
      'header',
      {},
      h('span', { class: 'badge' }, String(r.id)),
      h(
        'div',
        {},
        h('strong', {}, KIND[r.kind]),
        h(
          'span',
          { class: 'muted' },
          `${r.severity} · ${pct(r.area)} % of image · peak ${r.peak.toFixed(1)}×`,
        ),
      ),
    ),
    h(
      'div',
      { class: 'crops' },
      h('figure', {}, crop(originalCanvas!, r), h('figcaption', {}, 'Original')),
      h('figure', {}, crop(alignedCanvas ?? originalCanvas!, r), h('figcaption', {}, 'Edited')),
    ),
    h(
      'div',
      { class: 'region-actions' },
      h(
        'button',
        {
          type: 'button',
          class: 'link',
          'data-focus-key': `region-${r.id}-highlight`,
          onclick: () => {
            selected = selected === r.id ? null : r.id;
            renderPanel();
            draw();
            stage.scrollIntoView({ behavior: 'smooth', block: 'center' });
          },
        },
        r.id === selected ? 'Unhighlight' : 'Highlight',
      ),
      h(
        'button',
        { type: 'button', class: 'link', onclick: () => markIntended([r.id]) },
        'This was intended',
      ),
    ),
  );
}

// ——— Exports ———

function saveCanvas(canvas: HTMLCanvasElement, name: string) {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = h('a', { href: url, download: name });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
}

function footer(ctx: CanvasRenderingContext2D, width: number, y: number, height: number) {
  const a = analysis!;
  ctx.fillStyle = '#0e1d1a';
  ctx.fillRect(0, y, width, height);
  ctx.fillStyle = '#7cf2c8';
  ctx.font = '700 18px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`Edit Creep · ${VERDICT[a.verdict].title}`, 20, y + 30);
  ctx.fillStyle = '#c9ddd6';
  ctx.font = '14px system-ui, sans-serif';
  ctx.fillText(
    `${a.regions.length} regions · ${pct(a.changedFraction)} % of the untouched area changed · sensitivity ${a.options.sensitivity} · ${new Date().toISOString().slice(0, 10)}`,
    20,
    y + 54,
  );
}

function exportHeatmap() {
  const canvas = h('canvas', { width: W, height: H + 72 });
  const ctx = canvas.getContext('2d')!;
  ctx.filter = 'grayscale(1) brightness(0.75)';
  ctx.drawImage(originalCanvas!, 0, 0);
  ctx.filter = 'none';
  if (heatCanvas) ctx.drawImage(heatCanvas, 0, 0);
  for (const r of analysis!.regions) drawRegion(ctx, r, 1, false);
  footer(ctx, W, H, 72);
  saveCanvas(canvas, 'edit-creep-heatmap.png');
}

function exportSheet() {
  const gap = 16;
  const top = 44;
  const canvas = h('canvas', { width: W * 2 + gap, height: H + top + 72 });
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#0e1d1a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#e8f3ef';
  ctx.font = '700 16px system-ui, sans-serif';
  ctx.fillText(`Original — ${original!.name}`, 8, 28, Math.max(1, W - 16));
  ctx.fillText(`AI edit — ${edited!.name}`, W + gap + 8, 28, Math.max(1, W - 16));
  ctx.drawImage(originalCanvas!, 0, top);
  ctx.drawImage(alignedCanvas ?? originalCanvas!, W + gap, top);
  for (const offset of [0, W + gap]) {
    ctx.save();
    ctx.translate(offset, top);
    for (const r of analysis!.regions) drawRegion(ctx, r, 1, false);
    ctx.restore();
  }
  footer(ctx, canvas.width, H + top, 72);
  saveCanvas(canvas, 'edit-creep-comparison.png');
}

function reset() {
  loadGeneration++;
  clearTimeout(analyzeTimer);
  stopWorker();
  setBusy(false);
  original = null;
  edited = null;
  analysis = null;
  originalCanvas = null;
  alignedCanvas = null;
  heatCanvas = null;
  maskCanvas = null;
  W = 0;
  H = 0;
  mode = 'swipe';
  tool = 'brush';
  split = 0.5;
  onion = 0.5;
  showMask = true;
  selected = null;
  options = { ...DEFAULT_OPTIONS };
  brush = 36;
  introError.hidden = true;
  workspaceBuilt = false;
  workspace.replaceChildren();
  for (const which of ['original', 'edited']) {
    const slot = byId(`slot-${which}`);
    slot.classList.remove('filled');
    slot.querySelector('.slot-thumb')?.remove();
    byId(`name-${which}`).textContent = 'PNG, JPEG, WebP, AVIF — or drop it here';
  }
  showView('intro');
}

showView('intro');
