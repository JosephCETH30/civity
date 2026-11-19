// Browser check: place a scene camera, aim it, look through it (Blender-style camera view), exit, delete, undo.
// Usage: node scripts/camera.mjs [baseUrl]
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] || 'http://localhost:3101';
const OUT = fileURLToPath(new URL('../e2e-artifacts/', import.meta.url));
const post = (path, body, token) => fetch(BASE + '/api' + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }).then((r) => r.json());
const a = await post('/auth/name', { name: 'Kamera' });
const room = await post('/rooms', { name: 'Cameras', description: '', visibility: 'private', maxParticipants: 30, template: 'modern_city', worldSize: 160, defaultRole: 'editor' }, a.token);
const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
const step = (s) => console.log('•', s);
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript((t) => { localStorage.setItem('civitas.token', t); localStorage.setItem('civitas.autoQuality', 'false'); localStorage.setItem('civitas.renderMode', '"3d"'); }, a.token);
  const A = await ctx.newPage();
  A.on('pageerror', (e) => errors.push(e.message));
  await A.goto(`${BASE}/room/${room.id}`);
  await A.getByRole('toolbar', { name: 'Meeting and city controls' }).waitFor({ timeout: 30000 });
  await A.getByRole('button', { name: 'Top-down' }).click();
  await A.waitForTimeout(1500);
  await A.locator('section:has(h2:text-is("Asset library"))').getByRole('button', { name: 'Camera', exact: true }).click();
  const box = await A.locator('main canvas').first().boundingBox();
  await A.mouse.click(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40);
  await A.getByRole('button', { name: 'Done' }).click();
  await A.locator('section:has(h2:text-is("City hierarchy"))').getByRole('button', { name: /^Camera/ }).click();
  await A.getByRole('button', { name: /Camera at/ }).first().click();
  await A.getByLabel('Field of view').waitFor();
  step('camera placed and selected; Inspector shows field of view');
  await A.getByRole('button', { name: 'Overview' }).click();
  await A.waitForTimeout(2000);
  await A.screenshot({ path: OUT + 'camera-object.png' });
  const posY = A.getByLabel('Position (m) Y');
  await posY.fill('12'); await posY.press('Enter');
  const rotX = A.getByLabel('Rotation (°) X');
  await rotX.fill('35'); await rotX.press('Enter');
  await A.waitForTimeout(600);
  await A.getByRole('button', { name: 'View through camera' }).click();
  await A.getByText(/^Camera view:/).waitFor();
  await A.waitForTimeout(1500);
  await A.screenshot({ path: OUT + 'camera-view.png' });
  step('lifted to 12 m, tilted 35° down, looking through it');
  await A.keyboard.press('Escape');
  await A.getByText(/^Camera view:/).waitFor({ state: 'detached' });
  step('Esc: back to the normal camera');
  await A.getByRole('button', { name: 'Delete object' }).click();
  const count = () => A.locator('section:has(h2:text-is("City hierarchy"))').getByRole('button', { name: /^Camera/ }).count();
  for (let i = 0; i < 20 && (await count()); i++) await A.waitForTimeout(150);
  if (await count()) throw new Error('camera not deleted');
  await A.keyboard.press('Control+z');
  for (let i = 0; i < 20 && !(await count()); i++) await A.waitForTimeout(150);
  if (!(await count())) throw new Error('undo did not bring the camera back');
  step('deleted, then Ctrl+Z brought it back');
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('\nCAMERA PASSED');
} catch (e) {
  console.error('\nCAMERA FAILED:', e.message);
  console.log(errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
}
