import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function loadDemo(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try the demo pair' }).click();
  await expect(page.locator('.verdict')).toBeVisible({ timeout: 60_000 });
}

/** A small PNG made in the page, so tests need no binary fixtures. */
async function makePng(page: Page, draw: string, width = 320, height = 240): Promise<Buffer> {
  const base64 = await page.evaluate(
    ({ draw, width, height }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      new Function('ctx', draw)(ctx);
      return canvas.toDataURL('image/png').split(',')[1];
    },
    { draw, width, height },
  );
  return Buffer.from(base64, 'base64');
}

const SCENE = `
  ctx.fillStyle = '#e8e0d0'; ctx.fillRect(0, 0, 320, 240);
  ctx.fillStyle = '#2f4f46'; ctx.fillRect(110, 40, 100, 160);
  ctx.fillStyle = '#f3ead8'; ctx.fillRect(122, 110, 76, 60);
  ctx.fillStyle = '#c8553d'; ctx.beginPath(); ctx.arc(160, 76, 16, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#3f7d4e'; ctx.fillRect(20, 120, 60, 100);
`;

test('demo: aligned comparison, verdict and regions', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await loadDemo(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('.verdict h2')).toHaveText(/unintended changes/);
  await expect(page.locator('.fact').first()).toContainText('Edited 960 × 720 px matched at 94.');
  await expect(page.locator('.fact', { hasText: 'Colour drift' })).toContainText('Set aside');
  const regions = page.locator('.region');
  expect(await regions.count()).toBeGreaterThanOrEqual(4);
  await expect(page.locator('.region .crop')).toHaveCount((await regions.count()) * 2);
  expect(errors).toEqual([]);
});

test('view modes, highlighting and marking a region as intended', async ({ page }) => {
  await loadDemo(page);
  for (const mode of ['Heatmap', 'Onion skin', 'Original', 'Edited', 'Swipe']) {
    await page.getByRole('tab', { name: mode }).click();
    await expect(page.getByRole('tab', { name: mode })).toHaveAttribute('aria-selected', 'true');
  }
  const before = await page.locator('.region').count();
  await page.locator('.region').first().getByRole('button', { name: 'Highlight' }).click();
  await expect(page.locator('.region.active')).toHaveCount(1);
  await page.locator('.region').first().getByRole('button', { name: 'This was intended' }).click();
  await expect.poll(async () => page.locator('.region').count()).toBeLessThan(before);
});

test('sensitivity and colour drift settings re-run the analysis', async ({ page }) => {
  await loadDemo(page);
  const balanced = await page.locator('.region').count();
  await page.getByRole('radio', { name: 'Low' }).click();
  await expect(page.getByRole('radio', { name: 'Low' })).toHaveAttribute('aria-checked', 'true');
  await expect.poll(async () => page.locator('.region').count()).toBeLessThanOrEqual(balanced);
  await page.getByLabel('Ignore global colour drift').uncheck();
  await expect(page.locator('.verdict h2')).toHaveText('Major unintended changes');
  await expect
    .poll(async () => page.locator('.fact', { hasText: 'Colour drift' }).textContent())
    .toContain('Included in the comparison');
});

test('exports a JSON report and two PNG images', async ({ page }) => {
  await loadDemo(page);
  const wait = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Report (JSON)' }).click();
  const json = await wait;
  const report = JSON.parse(await readFile((await json.path())!, 'utf8'));
  expect(report.tool.name).toBe('Edit Creep');
  expect(report.regions.length).toBeGreaterThan(0);
  expect(report.files.edited).toEqual({ name: 'demo-ai-edit.png', width: 960, height: 720 });
  expect(report.regions[0].boxInOriginal.width).toBeGreaterThan(0);

  for (const [name, file] of [
    ['Comparison sheet (PNG)', 'edit-creep-comparison.png'],
    ['Heatmap (PNG)', 'edit-creep-heatmap.png'],
  ]) {
    const next = page.waitForEvent('download');
    await page.getByRole('button', { name }).click();
    const download = await next;
    expect(download.suggestedFilename()).toBe(file);
    const bytes = await readFile((await download.path())!);
    expect(bytes.subarray(1, 4).toString()).toBe('PNG');
  }
});

test('uploads two files, paints the intended area and finds the remaining change', async ({ page }) => {
  // Preview does not serve Vercel response headers. Exercise the real policy here,
  // including its restriction on unrelated scripts and outbound connections.
  const hosting = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8')) as {
    headers: { source: string; headers: { key: string; value: string }[] }[];
  };
  const securityHeaders = Object.fromEntries(
    hosting.headers.find((rule) => rule.source === '/(.*)')!.headers.map(({ key, value }) => [key, value]),
  );
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), ...securityHeaders } });
  });
  await page.goto('/');
  const outbound: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('http')) return;
    if (request.method() !== 'GET' || new URL(request.url()).origin !== new URL(page.url()).origin)
      outbound.push(`${request.method()} ${request.url()}`);
  });
  const original = await makePng(page, SCENE);
  const edited = await makePng(
    page,
    SCENE +
      `ctx.fillStyle = '#b0b0b8'; ctx.fillRect(20, 120, 60, 100);
       ctx.fillStyle = '#d9822b'; ctx.beginPath(); ctx.arc(160, 76, 16, 0, Math.PI * 2); ctx.fill();`,
  );
  await page
    .locator('#file-original')
    .setInputFiles({ name: 'before.png', mimeType: 'image/png', buffer: original });
  await page
    .locator('#file-edited')
    .setInputFiles({ name: 'after.png', mimeType: 'image/png', buffer: edited });
  await expect(page.locator('.verdict')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.region')).toHaveCount(2);

  // Draw a box over the plant area (left side): only the logo should remain.
  await page.getByRole('button', { name: 'Box' }).click();
  const stage = page.locator('#stage');
  const box = (await stage.boundingBox())!;
  const sx = box.width / 320;
  const sy = box.height / 240;
  await page.mouse.move(box.x + 10 * sx, box.y + 110 * sy);
  await page.mouse.down();
  await page.mouse.move(box.x + 92 * sx, box.y + 230 * sy, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('.region')).toHaveCount(1);
  await expect(page.locator('.region header strong')).toHaveText('Colour changed');

  // Covering the entire image must not imply that the image was checked clean.
  await stage.scrollIntoViewIfNeeded();
  const full = (await stage.boundingBox())!;
  // Inset the endpoints within the canvas's rounded CSS hit area. Feathering
  // still covers the comparable pixels inside the analysis border.
  await page.mouse.move(full.x + 4 * sx, full.y + 4 * sy);
  await page.mouse.down();
  await page.mouse.move(full.x + full.width - 4 * sx, full.y + full.height - 4 * sy);
  await page.mouse.up();
  await expect(page.locator('.verdict h2')).toHaveText('No unmarked area to compare');
  expect(outbound).toEqual([]);
});

test('identical images are clean; bad files explain themselves; phone layout fits', async ({ page }) => {
  await page.goto('/');
  const png = await makePng(page, SCENE);
  await page.locator('#file-original').setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: png });
  await page.locator('#file-edited').setInputFiles({ name: 'b.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('.verdict h2')).toHaveText('No changes detected', { timeout: 60_000 });

  await page.getByRole('button', { name: 'New comparison' }).click();
  await page
    .locator('#file-original')
    .setInputFiles({ name: 'notes.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
  await expect(page.locator('#intro-error')).toContainText('could not be decoded');

  const wide = await makePng(page, SCENE, 320, 80);
  const tall = await makePng(page, SCENE, 80, 320);
  await page
    .locator('#file-original')
    .setInputFiles({ name: 'wide.png', mimeType: 'image/png', buffer: wide });
  await page.locator('#file-edited').setInputFiles({ name: 'tall.png', mimeType: 'image/png', buffer: tall });
  await expect(page.locator('#intro-error')).toContainText('aspect ratios cannot be aligned');

  await page.setViewportSize({ width: 390, height: 844 });
  await loadDemo(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test('the latest image choice wins, and reset ignores an unfinished decode', async ({ page }) => {
  await page.addInitScript(`
    const decode = window.createImageBitmap.bind(window);
    window.createImageBitmap = async function(source, ...args) {
      if (source instanceof File && source.name === 'older.png') {
        await new Promise(resolve => { window.releaseDecode = resolve; });
        const bitmap = await decode(source, ...args);
        window.olderDecoded = true;
        return bitmap;
      }
      return decode(source, ...args);
    };
  `);
  await page.goto('/');
  const png = await makePng(page, SCENE);
  await page
    .locator('#file-original')
    .setInputFiles({ name: 'older.png', mimeType: 'image/png', buffer: png });
  await page.waitForFunction(
    () => typeof (window as unknown as { releaseDecode?: unknown }).releaseDecode === 'function',
  );
  await page
    .locator('#file-original')
    .setInputFiles({ name: 'newer.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('#name-original')).toContainText('newer.png');
  await page.evaluate(() => (window as unknown as { releaseDecode: () => void }).releaseDecode());
  await page.waitForFunction(() => (window as unknown as { olderDecoded?: boolean }).olderDecoded);
  await expect(page.locator('#name-original')).toContainText('newer.png');

  await loadDemo(page);
  await page.evaluate(() => {
    (window as unknown as { olderDecoded: boolean }).olderDecoded = false;
  });
  await page
    .locator('#file-original')
    .setInputFiles({ name: 'older.png', mimeType: 'image/png', buffer: png });
  await page.getByRole('button', { name: 'New comparison' }).click();
  await page.evaluate(() => (window as unknown as { releaseDecode: () => void }).releaseDecode());
  await page.waitForFunction(() => (window as unknown as { olderDecoded?: boolean }).olderDecoded);
  await expect(page.locator('#slot-original')).not.toHaveClass(/filled/);
  await expect(page.locator('#workspace')).toBeHidden();
});

test('reset cancels a queued paint analysis and releases the comparison', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(`
    window.workerRequests = [];
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(message, ...args) {
      window.workerRequests.push(message.type);
      return send.call(this, message, ...args);
    };
  `);
  await page.clock.install();
  await loadDemo(page);
  const box = (await page.locator('#stage').boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.1);
  await expect(page.getByRole('button', { name: 'Report (JSON)' })).toBeDisabled();
  await page.getByRole('button', { name: 'New comparison' }).click();
  await page.clock.runFor(1000);
  await expect(page.locator('#intro')).toBeVisible();
  await expect(page.locator('#workspace')).toBeHidden();
  expect(
    await page.evaluate(() => (window as unknown as { workerRequests: string[] }).workerRequests),
  ).toEqual(['load']);
  expect(errors).toEqual([]);
});

test('a delayed analysis response cannot erase a new brush stroke', async ({ page }) => {
  await page.addInitScript(`
    const add = Worker.prototype.addEventListener;
    Worker.prototype.addEventListener = function(type, listener, options) {
      if (type !== 'message' || typeof listener !== 'function') return add.call(this, type, listener, options);
      const worker = this;
      return add.call(this, type, function(event) {
        if (window.holdResult && event.data.type === 'result') {
          window.holdResult = false;
          window.releaseResult = () => listener.call(worker, event);
          window.resultHeld = true;
          return;
        }
        listener.call(worker, event);
      }, options);
    };
  `);
  await loadDemo(page);
  const beforeDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Report (JSON)' }).click();
  const before = JSON.parse(await readFile((await (await beforeDownload).path())!, 'utf8'));
  await page.evaluate(() => {
    (window as unknown as { holdResult: boolean }).holdResult = true;
  });
  await page.getByRole('radio', { name: 'High' }).click();
  await page.waitForFunction(() => (window as unknown as { resultHeld?: boolean }).resultHeld);
  await page.locator('#stage').scrollIntoViewIfNeeded();
  const box = (await page.locator('#stage').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.1);
  await page.mouse.down();
  await page.evaluate(() => (window as unknown as { releaseResult: () => void }).releaseResult());
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Report (JSON)' })).toBeEnabled({ timeout: 60_000 });
  const afterDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Report (JSON)' }).click();
  const after = JSON.parse(await readFile((await (await afterDownload).path())!, 'utf8'));
  expect(after.summary.intendedShareOfImage).toBeGreaterThan(before.summary.intendedShareOfImage);
  expect(after.settings.sensitivity).toBe('high');
});

test('transparent images use a white composite and view controls support arrow keys', async ({ page }) => {
  await page.goto('/');
  const png = await makePng(page, `ctx.fillStyle = '#237d63'; ctx.fillRect(100, 60, 60, 80);`);
  for (const which of ['original', 'edited'])
    await page
      .locator(`#file-${which}`)
      .setInputFiles({ name: `${which}.png`, mimeType: 'image/png', buffer: png });
  await expect(page.locator('.verdict')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('tab', { name: 'Original', exact: true }).click();
  expect(
    await page
      .locator('#stage')
      .evaluate((canvas: HTMLCanvasElement) => [...canvas.getContext('2d')!.getImageData(1, 1, 1, 1).data]),
  ).toEqual([255, 255, 255, 255]);
  await page.getByRole('tab', { name: 'Original', exact: true }).press('End');
  await expect(page.getByRole('tab', { name: 'Edited', exact: true })).toBeFocused();
  await page.getByRole('tab', { name: 'Edited', exact: true }).press('Home');
  await expect(page.getByRole('tab', { name: 'Swipe', exact: true })).toBeFocused();
  await page.getByRole('tab', { name: 'Swipe', exact: true }).press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Heatmap', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('radio', { name: 'Balanced', exact: true }).press('End');
  await expect(page.getByRole('radio', { name: 'High', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Report (JSON)' })).toBeEnabled({ timeout: 60_000 });
  await expect(page.getByRole('radio', { name: 'High', exact: true })).toBeFocused();
});
