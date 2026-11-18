// Browser check: full 3D transform in the Inspector (with the model matrix), undo, and driving a car that the
// other player sees. Usage: node scripts/edit-drive.mjs [baseUrl]
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] || 'http://localhost:3101';
const OUT = fileURLToPath(new URL('../e2e-artifacts/', import.meta.url));
const post = (path, body, token) => fetch(BASE + '/api' + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }).then((r) => r.json());
const a = await post('/auth/name', { name: 'Tari' });
const b = await post('/auth/name', { name: 'Bayu' });
const room = await post('/rooms', { name: 'Edit and drive', description: '', visibility: 'private', maxParticipants: 30, template: 'empty_sandbox', worldSize: 96, defaultRole: 'editor' }, a.token);
const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
async function open(token, name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript((t) => { localStorage.setItem('civitas.token', t); localStorage.setItem('civitas.autoQuality', 'false'); localStorage.setItem('civitas.renderMode', '"3d"'); }, token);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));
  await p.goto(`${BASE}/room/${room.id}`);
  await p.getByRole('toolbar', { name: 'Meeting and city controls' }).waitFor({ timeout: 30000 });
  await p.waitForTimeout(1200);
  return p;
}
const step = (s) => console.log('•', s);
const canvasCenter = async (P) => { const box = await P.locator('main canvas').first().boundingBox(); return [box.x + box.width / 2, box.y + box.height / 2]; };
try {
  const A = await open(a.token, 'A');
  const B = await open(b.token, 'B');
  await A.getByRole('button', { name: 'Top-down' }).click();
  await B.getByRole('button', { name: 'Top-down' }).click();
  await A.waitForTimeout(1500);
  // ---------- transform + matrix + undo ----------
  const lib = A.locator('section:has(h2:text-is("Asset library"))');
  await lib.getByRole('button', { name: 'Office', exact: true }).click();
  const [cx, cy] = await canvasCenter(A);
  await A.mouse.click(cx + 160, cy);
  await A.getByRole('button', { name: 'Done' }).click();
  await A.waitForTimeout(800);
  await A.locator('section:has(h2:text-is("City hierarchy"))').getByRole('button', { name: /^Office/ }).click();
  await A.getByRole('button', { name: /Office at/ }).first().click();
  const rotX = A.getByLabel('Rotation (°) X');
  await rotX.waitFor();
  await rotX.fill('20');
  await rotX.press('Enter');
  const posY = A.getByLabel('Position (m) Y');
  await posY.fill('4');
  await posY.press('Enter');
  await A.waitForTimeout(800);
  await A.getByText('Model matrix M = T · R · S').click();
  const matrix = await A.getByRole('table', { name: '4 by 4 model matrix' }).innerText();
  if (!/4\.00/.test(matrix)) throw new Error('matrix does not show the lifted position:\n' + matrix);
  step('Inspector: rotation X 20°, lifted 4 m; the 4x4 model matrix shows T · R · S');
  await A.screenshot({ path: OUT + 'transform-inspector.png' });
  await A.keyboard.press('Meta+z');
  await A.keyboard.press('Control+z');
  await A.waitForTimeout(800);
  const y = await A.getByLabel('Position (m) Y').inputValue();
  const rx = await A.getByLabel('Rotation (°) X').inputValue();
  if (y !== '0' || rx !== '0') throw new Error(`undo did not restore: y=${y} rx=${rx}`);
  step('Undo (Ctrl/Cmd+Z) twice: back to y 0 and no tilt');
  await A.keyboard.press('Escape');
  // ---------- drive ----------
  await lib.getByRole('button', { name: 'Road', exact: true }).click();
  await A.mouse.click(cx, cy);
  await A.getByRole('button', { name: 'Done' }).click();
  await A.locator('main canvas').first().click({ position: { x: 5, y: 5 } });
  await A.locator('button:has(kbd)').filter({ hasText: 'Drive a car' }).waitFor({ timeout: 8000 });
  await A.keyboard.press('KeyE');
  await A.locator('button:has(kbd)').filter({ hasText: 'Get out of the car' }).waitFor({ timeout: 5000 });
  await A.keyboard.down('KeyW'); await A.waitForTimeout(1200); await A.keyboard.up('KeyW');
  step('on a road: E takes a car, W drives');
  await A.getByRole('button', { name: 'Third person' }).click();
  await A.waitForTimeout(1500);
  await A.screenshot({ path: OUT + 'drive-a.png' });
  await B.waitForTimeout(1000);
  await B.screenshot({ path: OUT + 'drive-b.png' });
  await A.keyboard.press('KeyE');
  await A.locator('button:has(kbd)').filter({ hasText: 'Get out of the car' }).waitFor({ state: 'detached', timeout: 5000 });
  step('E again: out of the car');
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('\nEDIT+DRIVE PASSED');
} catch (e) {
  console.error('\nEDIT+DRIVE FAILED:', e.message);
  console.log(errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
}
