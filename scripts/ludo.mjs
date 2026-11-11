// Browser check of the per-tree Ludo table: two players at one tree sit, start, roll, and see the same board.
// Usage: node scripts/ludo.mjs [baseUrl]
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] || 'http://localhost:3101';
const OUT = fileURLToPath(new URL('../e2e-artifacts/', import.meta.url));
const post = (path, body, token) => fetch(BASE + '/api' + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }).then((r) => r.json());
const a = await post('/auth/name', { name: 'Rina' });
const b = await post('/auth/name', { name: 'Dodi' });
const room = await post('/rooms', { name: 'Ludo test', description: '', visibility: 'private', maxParticipants: 4, template: 'empty_sandbox', worldSize: 96, defaultRole: 'editor' }, a.token);

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
try {
  const A = await open(a.token, 'A');
  const B = await open(b.token, 'B');
  // Both spawn at the centre of the empty sandbox; A plants a tree right there.
  await A.getByRole('button', { name: 'Top-down' }).click();
  await A.waitForTimeout(1500);
  await A.locator('section:has(h2:text-is("Asset library"))').getByRole('button', { name: 'Tree', exact: true }).click();
  const box = await A.locator('main canvas').first().boundingBox();
  await A.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await A.getByRole('button', { name: 'Done' }).click();
  for (const P of [A, B]) {
    await P.locator('main canvas').first().click({ position: { x: 5, y: 5 } });
    await P.locator('button:has(kbd)').filter({ hasText: 'Play at this tree' }).waitFor({ timeout: 8000 });
    await P.keyboard.press('KeyE');
    await P.getByRole('dialog', { name: 'Tree games' }).waitFor();
    await P.getByRole('tab', { name: 'Ludo' }).click();
  }
  step('both players opened the same tree table');
  await A.getByRole('listitem').filter({ hasText: 'Red seat' }).getByRole('button', { name: 'Sit' }).click();
  await B.getByRole('listitem').filter({ hasText: 'Yellow seat' }).getByRole('button', { name: 'Sit' }).click();
  await A.getByRole('button', { name: /Start game \(2 players\)/ }).click();
  await B.getByText(/Rina starts/).waitFor();
  step('seated and started; both see the same state');
  await A.getByRole('button', { name: 'Roll dice' }).click();
  await B.getByRole('img', { name: /Dice shows [1-6]/ }).waitFor();
  const shown = await B.getByRole('img', { name: /Dice shows/ }).getAttribute('aria-label');
  step(`server rolled, other player sees it: ${shown}`);
  if (/shows 6/.test(shown)) {
    await A.getByRole('button', { name: /Move red token/ }).first().click();
    await B.getByText(/brought a token out/).waitFor();
    step('six: token brought out, visible to the other player');
  } else {
    await B.getByText('Your turn: roll the dice').waitFor();
    step('no six: turn passed to the other player');
  }
  await A.screenshot({ path: OUT + 'ludo.png' });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('\nLUDO PASSED');
} catch (e) {
  console.error('\nLUDO FAILED:', e.message);
  console.log(errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
}
