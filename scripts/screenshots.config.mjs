/** Screens captured for the README. Every image shows the synthetic demo pair. */
const demo = async (page) => {
  await page.getByRole('button', { name: 'Try the demo pair' }).click();
  await page.locator('.verdict').waitFor();
};
const view = async (page, name) => {
  await page.getByRole('tab', { name }).click();
  await page.waitForTimeout(150);
};

export default {
  shots: [
    {
      file: 'docs/assets/screenshot-home.png',
      viewport: { width: 1440, height: 940 },
      prepare: async () => {},
    },
    {
      file: 'docs/assets/screenshot-swipe.png',
      viewport: { width: 1440, height: 1040 },
      prepare: async (page) => {
        await demo(page);
        await page.locator('#view-range').fill('42');
      },
    },
    {
      file: 'docs/assets/screenshot-heatmap.png',
      viewport: { width: 1440, height: 1040 },
      prepare: async (page) => {
        await demo(page);
        await view(page, 'Heatmap');
      },
    },
    {
      file: 'docs/assets/screenshot-regions.png',
      viewport: { width: 1440, height: 2600 },
      prepare: async (page) => {
        await demo(page);
      },
      element: '.panel',
    },
    {
      file: 'docs/assets/screenshot-mobile.png',
      viewport: { width: 390, height: 844 },
      scale: 2,
      prepare: async (page) => {
        await demo(page);
        await view(page, 'Heatmap');
        await page.locator('.ws-head').evaluate((el) => el.scrollIntoView());
      },
    },
  ],
  cards: [{ source: 'docs/assets/social-card.svg', file: 'public/og-image.png', width: 1200, height: 630 }],
};
