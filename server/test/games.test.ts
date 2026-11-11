import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BATTLE, type CityObject, type ServerMessage } from '@civitas/shared';
import { QuizTable, drawQuestions } from '../src/quiz.ts';
import { QUIZ_BANK } from '../src/quizBank.ts';
import { Battle } from '../src/battle.ts';

test('quiz bank: every question has 4 distinct choices', () => {
  assert.ok(QUIZ_BANK.length >= 150);
  for (const [, q, ...choices] of QUIZ_BANK) assert.equal(new Set(choices).size, 4, q);
  const qs = drawQuestions(10, 'Sains');
  assert.equal(qs.length, 10);
  for (const q of qs) { assert.equal(q.category, 'Sains'); assert.ok(q.correct >= 0 && q.correct < 4); }
});

test('quiz: host sets options, answers stay hidden until the question closes, faster correct answers score more', () => {
  const fail = (m: string): never => { throw new Error(m); };
  const t = new QuizTable('tree', () => {}, fail);
  t.join({ id: 'a', userId: 'ua', name: 'Ana' });
  t.join({ id: 'b', userId: 'ub', name: 'Budi' });
  assert.throws(() => t.config('b', { count: 5 }), /host/);
  t.config('a', { count: 3, seconds: 10, category: 'Geografi' });
  t.start('a', Date.now());
  const v = t.view();
  assert.equal(v.phase, 'question');
  assert.equal(v.correct, null);
  assert.equal(v.question!.category, 'Geografi');
  const right = t.questions[0].correct;
  t.answer('a', right, t.deadline - 9000); // fast
  assert.equal(t.view().players.find((p) => p.sessionId === 'a')!.choice, null, 'choice hidden while open');
  t.answer('b', (right + 1) % 4, t.deadline - 1000);
  const r = t.view(); // everyone answered: closed early
  assert.equal(r.phase, 'reveal');
  assert.equal(r.correct, right);
  const ana = r.players.find((p) => p.sessionId === 'a')!;
  assert.ok(ana.score > 900 && ana.score <= 1000, String(ana.score));
  assert.equal(r.players.find((p) => p.sessionId === 'b')!.score, 0);
  t.leave('a');
  assert.equal(t.hostId, 'b', 'host passes on');
  t.dispose();
});

test('battle: hits need line of sight, 4 body hits kill, cooldown and range are enforced', async () => {
  const sent: ServerMessage[] = [];
  const b = new Battle((m) => sent.push(m), () => [10, 0, 10]);
  b.join('a'); b.join('b');
  const A = { id: 'a', name: 'A', p: [0, 0, 0] as [number, number, number] };
  const B = { id: 'b', name: 'B', p: [0, 0, 20] as [number, number, number] };
  const wall = { id: 'w', type: 'office', position: { x: 0, y: 0, z: 10 }, rotationY: 0, scale: { x: 1, y: 1, z: 1 }, props: {} } as unknown as CityObject;
  let now = 1_000_000;
  // blocked by the office in between
  assert.ok(b.shoot(A, [0, 1.3, 0], [0, 0, 1], [A, B], [wall], now));
  assert.equal((sent.at(-1) as any).hit, undefined);
  // clear line: 4 hits
  for (let i = 0; i < 4; i++) { now += BATTLE.cooldownMs; b.shoot(A, [0, 1.3, 0], [0, 0, 1], [A, B], [], now); }
  const last = sent.filter((m) => m.t === 'shot').at(-1) as any;
  assert.equal(last.hit, 'b');
  assert.equal(last.kill, true);
  assert.equal(b.stats.get('a')!.kills, 1);
  // cooldown, and shots from far away are ignored
  assert.equal(b.shoot(A, [0, 1.3, 0], [0, 0, 1], [A, B], [], now + 10), false);
  assert.equal(b.shoot(A, [30, 1.3, 0], [0, 0, 1], [A, B], [], now + 1000), false);
  b.dispose();
});
