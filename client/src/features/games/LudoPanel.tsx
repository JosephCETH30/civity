// Ludo table at a tree. The server is the referee (dice, rules, turns); this panel only draws and sends intents.
import { useEffect, useState } from 'react';
import {
  BASE_CELLS, HOME_CELLS, LUDO_COLORS, LUDO_HOME, TRACK_CELLS, TRACK_STARS, TRACK_START, canMove, tokenCell, type LudoState,
} from '@civitas/shared';
import { useWorld } from '../../stores/world';
import { realtime } from '../../services/realtime';
import { Button } from '../../components/ui';
import { cn } from '@/lib/utils';

const FILL: Record<string, string> = { red: '#d64545', green: '#3a9a5b', yellow: '#e0ac2b', blue: '#3b77c9' };
const SOFT: Record<string, string> = { red: '#f6d6d3', green: '#d3ecdb', yellow: '#f8e8bf', blue: '#d4e1f5' };
const NAME: Record<string, string> = { red: 'Red', green: 'Green', yellow: 'Yellow', blue: 'Blue' };

export function LudoPanel() {
  const treeId = useWorld((s) => s.ludoTree);
  const state = useWorld((s) => (s.ludoTree ? s.ludo[s.ludoTree] : undefined));
  const dice = useWorld((s) => (s.ludoDice && s.ludoDice.treeId === s.ludoTree ? s.ludoDice : null));
  const sessionId = useWorld((s) => s.self?.sessionId);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!treeId) return;
    realtime.send({ t: 'ludo', treeId, action: 'watch' });
    const tick = setInterval(() => setNow(Date.now()), 500);
    return () => { clearInterval(tick); realtime.send({ t: 'ludo', treeId, action: 'unwatch' }); };
  }, [treeId]);
  if (!treeId) return null;

  const send = (action: 'join' | 'leave' | 'start' | 'roll' | 'move', extra: { seat?: number; token?: number } = {}) =>
    realtime.send({ t: 'ludo', treeId, action, ...extra });
  const close = () => useWorld.getState().set({ ludoTree: null });
  const mySeat = state ? state.seats.findIndex((p) => p?.sessionId === sessionId) : -1;
  const myTurn = !!state && state.phase === 'playing' && state.turn === mySeat;
  const seatedCount = state ? state.seats.filter(Boolean).length : 0;
  const secondsLeft = state && state.phase === 'playing' ? Math.max(0, Math.ceil((state.turnDeadline - now - useWorld.getState().serverOffset) / 1000)) : 0;

  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-stone-950/40 p-3" role="dialog" aria-label="Ludo table">
      <div className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-[10px] border bg-card text-foreground shadow-lg">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h2 className="text-sm font-medium">Ludo at this tree</h2>
            <p className="text-xs text-muted-foreground">2 to 4 players. Each tree is its own table; anyone nearby can watch.</p>
          </div>
          <button onClick={close} className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close Ludo">✕</button>
        </div>
        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 md:grid-cols-[1fr_220px]">
          <div className="mx-auto w-full max-w-[520px]">
            {state ? <Board state={state} mySeat={mySeat} myTurn={myTurn} onToken={(token) => send('move', { token })} /> : <p className="py-20 text-center text-sm text-muted-foreground">Loading table</p>}
          </div>
          {state && (
            <div className="space-y-4 text-sm">
              <ul className="space-y-1.5" aria-label="Seats">
                {LUDO_COLORS.map((c, i) => {
                  const p = state.seats[i];
                  const home = state.tokens[i].filter((t) => t === LUDO_HOME).length;
                  return (
                    <li key={c} className={cn('flex items-center gap-2 rounded-md border px-2.5 py-2', state.phase === 'playing' && state.turn === i && 'border-foreground')}>
                      <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: FILL[c] }} aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{p ? `${p.name}${i === mySeat ? ' (you)' : ''}` : <span className="text-muted-foreground">{NAME[c]} seat</span>}</span>
                      {p ? <span className="text-xs text-muted-foreground">{home}/4 home</span>
                        : state.phase !== 'playing' && mySeat < 0 && <button className="rounded px-2 py-0.5 text-xs font-medium hover:bg-muted" onClick={() => send('join', { seat: i })}>Sit</button>}
                    </li>
                  );
                })}
              </ul>

              <div className="rounded-md bg-muted px-3 py-2.5" role="status" aria-live="polite">
                <p>{state.event}</p>
                {state.phase === 'playing' && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {myTurn ? (state.roll === null ? 'Your turn: roll the dice' : 'Your turn: pick a highlighted token') : `${state.seats[state.turn]?.name ?? NAME[LUDO_COLORS[state.turn]]}'s turn`} · {secondsLeft}s
                  </p>
                )}
              </div>

              {state.phase === 'playing' && (
                <div className="flex items-center gap-3">
                  <Dice value={dice && now - dice.at < 6000 ? dice.value : state.roll} />
                  <Button className="flex-1" disabled={!myTurn || state.roll !== null} onClick={() => send('roll')}>Roll dice</Button>
                </div>
              )}
              {state.phase !== 'playing' && mySeat >= 0 && (
                <Button className="w-full" disabled={seatedCount < 2} onClick={() => send('start')}>
                  {seatedCount < 2 ? 'Waiting for another player' : state.phase === 'finished' ? 'Play again' : `Start game (${seatedCount} players)`}
                </Button>
              )}
              {state.phase !== 'playing' && mySeat < 0 && seatedCount < 4 && <p className="text-xs text-muted-foreground">Pick a free seat to join.</p>}
              {mySeat >= 0 && <Button variant="ghost" className="w-full" onClick={() => send('leave')}>Leave table</Button>}
              <p className="text-xs text-muted-foreground">Roll a 6 to bring a token out. A 6, a capture or reaching home gives another roll; three 6s in a row lose the turn. Stars and start squares are safe.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Dice({ value }: { value: number | null | undefined }) {
  const pips: Record<number, [number, number][]> = {
    1: [[2, 2]], 2: [[1, 1], [3, 3]], 3: [[1, 1], [2, 2], [3, 3]], 4: [[1, 1], [3, 1], [1, 3], [3, 3]],
    5: [[1, 1], [3, 1], [2, 2], [1, 3], [3, 3]], 6: [[1, 1], [3, 1], [1, 2], [3, 2], [1, 3], [3, 3]],
  };
  return (
    <svg viewBox="0 0 4 4" className="h-11 w-11 shrink-0 rounded-md border bg-white" role="img" aria-label={value ? `Dice shows ${value}` : 'Dice'}>
      {value ? pips[value].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={0.38} fill="#1c1917" />) : null}
    </svg>
  );
}

function Board({ state, mySeat, myTurn, onToken }: { state: LudoState; mySeat: number; myTurn: boolean; onToken: (t: number) => void }) {
  const cell = (c: number, r: number, fill: string, key: string) => <rect key={key} x={c} y={r} width={1} height={1} fill={fill} stroke="#cfc9bf" strokeWidth={0.03} />;
  const startCells = new Map(TRACK_START.map((abs, seat) => [TRACK_CELLS[abs].join(), seat]));
  const stars = new Set(TRACK_STARS.map((abs) => TRACK_CELLS[abs].join()));
  // tokens sharing a cell are fanned out so every one stays clickable
  const occupancy = new Map<string, number>();
  const drawn = state.tokens.flatMap((list, seat) => (state.seats[seat] ? list.map((p, t) => ({ seat, t, p })) : []));
  return (
    <svg viewBox="0 0 15 15" className="aspect-square w-full rounded-md border bg-[#fbfaf7]" role="img" aria-label="Ludo board">
      {/* bases */}
      {[[0, 0], [9, 0], [9, 9], [0, 9]].map(([x, y], seat) => (
        <g key={seat}>
          <rect x={x} y={y} width={6} height={6} fill={FILL[LUDO_COLORS[seat]]} />
          <rect x={x + 0.6} y={y + 0.6} width={4.8} height={4.8} rx={0.3} fill="#fbfaf7" />
          {BASE_CELLS[seat].map(([cx, cy], i) => <circle key={i} cx={cx + 0.5} cy={cy + 0.5} r={0.62} fill={SOFT[LUDO_COLORS[seat]]} stroke={FILL[LUDO_COLORS[seat]]} strokeWidth={0.06} />)}
        </g>
      ))}
      {/* track */}
      {TRACK_CELLS.map(([c, r], i) => {
        const seat = startCells.get(`${c},${r}`);
        return cell(c, r, seat !== undefined ? SOFT[LUDO_COLORS[seat]] : '#ffffff', `t${i}`);
      })}
      {HOME_CELLS.flatMap((cells, seat) => cells.map(([c, r], i) => cell(c, r, SOFT[LUDO_COLORS[seat]], `h${seat}${i}`)))}
      {[...stars].map((k) => { const [c, r] = k.split(',').map(Number); return <text key={k} x={c + 0.5} y={r + 0.72} fontSize={0.62} textAnchor="middle" fill="#a8a29e">★</text>; })}
      {/* centre */}
      <polygon points="6,6 7.5,7.5 6,9" fill={FILL.red} />
      <polygon points="6,6 9,6 7.5,7.5" fill={FILL.green} />
      <polygon points="9,6 9,9 7.5,7.5" fill={FILL.yellow} />
      <polygon points="6,9 9,9 7.5,7.5" fill={FILL.blue} />
      {/* tokens */}
      {drawn.map(({ seat, t, p }) => {
        const [c, r] = tokenCell(seat, t, p);
        const key = `${c},${r}`;
        const n = occupancy.get(key) ?? 0;
        occupancy.set(key, n + 1);
        const off = p === -1 ? 0 : [0, 0.22, -0.22, 0.11][n % 4];
        const movable = myTurn && seat === mySeat && state.roll !== null && canMove(state, seat, t, state.roll);
        return (
          <g key={`${seat}-${t}`} transform={`translate(${c + 0.5 + off} ${r + 0.5 - off})`}
            onClick={movable ? () => onToken(t) : undefined} style={{ cursor: movable ? 'pointer' : 'default' }}
            role={movable ? 'button' : undefined} aria-label={movable ? `Move ${LUDO_COLORS[seat]} token ${t + 1}` : undefined}>
            {movable && <circle r={0.55} fill="none" stroke="#1c1917" strokeWidth={0.08} strokeDasharray="0.15 0.1" />}
            <circle r={0.36} fill={FILL[LUDO_COLORS[seat]]} stroke="#ffffff" strokeWidth={0.1} />
          </g>
        );
      })}
    </svg>
  );
}
