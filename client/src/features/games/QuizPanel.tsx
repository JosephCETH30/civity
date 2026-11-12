// General-knowledge quiz at a tree (Kahoot-style). The server owns questions, timing and scoring; this panel draws
// the state and sends intents. The host picks the number of questions, the answer time and the category.
import { useEffect, useState } from 'react';
import { QUIZ_CATEGORIES, QUIZ_LIMITS, type QuizCategory, type QuizState } from '@civitas/shared';
import { useWorld } from '../../stores/world';
import { realtime } from '../../services/realtime';
import { Button } from '../../components/ui';
import { cn } from '@/lib/utils';

const CHOICE_STYLE = ['bg-[#d64545]', 'bg-[#3b77c9]', 'bg-[#e0ac2b]', 'bg-[#3a9a5b]'];
const SHAPE = ['▲', '◆', '●', '■'];
const COUNTS = [5, 10, 15, 20, 30];
const TIMES = [10, 15, 20, 30, 45];

export function QuizPanel({ treeId }: { treeId: string }) {
  const state = useWorld((s) => s.quiz[treeId]);
  const sessionId = useWorld((s) => s.self?.sessionId);
  const offset = useWorld((s) => s.serverOffset);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    realtime.send({ t: 'quiz', treeId, action: 'watch' });
    const tick = setInterval(() => setNow(Date.now()), 250);
    return () => { clearInterval(tick); realtime.send({ t: 'quiz', treeId, action: 'unwatch' }); };
  }, [treeId]);

  const send = (action: 'join' | 'leave' | 'start' | 'config' | 'answer', extra: { count?: number; seconds?: number; category?: QuizCategory; choice?: number } = {}) =>
    realtime.send({ t: 'quiz', treeId, action, ...extra });

  if (!state) return <p className="py-20 text-center text-sm text-muted-foreground">Loading quiz</p>;
  const me = state.players.find((p) => p.sessionId === sessionId);
  const isHost = state.hostId === sessionId;
  const left = Math.max(0, Math.ceil((state.deadline - now - offset) / 1000));
  const total = state.players.length;

  return (
    <div className="grid gap-4 md:grid-cols-[1fr_220px]">
      <div className="min-w-0 space-y-4">
        {(state.phase === 'lobby' || state.phase === 'finished') && (
          <Lobby state={state} isHost={isHost} joined={!!me} send={send} />
        )}
        {(state.phase === 'question' || state.phase === 'reveal') && state.question && (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Soal {state.index + 1} / {state.count} · {state.question.category}</span>
              <span className={cn('tabular-nums font-medium', state.phase === 'question' && left <= 5 && 'text-destructive')} role="timer" aria-live="off">
                {state.phase === 'question' ? `${left}s` : 'Jawaban'}
              </span>
            </div>
            {state.phase === 'question' && (
              <div className="h-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-foreground transition-[width] duration-200 ease-linear" style={{ width: `${(100 * Math.max(0, state.deadline - now - offset)) / (state.seconds * 1000)}%` }} />
              </div>
            )}
            <h3 className="text-lg font-medium leading-snug">{state.question.text}</h3>
            <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Pilihan jawaban">
              {state.question.choices.map((c, i) => {
                const reveal = state.phase === 'reveal';
                const right = reveal && state.correct === i;
                const mine = me?.choice === i;
                const picked = state.phase === 'question' && me?.answered;
                const count = reveal ? state.players.filter((p) => p.choice === i).length : 0;
                return (
                  <button
                    key={i}
                    disabled={!me || state.phase !== 'question' || me.answered}
                    onClick={() => send('answer', { choice: i })}
                    className={cn(
                      'flex min-h-14 items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm font-medium text-white transition',
                      CHOICE_STYLE[i],
                      reveal && !right && 'opacity-35',
                      picked && 'opacity-60',
                      mine && 'ring-2 ring-foreground ring-offset-2 ring-offset-card',
                      me && state.phase === 'question' && !me.answered && 'hover:brightness-110',
                    )}
                    aria-label={`${SHAPE[i]} ${c}${right ? ', jawaban benar' : ''}`}
                  >
                    <span aria-hidden className="text-base">{SHAPE[i]}</span>
                    <span className="flex-1">{c}</span>
                    {right && <span aria-hidden>✓</span>}
                    {reveal && count > 0 && <span className="rounded bg-black/25 px-1.5 text-xs tabular-nums">{count}</span>}
                  </button>
                );
              })}
            </div>
            <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
              {state.phase === 'question'
                ? me ? (me.answered ? `Terkunci. Menunggu yang lain (${state.players.filter((p) => p.answered).length}/${total})` : 'Pilih jawaban. Makin cepat, makin banyak poin.') : 'Kamu menonton. Gabung di ronde berikutnya.'
                : me ? (me.gain ? `Benar! +${me.gain} poin` : me.choice === null ? 'Waktu habis' : 'Kurang tepat') : state.event}
            </p>
          </div>
        )}
      </div>

      <aside className="space-y-3 text-sm">
        <h3 className="text-xs font-medium text-muted-foreground">Papan skor · {total}/{QUIZ_LIMITS.maxPlayers}</h3>
        <ol className="space-y-1" aria-label="Papan skor">
          {state.players.map((p, i) => (
            <li key={p.sessionId} className={cn('flex items-center gap-2 rounded-md border px-2.5 py-1.5', p.sessionId === sessionId && 'border-foreground')}>
              <span className="w-4 text-xs tabular-nums text-muted-foreground">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate">{p.name}{p.sessionId === state.hostId ? ' · host' : ''}</span>
              {state.phase === 'question' && <span className={cn('h-2 w-2 rounded-full', p.answered ? 'bg-foreground' : 'bg-muted')} aria-label={p.answered ? 'answered' : 'thinking'} />}
              {state.phase === 'reveal' && p.gain > 0 && <span className="text-xs text-green-700">+{p.gain}</span>}
              <span className="tabular-nums font-medium">{p.score}</span>
            </li>
          ))}
          {!total && <li className="text-xs text-muted-foreground">Belum ada pemain.</li>}
        </ol>
        {me && (state.phase === 'lobby' || state.phase === 'finished') && (
          <Button variant="ghost" size="sm" onClick={() => send('leave')}>Keluar dari kuis</Button>
        )}
      </aside>
    </div>
  );
}

function Lobby({ state, isHost, joined, send }: {
  state: QuizState; isHost: boolean; joined: boolean;
  send: (a: 'join' | 'start' | 'config', e?: { count?: number; seconds?: number; category?: QuizCategory }) => void;
}) {
  const finished = state.phase === 'finished';
  const canSetup = isHost || !state.hostId; // empty table: anyone can set it up and becomes host
  const winner = finished ? state.players[0] : undefined;
  return (
    <div className="space-y-4">
      {finished && (
        <div className="rounded-md border px-4 py-4 text-center">
          <p className="text-xs text-muted-foreground">Kuis selesai</p>
          <p className="mt-1 text-lg font-medium">{winner ? `🏆 ${winner.name} · ${winner.score} poin` : state.event}</p>
          {state.players.length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">{state.players.map((p) => `${p.name}: ${p.correctCount}/${state.count} benar`).join(' · ')}</p>
          )}
        </div>
      )}
      {!finished && <p className="text-sm text-muted-foreground">Kuis pengetahuan umum. {state.bankSize} soal tersedia di kategori ini; soal diacak setiap permainan.</p>}

      <fieldset className="space-y-3" disabled={!canSetup}>
        <legend className="sr-only">Opsi kuis</legend>
        <Option label="Kategori">
          <select value={state.category} onChange={(e) => send('config', { category: e.target.value as QuizCategory })} className="h-8 rounded-md border bg-card px-2 text-sm" aria-label="Kategori">
            {QUIZ_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Option>
        <Option label="Jumlah soal">
          {COUNTS.map((n) => <Chip key={n} active={state.count === n} onClick={() => send('config', { count: n })}>{n}</Chip>)}
          <NumberField label="Jumlah soal (custom)" value={state.count} min={QUIZ_LIMITS.minCount} max={Math.min(QUIZ_LIMITS.maxCount, state.bankSize)} onCommit={(n) => send('config', { count: n })} />
        </Option>
        <Option label="Waktu menjawab">
          {TIMES.map((n) => <Chip key={n} active={state.seconds === n} onClick={() => send('config', { seconds: n })}>{n}s</Chip>)}
          <NumberField label="Waktu menjawab dalam detik (custom)" value={state.seconds} min={QUIZ_LIMITS.minSeconds} max={QUIZ_LIMITS.maxSeconds} onCommit={(n) => send('config', { seconds: n })} />
        </Option>
      </fieldset>
      {!isHost && joined && <p className="text-xs text-muted-foreground">Host yang mengatur opsi dan memulai kuis.</p>}

      <div className="flex flex-wrap gap-2">
        {canSetup && <Button onClick={() => send('start')}>{finished ? 'Main lagi' : state.players.length > 1 ? 'Mulai kuis' : 'Mulai kuis (main sendiri juga bisa)'}</Button>}
        {!joined && <Button variant={canSetup ? 'secondary' : 'primary'} onClick={() => send('join')}>Gabung kuis</Button>}
      </div>
    </div>
  );
}

/** Free number input: edits locally, sends (clamped) on Enter or when focus leaves. */
function NumberField({ label, value, min, max, onCommit }: { label: string; value: number; min: number; max: number; onCommit: (n: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = Math.round(Number(draft));
    if (!Number.isFinite(n)) return setDraft(String(value));
    const c = Math.max(min, Math.min(max, n));
    setDraft(String(c));
    if (c !== value) onCommit(c);
  };
  return (
    <input type="number" inputMode="numeric" min={min} max={max} value={draft} aria-label={label}
      onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()}
      className="h-7 w-16 rounded-md border bg-card px-2 text-xs" />
  );
}

function Option({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-28 text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={cn('h-7 rounded-full border px-2.5 text-xs disabled:opacity-60', active ? 'border-foreground bg-foreground text-background' : 'hover:bg-muted')}>{children}</button>
  );
}
