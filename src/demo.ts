/**
 * A synthetic product photo and an "AI edit" of it. The request was:
 * "replace the plant with a floor lamp". The edit also, silently:
 * changed the pack weight from 250 g to 200 g, recoloured the logo, removed
 * the mug handle, nudged the artwork on the wall, warmed the whole picture
 * and returned a smaller, slightly shifted frame — all common in practice.
 */

const W = 1024;
const H = 768;

type Variant = 'original' | 'edited';

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawScene(ctx: CanvasRenderingContext2D, variant: Variant) {
  const edited = variant === 'edited';
  // Wall.
  const wall = ctx.createLinearGradient(0, 0, 0, 560);
  wall.addColorStop(0, '#efe7da');
  wall.addColorStop(1, '#ddd0bc');
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, W, 560);

  // Window.
  ctx.fillStyle = '#7a6550';
  ctx.fillRect(56, 56, 268, 208);
  const sky = ctx.createLinearGradient(0, 64, 0, 256);
  sky.addColorStop(0, '#9cc9e8');
  sky.addColorStop(1, '#d9ecf5');
  ctx.fillStyle = sky;
  ctx.fillRect(64, 64, 252, 192);
  ctx.fillStyle = '#7a6550';
  ctx.fillRect(186, 64, 8, 192);
  ctx.fillRect(64, 156, 252, 8);

  // Framed artwork (the circle drifts in the edit).
  ctx.fillStyle = '#3d2f28';
  ctx.fillRect(700, 70, 236, 176);
  ctx.fillStyle = '#f6f1e7';
  ctx.fillRect(712, 82, 212, 152);
  ctx.fillStyle = '#e07a5f';
  ctx.beginPath();
  ctx.arc(edited ? 786 : 776, edited ? 150 : 158, 38, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#3d405b';
  ctx.beginPath();
  ctx.moveTo(820, 214);
  ctx.lineTo(880, 112);
  ctx.lineTo(912, 214);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#81b29a';
  ctx.fillRect(724, 196, 90, 18);

  // Table.
  ctx.fillStyle = '#9a7552';
  ctx.fillRect(0, 560, W, H - 560);
  ctx.strokeStyle = 'rgba(70, 45, 25, 0.35)';
  ctx.lineWidth = 2;
  for (let y = 590; y < H; y += 34) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(300, y + 6, 700, y - 6, W, y + 4);
    ctx.stroke();
  }

  // Soft shadows.
  ctx.fillStyle = 'rgba(40, 25, 10, 0.22)';
  for (const [x, w] of [
    [210, 150],
    [510, 260],
    [780, 170],
  ] as const) {
    ctx.beginPath();
    ctx.ellipse(x, 600, w / 2, 16, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  if (!edited) {
    // Plant: the area the user asked to change.
    ctx.fillStyle = '#c98b5b';
    ctx.beginPath();
    ctx.moveTo(150, 470);
    ctx.lineTo(270, 470);
    ctx.lineTo(252, 600);
    ctx.lineTo(168, 600);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#b3774b';
    ctx.fillRect(142, 462, 136, 20);
    const leaves: [number, number, number][] = [
      [210, 380, 0],
      [170, 400, -0.6],
      [250, 400, 0.6],
      [150, 440, -1.1],
      [270, 440, 1.1],
      [200, 330, -0.2],
      [230, 340, 0.3],
    ];
    for (const [x, y, a] of leaves) {
      ctx.fillStyle = a < 0 ? '#3f7d4e' : '#4f9460';
      ctx.beginPath();
      ctx.ellipse(x, y, 22, 64, a, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // The requested floor lamp.
    ctx.fillStyle = '#2f2f33';
    ctx.beginPath();
    ctx.ellipse(210, 592, 62, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(205, 330, 10, 262);
    const glow = ctx.createRadialGradient(210, 330, 10, 210, 330, 150);
    glow.addColorStop(0, 'rgba(255, 220, 140, 0.55)');
    glow.addColorStop(1, 'rgba(255, 220, 140, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(60, 180, 300, 300);
    ctx.fillStyle = '#f2d79a';
    ctx.beginPath();
    ctx.moveTo(150, 330);
    ctx.lineTo(270, 330);
    ctx.lineTo(240, 250);
    ctx.lineTo(180, 250);
    ctx.closePath();
    ctx.fill();
  }

  // Coffee bag.
  ctx.fillStyle = '#2f4f46';
  roundRect(ctx, 400, 230, 220, 370, 18);
  ctx.fill();
  ctx.fillStyle = '#26413a';
  ctx.fillRect(400, 230, 220, 34);
  ctx.fillStyle = '#f3ead8';
  roundRect(ctx, 428, 352, 164, 176, 10);
  ctx.fill();
  ctx.fillStyle = edited ? '#d9822b' : '#c8553d';
  ctx.beginPath();
  ctx.arc(510, 302, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 30px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('H', 510, 304);
  ctx.fillStyle = '#2b2b2b';
  ctx.font = 'bold 30px Georgia, serif';
  ctx.fillText('HILLTOP', 510, 392);
  ctx.font = '600 17px Arial, sans-serif';
  ctx.fillText('R O A S T', 510, 424);
  ctx.font = '15px Arial, sans-serif';
  ctx.fillText('Single origin · Ethiopia', 510, 458);
  ctx.font = 'bold 26px Arial, sans-serif';
  ctx.fillText(edited ? '200 g' : '250 g', 510, 498);

  // Price tag.
  ctx.fillStyle = '#fffaf0';
  roundRect(ctx, 628, 300, 86, 40, 8);
  ctx.fill();
  ctx.fillStyle = '#2b2b2b';
  ctx.font = 'bold 18px Arial, sans-serif';
  ctx.fillText('€14.90', 671, 321);

  // Mug (the handle disappears in the edit).
  ctx.fillStyle = '#fbfbf8';
  roundRect(ctx, 720, 470, 120, 130, 14);
  ctx.fill();
  if (!edited) {
    ctx.strokeStyle = '#fbfbf8';
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.arc(842, 530, 30, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
  }
  ctx.fillStyle = '#5a3a22';
  ctx.beginPath();
  ctx.ellipse(780, 476, 54, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(120, 110, 100, 0.45)';
  ctx.lineWidth = 4;
  for (const x of [762, 782, 802]) {
    ctx.beginPath();
    ctx.moveTo(x, 450);
    ctx.bezierCurveTo(x - 12, 420, x + 12, 400, x, 370);
    ctx.stroke();
  }
}

/** Deterministic noise and a warm colour cast, like a generative re-render. */
function regrade(ctx: CanvasRenderingContext2D) {
  const image = ctx.getImageData(0, 0, W, H);
  let seed = 11;
  for (let i = 0; i < image.data.length; i += 4) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const n = ((seed / 2 ** 32) * 2 - 1) * 3;
    // A warm cast that stays inside 0–255, the way a re-render grades a whole frame.
    image.data[i] = image.data[i] * 0.97 + 8 + n;
    image.data[i + 1] = image.data[i + 1] * 0.99 + 2 + n;
    image.data[i + 2] = image.data[i + 2] * 0.93 + n;
  }
  ctx.putImageData(image, 0, 0);
}

export interface DemoPair {
  original: HTMLCanvasElement;
  edited: HTMLCanvasElement;
  /** Rectangle (in original pixels) around the area the "user" asked to change. */
  intended: { x: number; y: number; width: number; height: number };
}

export function demoPair(): DemoPair {
  const original = document.createElement('canvas');
  original.width = W;
  original.height = H;
  drawScene(original.getContext('2d')!, 'original');

  const full = document.createElement('canvas');
  full.width = W;
  full.height = H;
  const fctx = full.getContext('2d', { willReadFrequently: true })!;
  drawScene(fctx, 'edited');
  regrade(fctx);

  // The editor returned 960 × 720 with a small shift — a common output size change.
  const edited = document.createElement('canvas');
  edited.width = 960;
  edited.height = 720;
  const ectx = edited.getContext('2d')!;
  ectx.imageSmoothingQuality = 'high';
  ectx.drawImage(full, -4, -3, 966, 724.5);

  return { original, edited, intended: { x: 70, y: 170, width: 300, height: 450 } };
}
