// Renders public/icon.svg to the PNG sizes the web manifest needs (uses installed Chrome via Playwright).
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const svg = readFileSync(new URL('../client/public/icon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
for (const size of [192, 512]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0}</style>${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}`);
  await page.screenshot({ path: fileURLToPath(new URL(`../client/public/icon-${size}.png`, import.meta.url)), omitBackground: true });
}
await browser.close();
