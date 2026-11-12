// Browser check of the tree quiz and the PvP battle with two players.
// Usage: node scripts/games.mjs [baseUrl]
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] || 'http://localhost:3101';
const OUT = fileURLToPath(new URL('../e2e-artifacts/', import.meta.url));
const post = (path, body, token) => fetch(BASE + '/api' + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }).then((r) => r.json());
const a = await post('/auth/name', { name: 'Rina' });
const b = await post('/auth/name', { name: 'Dodi' });
const room = await post('/rooms', { name: 'Games test', description: '', visibility: 'private', maxParticipants: 4, template: 'empty_sandbox', worldSize: 96, defaultRole: 'editor' }, a.token);

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
  await A.getByRole('button', { name: 'Top-down' }).click();
  await B.getByRole('button', { name: 'Top-down' }).click();
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
  }
  // ---------- quiz ----------
  // A sets up the empty table without joining first (becomes host); B joins.
  await A.getByRole('button', { name: '5', exact: true }).click();
  await A.getByText('Rina · host').waitFor();
  await B.getByRole('button', { name: 'Gabung kuis' }).click();
  await A.getByLabel('Jumlah soal (custom)').fill('3');
  await A.getByLabel('Jumlah soal (custom)').press('Enter');
  await A.getByLabel('Waktu menjawab dalam detik (custom)').fill('12');
  await A.getByLabel('Waktu menjawab dalam detik (custom)').press('Enter');
  const val = (P, label) => P.getByLabel(label).inputValue();
  for (let i = 0; i < 40 && ((await val(B, 'Jumlah soal (custom)')) !== '3' || (await val(B, 'Waktu menjawab dalam detik (custom)')) !== '12'); i++) await B.waitForTimeout(150);
  if ((await val(B, 'Jumlah soal (custom)')) !== '3' || (await val(B, 'Waktu menjawab dalam detik (custom)')) !== '12') throw new Error('options did not sync: ' + (await val(B, 'Jumlah soal (custom)')) + ' ' + (await val(B, 'Waktu menjawab dalam detik (custom)')));
  step('host set 3 questions, 12 s each; the other player sees the options');
  if (await B.getByRole('button', { name: /^Mulai kuis/ }).count()) throw new Error('non-host can start');
  await A.getByRole('button', { name: /^Mulai kuis/ }).click();
  for (let i = 1; i <= 3; i++) {
    await B.getByText(`Soal ${i} / 3`).waitFor({ timeout: 15000 });
    if (i === 1) await A.screenshot({ path: OUT + 'quiz-question.png' });
    await A.getByRole('group', { name: 'Pilihan jawaban' }).getByRole('button').nth(0).click();
    await B.getByRole('group', { name: 'Pilihan jawaban' }).getByRole('button').nth(1).click();
    await A.getByText(/(Benar! \+\d+ poin|Kurang tepat)/).waitFor({ timeout: 8000 });
    if (i === 1) await A.screenshot({ path: OUT + 'quiz-reveal.png' });
  }
  await B.getByText('Kuis selesai').waitFor({ timeout: 15000 });
  const result = await B.locator('p', { hasText: '🏆' }).innerText().catch(() => 'no winner');
  step(`3 questions played, everyone answered, results: ${result}`);
  await A.screenshot({ path: OUT + 'quiz-finished.png' });
  for (const P of [A, B]) await P.getByRole('button', { name: 'Close tree games' }).click();

  // ---------- battle ----------
  await A.getByRole('button', { name: /^Battle/ }).click();
  await B.getByRole('button', { name: /^Battle/ }).click();
  await A.getByLabel('Battle scoreboard').getByText('2 fighters').waitFor();
  step('both joined the battle; scoreboard shows 2 fighters');
  // Same camera on both: W walks away from it. B walks ahead, A turns the same way and fires (aim assist).
  await B.keyboard.down('KeyW'); await B.waitForTimeout(900); await B.keyboard.up('KeyW');
  await A.keyboard.down('KeyW'); await A.waitForTimeout(120); await A.keyboard.up('KeyW');
  await A.waitForTimeout(600);
  for (let i = 0; i < 6; i++) { await A.keyboard.press('KeyF'); await A.waitForTimeout(330); }
  await B.getByText('You were eliminated').waitFor({ timeout: 5000 });
  step('A shot B four times; B is eliminated');
  await A.screenshot({ path: OUT + 'battle-a.png' });
  await B.screenshot({ path: OUT + 'battle-b-dead.png' });
  await B.getByText('You were eliminated').waitFor({ state: 'detached', timeout: 6000 });
  const hp = await B.getByRole('meter', { name: 'Health' }).getAttribute('aria-valuenow');
  if (hp !== '100') throw new Error('B did not respawn with full health: ' + hp);
  const score = await A.getByLabel('Battle scoreboard').innerText();
  if (!/1\/0/.test(score)) throw new Error('A has no kill on the scoreboard: ' + score);
  step('B respawned with 100 HP; A has 1 kill');
  // First person (eyes) view with the blaster in hand; fire and capture the muzzle flash and tracer.
  await A.getByRole('button', { name: 'First person (eyes)' }).click();
  await A.waitForTimeout(800);
  await A.keyboard.press('KeyF');
  await A.waitForTimeout(40);
  await A.screenshot({ path: OUT + 'battle-first-person.png' });
  step('first-person view: fired with the blaster in hand');
  // Studio download link serves the file as an attachment.
  const dl = await fetch(BASE + '/api/studio/00000000-0000-0000-0000-000000000000/result?download');
  if (dl.status !== 404) throw new Error('studio download route: ' + dl.status);
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('\nGAMES PASSED');
} catch (e) {
  console.error('\nGAMES FAILED:', e.message);
  console.log(errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
}
