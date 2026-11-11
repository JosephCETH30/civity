// General-knowledge quiz at a tree (Kahoot-style). The server owns the question bank and the answers; clients only
// see the current question, and see the correct answer and everyone's choices only after time is up.

export const QUIZ_LIMITS = { minCount: 3, maxCount: 50, minSeconds: 5, maxSeconds: 60, maxPlayers: 12 } as const;
export const QUIZ_REVEAL_MS = 4000;
export const QUIZ_CATEGORIES = ['Semua', 'Indonesia', 'Sains', 'Geografi', 'Sejarah', 'Teknologi', 'Olahraga', 'Umum'] as const;
export type QuizCategory = (typeof QUIZ_CATEGORIES)[number];

export interface QuizPlayerView {
  sessionId: string;
  userId: string;
  name: string;
  score: number;
  answered: boolean;
  /** Only filled after the question closes (reveal / finished). */
  choice: number | null;
  /** Points gained on the last revealed question. */
  gain: number;
  correctCount: number;
}

export interface QuizState {
  treeId: string;
  hostId: string | null; // session id of the host (sets the options, starts the game)
  phase: 'lobby' | 'question' | 'reveal' | 'finished';
  count: number; // questions per game
  seconds: number; // answer time per question
  category: QuizCategory;
  index: number; // 0-based current question
  question: { text: string; choices: string[]; category: string } | null;
  correct: number | null; // only during reveal / finished
  deadline: number; // epoch ms: question closes (question) or next question starts (reveal)
  players: QuizPlayerView[];
  event: string;
  bankSize: number;
}

/** Points for a correct answer: 500 for being right plus up to 500 for speed. */
export const quizPoints = (msLeft: number, totalMs: number) => 500 + Math.round(500 * Math.max(0, Math.min(1, msLeft / totalMs)));
