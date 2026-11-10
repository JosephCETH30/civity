// Captures room screenshots at each quality level plus measured renderer stats.
// Also writes the landing background (client/public/landing/city.jpg).
// Usage: node scripts/shots.mjs [baseUrl]   (server must be running with a built client)
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] || 'http://localhost:3101';
const OUT = fileURLToPath(new URL('../e2e-artifacts/', import.meta.url));
const LANDING = fileURLToPath(new URL('../client/public/landing/', import.meta.url));
mkdirSync(OUT, { recursive: true });
mkdirSync(LANDING, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const demo = (await (await fetch(BASE + '/api/rooms/public')).json()).find((r) => r.template === 'modern_city');

async function enter(ctxOpts, quality, name) {
  const token = (await (await fetch(BASE + '/api/auth/name', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) })).json()).token;
  const ctx = await browser.newContext(ctxOpts);
  await ctx.addInitScript(([t, q]) => {
    localStorage.setItem('civitas.token', t);
    localStorage.setItem('civitas.quality', JSON.stringify(q));
    localStorage.setItem('civitas.autoQuality', 'false');
    localStorage.setItem('civitas.renderMode', '"3d"');
  }, [token, quality]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[${name}] pageerror`, e.message));
  await page.goto(`${BASE}/room/${demo.id}`);
  await page.locator('canvas').first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(4000);
  return page;
}

async function stats(page, mobile) {
  if (mobile) {
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('tab', { name: 'Settings' }).click();
  } else await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.waitForTimeout(2200);
  const t = await page.getByTestId('perf').innerText();
  if (mobile) await page.getByRole('button', { name: 'Close More' }).click();
  else await page.getByRole('button', { name: 'Close Settings' }).click();
  return t;
}

for (const q of ['low', 'balanced', 'high']) {
  const page = await enter({ viewport: { width: 1440, height: 900 } }, q, `Shot ${q}`);
  console.log(`desktop ${q}:`, await stats(page, false));
  await page.screenshot({ path: `${OUT}city-${q}.png` });
  if (q === 'balanced') {
    await page.getByRole('button', { name: 'Overview' }).click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${OUT}city-overview.png` });
    // Landing background: the real city render with the room UI hidden.
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.addStyleTag({ content: 'header, aside, main > :not(div.absolute.inset-0) { display: none !important; }' });
    await page.waitForTimeout(1500); // canvas resizes to the full window
    await page.screenshot({ path: `${LANDING}city.jpg`, type: 'jpeg', quality: 72 });
  }
  await page.context().close();
}

const phone = await enter({ ...devices['Pixel 7'] }, 'low', 'Shot phone');
console.log('phone low:', await stats(phone, true));
await phone.screenshot({ path: `${OUT}city-phone.png` });
await browser.close();
