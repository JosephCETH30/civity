import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TRACK_CELLS, HOME_CELLS, LUDO_HOME, absIndex, applyMove, applyRoll, legalTokens, newLudo, removePlayer, startGame, tokenCell,
} from '@civitas/shared';

const players = (n: number) => {
  const s = newLudo('t');
  for (let i = 0; i < n; i++) s.seats[i] = { userId: `u${i}`, name: `P${i}`, sessionId: `s${i}` };
  startGame(s, 0);
  return s;
};

test('board: 52 distinct track cells, each step moves to a neighbouring cell', () => {
  assert.equal(TRACK_CELLS.length, 52);
  assert.equal(new Set(TRACK_CELLS.map((c) => c.join())).size, 52);
  for (let i = 0; i < 52; i++) {
    const [a, b] = [TRACK_CELLS[i], TRACK_CELLS[(i + 1) % 52]];
    assert.ok(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) <= 2, `cells ${i} and ${i + 1} are adjacent`);
  }
  // each colour's last track square sits right before its home column
  for (let seat = 0; seat < 4; seat++) {
    const last = tokenCell(seat, 0, 50), first = HOME_CELLS[seat][0];
    assert.equal(Math.abs(last[0] - first[0]) + Math.abs(last[1] - first[1]), 1, `colour ${seat} enters home from the track`);
  }
});

test('a six is needed to leave base, and a six gives another roll', () => {
  const s = players(2);
  applyRoll(s, 4, 0);
  assert.equal(s.turn, 1, 'no legal move with 4: turn passes');
  applyRoll(s, 6, 0);
  assert.deepEqual(legalTokens(s, 6), [0, 1, 2, 3]);
  assert.ok(applyMove(s, 0, 0));
  assert.equal(s.tokens[1][0], 0);
  assert.equal(s.turn, 1, 'six: same player again');
  assert.equal(s.roll, null);
});

test('landing on an opponent captures it (not on safe squares); exact roll to finish', () => {
  const s = players(2);
  // red token at relative 10 = abs 10; green token placed on abs 12 (green relative 51? no: abs 12 = green relative (12-13+52)%52 = 51 -> home column) so use abs 11
  s.tokens[0][0] = 10;
  s.tokens[1][0] = (11 - 13 + 52) % 52; // green token on abs 11
  assert.equal(absIndex(1, s.tokens[1][0]), 11);
  s.turn = 0;
  applyRoll(s, 1, 0);
  assert.ok(applyMove(s, 0, 0));
  assert.equal(s.tokens[1][0], -1, 'captured back to base');
  assert.equal(s.turn, 0, 'capture gives another roll');
  // safe square (start of green, abs 13): no capture
  s.tokens[1][1] = 0; // green on its own start, abs 13
  s.tokens[0][1] = 12;
  applyRoll(s, 1, 0);
  assert.ok(applyMove(s, 1, 0));
  assert.equal(s.tokens[1][1], 0, 'safe square protects');
  // exact roll home
  s.turn = 0; s.roll = null;
  s.tokens[0][2] = 54;
  applyRoll(s, 3, 0);
  assert.equal(legalTokens(s, 3).includes(2), false, 'overshooting home is not allowed');
});

test('three sixes forfeit the turn; winner when all four are home; leaving ends a 2-player game', () => {
  const s = players(2);
  s.tokens[0] = [10, -1, -1, -1];
  for (let i = 0; i < 2; i++) { applyRoll(s, 6, 0); applyMove(s, 0, 0); }
  applyRoll(s, 6, 0);
  assert.equal(s.turn, 1, 'third six passes the turn');

  const w = players(2);
  w.tokens[0] = [LUDO_HOME, LUDO_HOME, LUDO_HOME, 53];
  w.turn = 0;
  applyRoll(w, 3, 0);
  assert.ok(applyMove(w, 3, 0));
  assert.equal(w.phase, 'finished');
  assert.equal(w.winner, 0);

  const l = players(2);
  removePlayer(l, 1, 0);
  assert.equal(l.phase, 'finished');
  assert.equal(l.winner, 0);
});
