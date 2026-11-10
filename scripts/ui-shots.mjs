// Screenshots of the main screens (landing, dashboard, room) on desktop and phone, plus overflow checks.
// Usage: node scripts/ui-shots.mjs [baseUrl]
import { chromium, devices } from 'playwright';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] || 'http://localhost:3101';
const OUT = fileURLToPath(new URL('../e2e-artifacts/', import.meta.url));
const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const token = (await (await fetch(BASE + '/api/auth/name', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Review' }) })).json()).token;
const demo = (await (await fetch(BASE + '/api/rooms/public')).json()).find((r) => r.template === 'modern_city');

for (const [name, opts] of [['desktop', { viewport: { width: 1440, height: 900 } }], ['phone', devices['Pixel 7']]]) {
  const anon = await browser.newContext(opts);
  const p0 = await anon.newPage();
  p0.on('pageerror', (e) => console.log(name, 'landing pageerror', e.message));
  await p0.goto(BASE + '/');
  await p0.getByLabel('Room code').waitFor();
  await p0.waitForTimeout(700);
  console.log(name, 'landing scroll', await p0.evaluate(() => [document.documentElement.scrollHeight - innerHeight, document.documentElement.scrollWidth - innerWidth]));
  await p0.screenshot({ path: `${OUT}ui-landing-${name}.png` });
  await anon.close();

  const ctx = await browser.newContext(opts);
  await ctx.addInitScript((t) => { localStorage.setItem('civitas.token', t); localStorage.setItem('civitas.autoQuality', 'false'); localStorage.setItem('civitas.quality', '"balanced"'); }, token);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log(name, 'pageerror', e.message));
  await p.goto(BASE + '/dashboard');
  await p.getByRole('tab', { name: /Public/ }).waitFor();
  await p.getByRole('link', { name: /Modern City/ }).first().waitFor();
  console.log(name, 'dashboard scroll', await p.evaluate(() => [document.documentElement.scrollHeight - innerHeight, document.documentElement.scrollWidth - innerWidth]));
  await p.screenshot({ path: `${OUT}ui-dashboard-${name}.png` });

  await p.goto(`${BASE}/room/${demo.id}`);
  await p.locator('canvas').first().waitFor({ timeout: 30000 });
  await p.waitForTimeout(3500);
  await p.screenshot({ path: `${OUT}ui-room-${name}.png` });
  if (name === 'desktop') {
    await p.getByRole('button', { name: 'Chat', exact: true }).click();
    await p.getByRole('dialog', { name: 'Chat' }).waitFor();
    await p.screenshot({ path: `${OUT}ui-room-chat.png` });
    await p.getByRole('button', { name: 'Close Chat' }).click();
    await p.getByRole('button', { name: 'Overview' }).click();
    await p.waitForTimeout(2500);
    await p.screenshot({ path: `${OUT}ui-traffic.png` });
    await p.getByRole('button', { name: 'Third person' }).click();
    await p.locator('section:has(h2:text-is("Asset library")) button', { hasText: 'Office' }).click();
    const box = await p.locator('main canvas').first().boundingBox();
    await p.mouse.click(box.x + box.width / 2 + 80, box.y + box.height / 2 + 120);
    await p.getByRole('button', { name: 'Done' }).click();
    await p.locator('section:has(h2:text-is("City hierarchy")) button', { hasText: /^Office/ }).first().click();
    await p.locator('section:has(h2:text-is("City hierarchy")) ul ul button').first().click();
    await p.waitForTimeout(1200);
    await p.screenshot({ path: `${OUT}ui-room-selected.png` });
  }
  await ctx.close();
}
await browser.close();
