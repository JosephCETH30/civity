// Browser end-to-end check against a running server (default http://localhost:3101) that serves client/dist.
// Uses the installed Chrome with fake camera/mic. Usage: node scripts/e2e.mjs [baseUrl]
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const BASE = process.argv[2] || 'http://localhost:3101';
const OUT = fileURLToPath(new URL('../e2e-artifacts/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const errors = [];
async function newPage(name, opts = {}) {
  const ctx = await browser.newContext({ permissions: ['microphone', 'camera'], ...opts });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[${name}] pageerror: ${e.message}\n${(e.stack || "").split("\n").slice(0, 8).join("\n")}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|DevTools/.test(m.text())) errors.push(`[${name}] console: ${m.text()}`); });
  return page;
}
const step = (s) => console.log('•', s);
const officeCount = async (page) => {
  const btn = page.locator('section:has(h2:text-is("City hierarchy")) button').filter({ hasText: /^Office/ }).first();
  if (!(await btn.count())) return 0;
  return Number((await btn.innerText()).replace(/\D+/g, ''));
};
const shot = (page, n) => page.screenshot({ path: OUT + n + '.png' });

try {
  // --- A: desktop owner creates a room with only a username ---
  const A = await newPage('A', { viewport: { width: 1440, height: 900 } });
  step('A: landing → create room');
  const t0 = Date.now();
  await A.goto(BASE + '/');
  await A.getByRole('heading', { name: 'CIVITAS' }).waitFor();
  console.log(`  landing visible in ${Date.now() - t0} ms (localhost)`);
  await shot(A, '01-landing');
  await A.getByRole('link', { name: 'Create a city room' }).click();
  await A.getByLabel('Username').fill('Alice');
  await A.getByRole('button', { name: 'Continue' }).click();
  await A.getByLabel('Room name').fill('E2E City');
  await A.getByRole('button', { name: 'Create city' }).click();
  await A.waitForURL(/\/room\//);
  await A.locator('canvas').first().waitFor({ timeout: 30000 });
  await A.getByRole('toolbar', { name: 'Meeting and city controls' }).waitFor();
  const code = (await A.getByRole('button', { name: /Invite/ }).innerText()).split('·')[1].trim();
  step(`A in room, invite code ${code}`);
  await A.waitForTimeout(1500);
  await shot(A, '02-room-desktop');

  // --- B: second desktop user joins by invite link with a username ---
  const B = await newPage('B', { viewport: { width: 1280, height: 800 } });
  await B.goto(`${BASE}/join/${code}`);
  await B.getByLabel('Username').fill('Bob');
  await B.getByRole('button', { name: 'Join city' }).click();
  await B.getByRole('button', { name: /Enter as Bob/ }).click();
  await B.getByRole('toolbar', { name: 'Meeting and city controls' }).waitFor({ timeout: 30000 });
  step('B joined');

  // --- C: mobile user joins ---
  const C = await newPage('C', { ...devices['Pixel 7'] });
  await C.goto(`${BASE}/join/${code}`);
  await C.getByLabel('Username').fill('Citra');
  await C.getByRole('button', { name: 'Join city' }).click();
  await C.getByRole('button', { name: /Enter as Citra/ }).click();
  await C.getByRole('navigation', { name: 'Room controls' }).waitFor({ timeout: 30000 });
  const overflow = await C.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert.ok(overflow <= 0, `mobile horizontal overflow ${overflow}px`);
  await C.getByRole('application', { name: 'Movement joystick' }).waitFor();
  step('C (mobile) joined, no horizontal overflow, joystick present');
  await C.waitForTimeout(1000);
  await shot(C, '03-room-mobile');

  await A.getByText('3 online').waitFor({ timeout: 10000 });
  step('presence: A sees 3 online');

  // --- Chat ---
  await A.getByRole('button', { name: 'Chat', exact: true }).click();
  await A.getByLabel('Chat message').fill('hello from alice');
  await A.getByLabel('Chat message').press('Enter');
  await B.getByRole('button', { name: 'Chat', exact: true }).click();
  await B.getByText('hello from alice').waitFor();
  await C.getByRole('button', { name: 'Chat', exact: true }).click();
  await C.getByText('hello from alice').waitFor();
  await C.getByRole('button', { name: 'Close Chat' }).click();
  // Desktop chat lives in the right-hand side panel (Meet-style); close it to get the tabs back.
  await A.getByRole('dialog', { name: 'Chat' }).waitFor();
  await A.getByRole('button', { name: 'Close Chat' }).click();
  await B.getByRole('button', { name: 'Close Chat' }).click();
  step('chat delivered to B and C (desktop chat opens in the right panel)');

  // --- Building: A places an office, B sees it ---
  const before = await officeCount(A);
  await A.getByRole('button', { name: 'Top-down' }).click();
  await A.waitForTimeout(1200);
  await A.locator('section:has(h2:text-is("Asset library")) button', { hasText: 'Office' }).click();
  const box = await A.locator('main canvas').first().boundingBox();
  await A.mouse.click(box.x + box.width / 2 + 60, box.y + box.height / 2 - 40);
  for (let i = 0; i < 50 && (await officeCount(A)) !== before + 1; i++) await A.waitForTimeout(100);
  assert.equal(await officeCount(A), before + 1, 'office placed for A');
  for (let i = 0; i < 50 && (await officeCount(B)) !== before + 1; i++) await B.waitForTimeout(100);
  assert.equal(await officeCount(B), before + 1, 'office visible to B');
  await A.getByRole('button', { name: 'Done' }).click();
  step(`placement synced (offices ${before} → ${before + 1})`);

  // --- AI ---
  await A.getByRole('tab', { name: 'AI' }).click();
  await A.getByLabel('AI request').fill('Create a modern office building with ten floors near the park');
  await A.getByRole('button', { name: 'Ask assistant' }).click();
  await A.getByText('Created 1 office with 10 floors near the park.', { exact: true }).waitFor({ timeout: 15000 });
  for (let i = 0; i < 50 && (await officeCount(B)) !== before + 2; i++) await B.waitForTimeout(100);
  assert.equal(await officeCount(B), before + 2, 'AI office visible to B');
  step('AI created a validated 10-floor office, synced to B');
  await A.getByLabel('AI request').fill('Analyze the distribution of public facilities');
  await A.getByRole('button', { name: 'Ask assistant' }).click();
  await A.getByText('Verified city metrics').waitFor({ timeout: 15000 });
  step('AI analysis shows verified metrics');

  // --- Movement sync: B walks, A sees B's location change ---
  await A.getByRole('button', { name: 'People', exact: true }).click();
  const locOf = async () => (await A.getByRole('dialog', { name: 'Participants' }).innerText()).match(/Bob[\s\S]*?at (-?\d+), (-?\d+)/)?.slice(1).join(',');
  await A.waitForTimeout(800);
  const l0 = await locOf();
  await B.locator('main canvas').first().click({ position: { x: 5, y: 5 } });
  await B.keyboard.down('KeyW'); await B.waitForTimeout(1500); await B.keyboard.up('KeyW');
  await A.waitForTimeout(1500);
  const l1 = await locOf();
  assert.ok(l0 && l1 && l0 !== l1, `B position should change on A (${l0} → ${l1})`);
  step(`movement synced (Bob ${l0} → ${l1})`);
  await A.getByRole('button', { name: 'Close Participants' }).click();

  if (!process.env.SKIP_MEDIA) {
    // --- Voice/video via LiveKit ---
    await A.getByRole('button', { name: 'Unmute' }).click();
    await A.getByRole('button', { name: 'Mute' }).waitFor({ timeout: 15000 });
    await A.getByRole('button', { name: 'Start video' }).click();
    await A.getByRole('button', { name: 'Stop video' }).waitFor({ timeout: 15000 });
    await B.getByText(/Video \(1\)/).waitFor({ timeout: 15000 });
    step('A mic + camera published; B receives A\'s video tile');
    await B.waitForTimeout(1500);
    await shot(B, '04-video-on-B');
  }

  // --- Simulation shared ---
  await A.getByRole('tab', { name: 'Simulation' }).click();
  // Cities start with the simulation running; pausing must reach everyone.
  await A.getByRole('button', { name: 'Pause', exact: true }).click();
  await B.getByRole('tab', { name: 'Simulation' }).click();
  await B.getByText('Paused', { exact: true }).waitFor();
  step('simulation pause synced');

  // --- Persistence across reload ---
  const final = await officeCount(A);
  await A.reload();
  await A.getByRole('toolbar', { name: 'Meeting and city controls' }).waitFor({ timeout: 30000 });
  for (let i = 0; i < 50 && (await officeCount(A)) !== final; i++) await A.waitForTimeout(100);
  assert.equal(await officeCount(A), final, 'objects persisted after reload');
  step('city state persisted after reload');

  // --- 2D fallback on mobile ---
  await C.getByRole('button', { name: 'More', exact: true }).click();
  await C.getByRole('tab', { name: 'Settings' }).click();
  await C.getByRole('combobox').first().selectOption('2d');
  await C.getByRole('img', { name: '2D city map' }).waitFor();
  await C.getByRole('button', { name: 'Close More' }).click();
  await C.waitForTimeout(800);
  await shot(C, '05-mobile-2d');
  step('mobile switched to 2D map, still in the same room');
  await A.getByText('3 online').waitFor();

  const fatal = errors.filter((e) => !/WebGL|GPU stall|ReadPixels|Autoplay|NotAllowedError|websocket|Failed to load resource/i.test(e));
  if (fatal.length) { console.log('Browser errors:\n' + fatal.join('\n')); process.exitCode = 1; }
  else console.log('\nE2E PASSED. Screenshots in e2e-artifacts/');
} catch (e) {
  console.error('\nE2E FAILED:', e.message);
  console.log(errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
}
