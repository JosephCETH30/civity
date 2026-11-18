// Visual check of the city objects: a Modern City room on Low and High quality, day and night, from the follow
// camera, the top-down camera and a phone. Measures FPS on the phone-sized Low view.
// Usage: node scripts/city-shots.mjs [baseUrl] [prefix]
import { chromium } from 'playwright';
import WebSocket from 'ws';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] || 'http://localhost:3101';
const PREFIX = process.argv[3] || 'city';
const OUT = fileURLToPath(new URL('../e2e-artifacts/', import.meta.url));
const post = (path, body, token) => fetch(BASE + '/api' + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }).then((r) => r.json());
const owner = await post('/auth/name', { name: 'Shots' });
const room = await post('/rooms', { name: 'City shots', description: '', visibility: 'private', maxParticipants: 30, template: 'modern_city', worldSize: 160, defaultRole: 'editor' }, owner.token);
if (!room.id) throw new Error('room: ' + JSON.stringify(room));
const step = (s) => console.log('•', s);

// A second connection controls the clock (day / night).
const ws = new WebSocket(`${BASE.replace('http', 'ws')}/ws?room=${room.id}&token=${encodeURIComponent(owner.token)}`);
await new Promise((res) => ws.on('message', (raw) => JSON.parse(String(raw)).t === 'init' && res()));
const setHour = (h) => ws.send(JSON.stringify({ t: 'sim', patch: { timeOfDay: h, running: false } }));

const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
async function open(quality, viewport) {
  const ctx = await browser.newContext({ viewport, ...(viewport.width < 500 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  await ctx.addInitScript(([t, q]) => {
    localStorage.setItem('civitas.token', t);
    localStorage.setItem('civitas.autoQuality', 'false');
    localStorage.setItem('civitas.quality', JSON.stringify(q));
    localStorage.setItem('civitas.renderMode', '"3d"');
  }, [owner.token, quality]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`${BASE}/room/${room.id}`);
  await p.locator('canvas').first().waitFor({ timeout: 30000 });
  await p.waitForTimeout(2500);
  return p;
}
try {
  for (const quality of ['low', 'high']) {
    const P = await open(quality, { width: 1280, height: 800 });
    for (const [label, hour] of [['day', 11], ['night', 21.5]]) {
      setHour(hour);
      await P.waitForTimeout(1200);
      await P.getByRole('button', { name: 'Third person' }).click();
      await P.waitForTimeout(1800);
      await P.screenshot({ path: `${OUT}${PREFIX}-${quality}-${label}-follow.png` });
      await P.getByRole('button', { name: 'Overview' }).click();
      await P.waitForTimeout(2200);
      await P.screenshot({ path: `${OUT}${PREFIX}-${quality}-${label}-overview.png` });
    }
    step(`${quality}: day and night, follow + overview`);
    await P.close();
  }
  setHour(11);
  const M = await open('low', { width: 390, height: 844 });
  const fps = await M.evaluate(() => new Promise((res) => {
    let n = 0; const t0 = performance.now();
    const f = () => { n++; if (performance.now() - t0 < 5000) requestAnimationFrame(f); else res(Math.round((n * 1000) / (performance.now() - t0))); };
    requestAnimationFrame(f);
  }));
  await M.screenshot({ path: `${OUT}${PREFIX}-phone-low.png` });
  step(`phone viewport, Low: ${fps} FPS (headless software GL, not a real phone)`);
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('\nCITY SHOTS PASSED');
} catch (e) {
  console.error('\nCITY SHOTS FAILED:', e.message);
  process.exitCode = 1;
} finally {
  ws.close();
  await browser.close();
}
