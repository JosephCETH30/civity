// Visual + performance check of the Citizen avatar: one browser player on Low quality and 19 bot players around it
// (walking, running, idle, waving, jumping, sitting on a bench, knocked down, armed). Saves screenshots and
// measures the frame rate. Usage: node scripts/avatars.mjs [baseUrl]
import { chromium } from 'playwright';
import WebSocket from 'ws';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] || 'http://localhost:3101';
const OUT = fileURLToPath(new URL('../e2e-artifacts/', import.meta.url));
const post = (path, body, token) => fetch(BASE + '/api' + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }).then((r) => r.json());
const owner = await post('/auth/name', { name: 'Viewer' });
const room = await post('/rooms', { name: 'Avatar test', description: '', visibility: 'private', maxParticipants: 20, template: 'empty_sandbox', worldSize: 96, defaultRole: 'editor' }, owner.token);
const step = (s) => console.log('•', s);

const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
const bots = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript((t) => {
    localStorage.setItem('civitas.token', t);
    localStorage.setItem('civitas.autoQuality', 'false');
    localStorage.setItem('civitas.quality', '"low"');
    localStorage.setItem('civitas.renderMode', '"3d"');
  }, owner.token);
  const A = await ctx.newPage();
  A.on('pageerror', (e) => errors.push(e.message));
  await A.goto(`${BASE}/room/${room.id}`);
  await A.getByRole('toolbar', { name: 'Meeting and city controls' }).waitFor({ timeout: 30000 });
  await A.waitForTimeout(1500);

  // Bots join, learn where the viewer stands and form an arc between the viewer and the camera's view (the default
  // camera sits on the +z side looking toward -z), facing the camera (r = 0 faces +z).
  const states = ['walk', 'walk', 'idle', 'idle', 'wave', 'jump', 'sit', 'fall', 'walk', 'idle', 'wave', 'idle', 'walk', 'idle', 'jump', 'idle', 'walk', 'idle', 'idle'];
  let me = null;
  for (let i = 0; i < 19; i++) {
    const u = await post('/auth/name', { name: `Bot ${i + 1}` });
    if (!u.token) throw new Error(`bot ${i + 1} could not sign up: ${u.error} (sign-ups are limited to 20 per minute; wait and retry)`);
    const ws = new WebSocket(`${BASE.replace('http', 'ws')}/ws?room=${room.id}&token=${encodeURIComponent(u.token)}`);
    const init = await new Promise((res, rej) => {
      ws.on('message', (raw) => { const m = JSON.parse(String(raw)); if (m.t === 'init') res(m); if (m.t === 'error' && m.fatal) rej(new Error(m.message)); });
      ws.on('error', rej);
      ws.on('close', () => rej(new Error(`bot ${i + 1} was disconnected`)));
      setTimeout(() => rej(new Error(`bot ${i + 1}: no init within 10 s`)), 10000);
    });
    me ??= init.players.find((p) => p.name === 'Viewer').p;
    bots.push({ ws, i, state: states[i] });
  }
  const [cx, , cz] = me;
  // A bench for the sitting bot, a few metres in front of the viewer.
  bots[6].ws.send(JSON.stringify({ t: 'obj_add', spec: { type: 'bench', position: { x: cx, y: 0, z: cz - 5 }, rotationY: 0, scale: { x: 1, y: 1, z: 1 }, props: {} } }));
  bots[0].ws.send(JSON.stringify({ t: 'battle', action: 'join' }));
  let t = 0;
  const tick = setInterval(() => {
    t += 0.1;
    for (const b of bots) {
      const ang = (b.i / 19) * Math.PI * 1.2 - Math.PI * 0.6; // arc in front of the viewer
      const rad = 7 + (b.i % 3) * 2.5;
      let x = cx + Math.sin(ang) * rad, z = cz - Math.cos(ang) * rad, r = -ang * 0.5, y = 0;
      if (b.state === 'walk') { const run = b.i % 4 === 0 ? 12 : 6; x += Math.sin(t * run / 4) * 2; r = Math.cos(t * run / 4) > 0 ? Math.PI / 2 : -Math.PI / 2; }
      if (b.state === 'jump') y = Math.max(0, Math.sin(t * 4) * 1.2);
      if (b.state === 'sit') { x = cx - 0.5; z = cz - 5 + 0.05; r = 0; } // bench seat (as interactions.ts computes it), facing the camera
      b.ws.send(JSON.stringify({ t: 'move', p: [x, y, z], r, a: b.state === 'jump' ? (y > 0.05 ? 'jump' : 'idle') : b.state }));
    }
  }, 100);
  await A.waitForTimeout(3000);
  step('19 bots placed around the viewer (walk, run, idle, wave, jump, sit on a bench, fall, armed)');

  const fps = await A.evaluate(() => new Promise((res) => {
    let n = 0; const t0 = performance.now();
    const f = () => { n++; if (performance.now() - t0 < 5000) requestAnimationFrame(f); else res(Math.round((n * 1000) / (performance.now() - t0))); };
    requestAnimationFrame(f);
  }));
  step(`20 avatars on Low quality: ${fps} FPS in headless Chrome (software GL, not a phone measurement)`);
  await A.screenshot({ path: OUT + 'avatars-low.png' });
  await A.getByRole('button', { name: 'Top-down' }).click();
  await A.waitForTimeout(1500);
  await A.screenshot({ path: OUT + 'avatars-top.png' });
  clearInterval(tick);
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('\nAVATARS PASSED');
} catch (e) {
  console.error('\nAVATARS FAILED:', e.message);
  process.exitCode = 1;
} finally {
  for (const b of bots) b.ws.close();
  await browser.close();
}
