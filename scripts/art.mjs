// Browser check of the photo-to-3D studio: place a park, walk in, convert a real photo with the AI depth model,
// place the sculpture, and confirm a second player sees it. Usage: node scripts/art.mjs [baseUrl]
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] || 'http://localhost:3101';
const OUT = fileURLToPath(new URL('../e2e-artifacts/', import.meta.url));
const PHOTO = fileURLToPath(new URL('../client/public/landing/city.jpg', import.meta.url));
const post = (path, body, token) => fetch(BASE + '/api' + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }).then((r) => r.json());

const a = await post('/auth/name', { name: 'Artist' });
const b = await post('/auth/name', { name: 'Visitor' });
const room = await post('/rooms', { name: 'Art test', description: '', visibility: 'private', maxParticipants: 4, template: 'empty_sandbox', worldSize: 96, defaultRole: 'editor' }, a.token);

const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
async function open(token, name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript((t) => { localStorage.setItem('civitas.token', t); localStorage.setItem('civitas.autoQuality', 'false'); localStorage.setItem('civitas.quality', '"balanced"'); localStorage.setItem('civitas.renderMode', '"3d"'); }, token);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));
  await p.goto(`${BASE}/room/${room.id}`);
  await p.getByRole('toolbar', { name: 'Meeting and city controls' }).waitFor({ timeout: 30000 });
  await p.waitForTimeout(1500);
  return p;
}
const step = (s) => console.log('•', s, `(${((Date.now() - t0) / 1000).toFixed(0)}s)`);
const t0 = Date.now();
try {
  const A = await open(a.token, 'A');
  const B = await open(b.token, 'B');
  // A puts a park right where they stand (top-down: centre of the view is the player).
  await A.getByRole('button', { name: 'Top-down' }).click();
  await A.waitForTimeout(1500);
  await A.locator('section:has(h2:text-is("Asset library")) button', { hasText: 'Park' }).click();
  const box = await A.locator('main canvas').first().boundingBox();
  await A.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await A.getByRole('button', { name: 'Done' }).click();
  await A.locator('main canvas').first().click({ position: { x: 5, y: 5 } });
  await A.locator('button:has(kbd)').filter({ hasText: 'Open the fountain studio' }).waitFor({ timeout: 8000 });
  step('park placed; studio prompt shown inside the park');
  await A.keyboard.press('KeyE');
  await A.getByRole('dialog', { name: 'Fountain studio' }).waitFor();
  // Realistic AI mode (default): era change with a vision-written instruction.
  await A.getByRole('tab', { name: 'Era change' }).click();
  await A.getByRole('button', { name: '1960' }).click();
  await A.getByLabel('Photo file').setInputFiles(PHOTO);
  await A.getByRole('button', { name: '1. Analyse photo' }).click();
  await A.getByText('Edit instruction').waitFor({ timeout: 60000 });
  const instruction = await A.locator('textarea').inputValue();
  if (instruction.length < 20) throw new Error('no instruction written');
  step(`realism: photo analysed, instruction (${instruction.length} chars) shown`);
  await A.screenshot({ path: OUT + 'realism-studio.png' });
  await A.getByRole('tab', { name: 'Photo → 3D' }).click();
  await A.getByLabel('Photo file').setInputFiles(PHOTO);
  await A.getByText('AI depth map').waitFor({ timeout: 240000 });
  step('AI depth estimated in the browser, 3D preview shown');
  await A.waitForTimeout(2500);
  await A.screenshot({ path: OUT + 'art-studio.png' });
  await A.getByRole('button', { name: 'Place in this park' }).click();
  await A.getByRole('dialog', { name: 'Fountain studio' }).waitFor({ state: 'detached' });
  const count = async (p) => {
    const btn = p.locator('section:has(h2:text-is("City hierarchy")) button').filter({ hasText: /^Photo sculpture/ });
    return (await btn.count()) ? Number((await btn.first().innerText()).replace(/\D+/g, '')) : 0;
  };
  for (let i = 0; i < 50 && (await count(B)) < 1; i++) await B.waitForTimeout(200);
  if ((await count(B)) !== 1) throw new Error('second player does not see the sculpture');
  step('sculpture placed and synced to the second player');
  await A.getByRole('button', { name: 'Third person' }).click();
  await A.waitForTimeout(3000);
  await A.screenshot({ path: OUT + 'art-in-park.png' });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('\nART PASSED');
} catch (e) {
  console.error('\nART FAILED:', e.message);
  console.log(errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
}
