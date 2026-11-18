// Visual check of every building type x style x floor count (1, 3, 8), day and night, Low and High.
// Usage: node scripts/building-shots.mjs [baseUrl]
import { chromium } from 'playwright';
import WebSocket from 'ws';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] || 'http://localhost:3101';
const OUT = fileURLToPath(new URL('../e2e-artifacts/', import.meta.url));
const post = (path, body, token) => fetch(BASE + '/api' + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }).then((r) => r.json());
const owner = await post('/auth/name', { name: 'Builder' });
const room = await post('/rooms', { name: 'Buildings', description: '', visibility: 'private', maxParticipants: 30, template: 'empty_sandbox', worldSize: 160, defaultRole: 'editor' }, owner.token);
const ws = new WebSocket(`${BASE.replace('http', 'ws')}/ws?room=${room.id}&token=${encodeURIComponent(owner.token)}`);
const errorsWs = [];
await new Promise((res) => ws.on('message', (raw) => { const m = JSON.parse(String(raw)); if (m.t === 'init') res(); if (m.t === 'error') errorsWs.push(m.message); }));
const types = ['residential', 'office', 'commercial', 'school', 'hospital'];
const styles = ['modern', 'classic', 'industrial'];
const floorsList = [1, 3, 8];
let row = 0;
for (const floors of floorsList) for (const style of styles) {
  types.forEach((type, col) => {
    ws.send(JSON.stringify({ t: 'obj_add', spec: { type, position: { x: -40 + col * 20, y: 0, z: -68 + row * 17 }, rotationY: 0, scale: { x: 1, y: 1, z: 1 }, props: { style, floors } } }));
  });
  row++;
  await new Promise((r) => setTimeout(r, 300));
}
const setHour = (h) => ws.send(JSON.stringify({ t: 'sim', patch: { timeOfDay: h, running: false } }));
const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
try {
  for (const quality of ['low', 'high']) {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    await ctx.addInitScript(([t, q]) => {
      localStorage.setItem('civitas.token', t); localStorage.setItem('civitas.autoQuality', 'false');
      localStorage.setItem('civitas.quality', JSON.stringify(q)); localStorage.setItem('civitas.renderMode', '"3d"');
      localStorage.setItem('civitas.sidebar.left', '"hidden"'); localStorage.setItem('civitas.sidebar.rightMini', 'true');
    }, [owner.token, quality]);
    const P = await ctx.newPage();
    P.on('pageerror', (e) => errors.push(e.message));
    await P.goto(`${BASE}/room/${room.id}`);
    await P.locator('canvas').first().waitFor({ timeout: 30000 });
    await P.getByRole('button', { name: 'Overview' }).click();
    for (const [label, hour] of [['day', 11], ['night', 21.5]]) {
      setHour(hour);
      await P.waitForTimeout(3500);
      await P.screenshot({ path: `${OUT}buildings-${quality}-${label}.png` });
    }
    console.log('•', quality, 'day + night');
    await ctx.close();
  }
  if (errorsWs.length) throw new Error('server rejected: ' + errorsWs.join('; '));
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('\nBUILDINGS PASSED');
} catch (e) {
  console.error('\nBUILDINGS FAILED:', e.message);
  process.exitCode = 1;
} finally {
  ws.close();
  await browser.close();
}
