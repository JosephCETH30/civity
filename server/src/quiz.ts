// Quiz table at a tree: lobby -> question -> reveal -> ... -> finished. The server picks and shuffles questions,
// times them, scores answers and only reveals the correct choice after the question closes.
import { randomInt } from 'node:crypto';
import { QUIZ_LIMITS, QUIZ_REVEAL_MS, quizPoints, type QuizCategory, type QuizState } from '@civitas/shared';
import { QUIZ_BANK } from './quizBank.ts';

interface Player { sessionId: string; userId: string; name: string; score: number; choice: number | null; answeredAt: number; gain: number; correctCount: number }
interface Question { text: string; choices: string[]; correct: number; category: string }

function shuffle<T>(a: T[]) {
  for (let i = a.length - 1; i > 0; i--) { const j = randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export function drawQuestions(count: number, category: QuizCategory): Question[] {
  const pool = QUIZ_BANK.filter((q) => category === 'Semua' || q[0] === category);
  return shuffle([...pool]).slice(0, count).map(([cat, text, right, ...wrong]) => {
    const choices = shuffle([right, ...wrong]);
    return { text, choices, correct: choices.indexOf(right), category: cat };
  });
}
export const bankSize = (category: QuizCategory) => QUIZ_BANK.filter((q) => category === 'Semua' || q[0] === category).length;

export class QuizTable {
  watchers = new Set<string>();
  players: Player[] = [];
  hostId: string | null = null;
  phase: QuizState['phase'] = 'lobby';
  count = 10;
  seconds = 20;
  category: QuizCategory = 'Semua';
  questions: Question[] = [];
  index = 0;
  deadline = 0;
  startedAt = 0;
  event = 'Waiting for players';
  private timer?: NodeJS.Timeout;

  /** `send` delivers the current view to everyone at the table; `fail` rejects an action with a message. */
  constructor(public treeId: string, private send: () => void, private fail: (msg: string) => never) {}

  dispose() { clearTimeout(this.timer); }
  get empty() { return !this.watchers.size && !this.players.length; }
  private seat(sessionId: string) { return this.players.find((p) => p.sessionId === sessionId); }

  view(): QuizState {
    const open = this.phase === 'question';
    const q = this.phase === 'lobby' ? null : this.questions[this.index] ?? null;
    return {
      treeId: this.treeId, hostId: this.hostId, phase: this.phase, count: this.count, seconds: this.seconds, category: this.category,
      index: this.index,
      question: q && this.phase !== 'finished' ? { text: q.text, choices: q.choices, category: q.category } : null,
      correct: q && !open && this.phase !== 'finished' ? q.correct : null,
      deadline: this.deadline,
      players: [...this.players].sort((a, b) => b.score - a.score).map((p) => ({
        sessionId: p.sessionId, userId: p.userId, name: p.name, score: p.score, answered: p.choice !== null,
        choice: open ? null : p.choice, gain: p.gain, correctCount: p.correctCount,
      })),
      event: this.event,
      bankSize: bankSize(this.category),
    };
  }

  join(s: { id: string; userId: string; name: string }) {
    if (this.seat(s.id)) return;
    if (this.players.some((p) => p.userId === s.userId)) this.fail('You are already playing here in another tab');
    if (this.phase === 'question' || this.phase === 'reveal') this.fail('A quiz is running at this tree. Watch, or wait for the next round.');
    if (this.players.length >= QUIZ_LIMITS.maxPlayers) this.fail('This quiz is full');
    if (this.phase === 'finished') this.toLobby();
    this.players.push({ sessionId: s.id, userId: s.userId, name: s.name, score: 0, choice: null, answeredAt: 0, gain: 0, correctCount: 0 });
    this.hostId ??= s.id;
    this.watchers.add(s.id);
    this.event = `${s.name} joined`;
  }

  leave(sessionId: string) {
    const p = this.seat(sessionId);
    if (!p) return false;
    this.players = this.players.filter((x) => x !== p);
    if (this.hostId === sessionId) this.hostId = this.players[0]?.sessionId ?? null;
    this.event = `${p.name} left`;
    if (!this.players.length) { this.toLobby(); this.event = 'Waiting for players'; }
    else if (this.phase === 'question' && this.players.every((x) => x.choice !== null)) this.close();
    return true;
  }

  config(sessionId: string, opts: { count?: number; seconds?: number; category?: QuizCategory }) {
    if (sessionId !== this.hostId) this.fail('Only the host can change the options');
    if (this.phase === 'question' || this.phase === 'reveal') this.fail('Wait until this round is over');
    if (this.phase === 'finished') this.toLobby();
    if (opts.category) this.category = opts.category;
    if (opts.count) this.count = opts.count;
    if (opts.seconds) this.seconds = opts.seconds;
    this.count = Math.min(this.count, bankSize(this.category));
  }

  start(sessionId: string, now: number) {
    if (sessionId !== this.hostId) this.fail('Only the host can start');
    if (this.phase === 'question' || this.phase === 'reveal') return;
    for (const p of this.players) Object.assign(p, { score: 0, choice: null, gain: 0, correctCount: 0 });
    this.questions = drawQuestions(this.count, this.category);
    this.index = 0;
    this.startedAt = now;
    this.ask(now);
  }

  answer(sessionId: string, choice: number, now: number) {
    const p = this.seat(sessionId);
    if (!p) this.fail('Join the quiz to answer');
    if (this.phase !== 'question' || now > this.deadline) this.fail('Time is up for this question');
    if (p!.choice !== null) return; // first answer counts
    p!.choice = choice;
    p!.answeredAt = now;
    if (this.players.every((x) => x.choice !== null)) this.close();
  }

  private toLobby() {
    clearTimeout(this.timer);
    this.phase = 'lobby';
    this.questions = [];
    this.index = 0;
    this.deadline = 0;
    for (const p of this.players) Object.assign(p, { score: 0, choice: null, gain: 0, correctCount: 0 });
  }

  private ask(now: number) {
    this.phase = 'question';
    for (const p of this.players) { p.choice = null; p.gain = 0; }
    this.deadline = now + this.seconds * 1000;
    this.event = `Question ${this.index + 1} of ${this.questions.length}`;
    this.schedule(() => this.close());
  }

  /** Time is up (or everyone answered): score and show the right answer. */
  private close() {
    if (this.phase !== 'question') return;
    const q = this.questions[this.index];
    const total = this.seconds * 1000;
    for (const p of this.players) {
      if (p.choice === q.correct) {
        p.gain = quizPoints(this.deadline - p.answeredAt, total);
        p.score += p.gain;
        p.correctCount++;
      }
    }
    const right = this.players.filter((p) => p.choice === q.correct).length;
    this.phase = 'reveal';
    this.deadline = Date.now() + QUIZ_REVEAL_MS;
    this.event = `${right} of ${this.players.length} answered correctly`;
    this.schedule(() => {
      if (this.index + 1 < this.questions.length) { this.index++; this.ask(Date.now()); }
      else this.finish();
    });
  }

  private finish() {
    this.phase = 'finished';
    this.deadline = 0;
    const top = [...this.players].sort((a, b) => b.score - a.score)[0];
    this.event = top ? `${top.name} wins with ${top.score} points` : 'Quiz finished';
  }

  private schedule(fn: () => void) {
    clearTimeout(this.timer);
    const wait = Math.max(0, this.deadline - Date.now()) + 30;
    this.timer = setTimeout(() => { fn(); this.send(); }, wait);
  }
}
