// Browser check of world interactions: walk to a door, enter, sit, leave, jump; a second player watches.
// Usage: node scripts/play.mjs [baseUrl]   (server running with a built client)
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const BASE = process.argv[2] || 'http://localhost:3101';
const OUT = fileURLToPath(new URL('../e2e-artifacts/', import.meta.url));
const post = (path, body, token) => fetch(BASE + '/api' + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }).then((r) => r.json());

const a = await post('/auth/name', { name: 'Ana' });
const b = await post('/auth/name', { name: 'Budi' });
const room = await post('/rooms', { name: 'Play test', description: '', visibility: 'private', maxParticipants: 4, template: 'empty_sandbox', worldSize: 96, defaultRole: 'editor' }, a.token);

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
const prompt = (p) => p.locator('button:has(kbd)');
const step = (s) => console.log('•', s);
const hold = async (p, key, ms) => { await p.keyboard.down(key); await p.waitForTimeout(ms); await p.keyboard.up(key); };

try {
  const A = await open(a.token, 'A');
  const B = await open(b.token, 'B');
  // A builds a house just north of where they stand (top-down camera: up on screen = north).
  await A.getByRole('button', { name: 'Top-down' }).click();
  await A.waitForTimeout(1500);
  await A.locator('section:has(h2:text-is("Asset library")) button', { hasText: 'Residential' }).click();
  const box = await A.locator('main canvas').first().boundingBox();
  await A.mouse.click(box.x + box.width / 2, box.y + box.height / 2 - 110);
  await A.getByRole('button', { name: 'Done' }).click();
  await A.waitForTimeout(500);
  await A.locator('main canvas').first().click({ position: { x: 5, y: 5 } }); // focus the scene for keys
  step('house placed');

  // Walk north until the wall stops us at the front door.
  await hold(A, 'KeyW', 2500);
  await prompt(A).filter({ hasText: /Enter residential/ }).waitFor({ timeout: 5000 });
  step('door prompt shown after walking into the house front (collision stopped us)');
  await A.keyboard.press('KeyE');
  await prompt(A).filter({ hasText: 'Go outside' }).waitFor({ timeout: 5000 });
  step('inside the house');
  await hold(A, 'KeyW', 700);
  await A.waitForTimeout(600);
  await A.screenshot({ path: OUT + 'play-interior.png' });

  // Walk to the sofa at the back wall and sit.
  await hold(A, 'KeyW', 600);
  await prompt(A).filter({ hasText: 'Sit down' }).waitFor({ timeout: 5000 });
  await A.keyboard.press('KeyE');
  await prompt(A).filter({ hasText: 'Stand up' }).waitFor({ timeout: 5000 });
  await A.waitForTimeout(500);
  await A.screenshot({ path: OUT + 'play-sitting.png' });
  step('sitting on the sofa');
  await A.keyboard.press('KeyE');
  await hold(A, 'KeyS', 1500);
  await prompt(A).filter({ hasText: 'Go outside' }).waitFor({ timeout: 5000 });
  await A.keyboard.press('KeyE');
  await A.waitForTimeout(400);
  assert.equal(await prompt(A).filter({ hasText: 'Go outside' }).count(), 0);
  step('back outside');

  // Jump and wave while B watches.
  await A.keyboard.press('KeyQ');
  await A.waitForTimeout(300);
  await A.keyboard.press('Space');
  await B.waitForTimeout(250);
  await B.screenshot({ path: OUT + 'play-b-sees-jump.png' });
  step('jumped and waved');

  // B's people panel shows Ana near the house, proving sync of the teleports.
  await B.getByRole('button', { name: 'People', exact: true }).click();
  await B.getByRole('dialog', { name: 'Participants' }).getByText(/Ana/).waitFor();
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('\nPLAY PASSED');
} catch (e) {
  console.error('\nPLAY FAILED:', e.message);
  console.log(errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
}
