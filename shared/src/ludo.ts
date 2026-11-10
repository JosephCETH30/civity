// Classic Ludo rules (traditional board game), shared by the server (authority) and the client (display).
// Board: 15x15 grid, 52-square main track, 4 colours, 4 tokens each.
// Token progress: -1 = in base, 0..50 = main track (relative to the colour's start), 51..55 = home column, 56 = home.

export const LUDO_COLORS = ['red', 'green', 'yellow', 'blue'] as const;
export type LudoColor = (typeof LUDO_COLORS)[number];
export const LUDO_HOME = 56;
const TRACK = 52;
const START = [0, 13, 26, 39]; // absolute track index where each colour enters
const STARS = [8, 21, 34, 47];
export const LUDO_SAFE = new Set([...START, ...STARS]);
export const LUDO_TURN_MS = 30_000;

export interface LudoPlayer { userId: string; name: string; sessionId: string }
export interface LudoState {
  treeId: string;
  seats: (LudoPlayer | null)[]; // index = colour
  tokens: number[][]; // [seat][token] progress
  phase: 'lobby' | 'playing' | 'finished';
  turn: number;
  roll: number | null; // rolled and waiting for a move
  sixes: number; // consecutive sixes this turn
  winner: number | null;
  event: string; // last thing that happened, for the log line
  turnDeadline: number; // epoch ms
}

export function newLudo(treeId: string): LudoState {
  return {
    treeId, seats: [null, null, null, null], tokens: [0, 1, 2, 3].map(() => [-1, -1, -1, -1]),
    phase: 'lobby', turn: 0, roll: null, sixes: 0, winner: null, event: 'Waiting for players', turnDeadline: 0,
  };
}

/** Absolute main-track index of a token, or null when it is in base, the home column or home. */
export const absIndex = (seat: number, p: number) => (p >= 0 && p <= 50 ? (START[seat] + p) % TRACK : null);

export function canMove(s: LudoState, seat: number, token: number, roll: number) {
  const p = s.tokens[seat][token];
  if (p === LUDO_HOME) return false;
  if (p === -1) return roll === 6;
  return p + roll <= LUDO_HOME;
}
export const legalTokens = (s: LudoState, roll: number) => [0, 1, 2, 3].filter((t) => canMove(s, s.turn, t, roll));

const seated = (s: LudoState) => s.seats.map((p, i) => (p ? i : -1)).filter((i) => i >= 0);
const nameOf = (s: LudoState, seat: number) => s.seats[seat]?.name ?? LUDO_COLORS[seat];

function nextTurn(s: LudoState, now: number) {
  const order = seated(s);
  const i = order.indexOf(s.turn);
  s.turn = order[(i + 1) % order.length] ?? order[0];
  s.roll = null;
  s.sixes = 0;
  s.turnDeadline = now + LUDO_TURN_MS;
}

export function startGame(s: LudoState, now: number) {
  s.tokens = [0, 1, 2, 3].map(() => [-1, -1, -1, -1]);
  s.phase = 'playing';
  s.winner = null;
  s.turn = seated(s)[0];
  s.roll = null;
  s.sixes = 0;
  s.turnDeadline = now + LUDO_TURN_MS;
  s.event = `${nameOf(s, s.turn)} starts`;
}

/** Apply a dice roll. Passes the turn when nothing can move or on a third six. */
export function applyRoll(s: LudoState, roll: number, now: number) {
  s.roll = roll;
  s.turnDeadline = now + LUDO_TURN_MS;
  if (roll === 6) s.sixes++;
  if (s.sixes === 3) {
    s.event = `${nameOf(s, s.turn)} rolled three sixes and loses the turn`;
    nextTurn(s, now);
    return;
  }
  if (!legalTokens(s, roll).length) {
    s.event = `${nameOf(s, s.turn)} rolled ${roll}, no move`;
    nextTurn(s, now);
    return;
  }
  s.event = `${nameOf(s, s.turn)} rolled ${roll}`;
}

/** Move a token by the current roll. Returns false if the move is not legal. */
export function applyMove(s: LudoState, token: number, now: number) {
  const seat = s.turn, roll = s.roll;
  if (s.phase !== 'playing' || roll === null || !canMove(s, seat, token, roll)) return false;
  const from = s.tokens[seat][token];
  const to = from === -1 ? 0 : from + roll;
  s.tokens[seat][token] = to;
  let bonus = roll === 6;
  let captured = 0;
  const abs = absIndex(seat, to);
  if (abs !== null && !LUDO_SAFE.has(abs)) {
    for (let o = 0; o < 4; o++) {
      if (o === seat || !s.seats[o]) continue;
      s.tokens[o] = s.tokens[o].map((p) => (absIndex(o, p) === abs ? (captured++, -1) : p));
    }
  }
  if (captured) bonus = true;
  if (to === LUDO_HOME) bonus = true;
  s.event = from === -1 ? `${nameOf(s, seat)} brought a token out`
    : captured ? `${nameOf(s, seat)} captured ${captured} token${captured > 1 ? 's' : ''}`
    : to === LUDO_HOME ? `${nameOf(s, seat)} got a token home` : `${nameOf(s, seat)} moved ${roll}`;
  if (s.tokens[seat].every((p) => p === LUDO_HOME)) {
    s.phase = 'finished';
    s.winner = seat;
    s.roll = null;
    s.event = `${nameOf(s, seat)} wins`;
    return true;
  }
  if (bonus) {
    s.roll = null;
    s.turnDeadline = now + LUDO_TURN_MS;
    s.event += ', rolls again';
  } else nextTurn(s, now);
  return true;
}

/** A player left: free the seat; a game with fewer than two players ends. */
export function removePlayer(s: LudoState, seat: number, now: number) {
  const name = nameOf(s, seat);
  s.seats[seat] = null;
  s.tokens[seat] = [-1, -1, -1, -1];
  if (s.phase !== 'playing') { s.event = `${name} left`; return; }
  const left = seated(s);
  if (left.length < 2) {
    s.phase = 'finished';
    s.winner = left[0] ?? null;
    s.roll = null;
    s.event = `${name} left${left.length ? `, ${nameOf(s, left[0])} wins` : ''}`;
    return;
  }
  if (s.turn === seat) nextTurn(s, now);
  s.event = `${name} left`;
}

// ---------- board geometry (grid cells, col,row in 0..14) ----------
const seg = (cells: [number, number][]) => cells;
const range = (a: number, b: number) => (a <= b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : Array.from({ length: a - b + 1 }, (_, i) => a - i));
/** The 52 main-track cells in play order, starting at red's entry square. */
export const TRACK_CELLS: [number, number][] = [
  ...seg(range(1, 5).map((c) => [c, 6])),
  ...seg(range(5, 0).map((r) => [6, r])),
  [7, 0],
  ...seg(range(0, 5).map((r) => [8, r])),
  ...seg(range(9, 14).map((c) => [c, 6])),
  [14, 7],
  ...seg(range(14, 9).map((c) => [c, 8])),
  ...seg(range(9, 14).map((r) => [8, r])),
  [7, 14],
  ...seg(range(14, 9).map((r) => [6, r])),
  ...seg(range(5, 0).map((c) => [c, 8])),
  [0, 7],
  [0, 6],
];
/** Home column cells (progress 51..55) per colour. */
export const HOME_CELLS: [number, number][][] = [
  range(1, 5).map((c) => [c, 7]),
  range(1, 5).map((r) => [7, r]),
  range(13, 9).map((c) => [c, 7]),
  range(13, 9).map((r) => [7, r]),
];
/** Base slots (progress -1) per colour, centred in each 6x6 corner. */
export const BASE_CELLS: [number, number][][] = [
  [[1.5, 1.5], [3.5, 1.5], [1.5, 3.5], [3.5, 3.5]],
  [[10.5, 1.5], [12.5, 1.5], [10.5, 3.5], [12.5, 3.5]],
  [[10.5, 10.5], [12.5, 10.5], [10.5, 12.5], [12.5, 12.5]],
  [[1.5, 10.5], [3.5, 10.5], [1.5, 12.5], [3.5, 12.5]],
];
/** Where a token is drawn (cell coordinates). Home (56) sits in the colour's triangle at the centre. */
export function tokenCell(seat: number, token: number, p: number): [number, number] {
  if (p === -1) return BASE_CELLS[seat][token];
  if (p <= 50) return TRACK_CELLS[(START[seat] + p) % TRACK];
  if (p <= 55) return HOME_CELLS[seat][p - 51];
  const home: [number, number][] = [[6.3, 7], [7, 6.3], [7.7, 7], [7, 7.7]];
  return home[seat];
}
export const TRACK_START = START;
export const TRACK_STARS = STARS;
