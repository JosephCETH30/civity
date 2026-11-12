// PvP battle overlay: join/leave toggle, crosshair, health, scoreboard, kill feed, hit/hurt feedback, and a Fire
// button on touch screens. All numbers come from the server; this only displays them.
import { useEffect, useRef, useState } from 'react';
import { BATTLE } from '@civitas/shared';
import { useWorld } from '../../stores/world';
import { serverNow } from '../../services/realtime';
import { battleFx } from '../../engine/core/transient';
import { fire, toggleBattle } from '../../engine/combat/shoot';
import { cn } from '@/lib/utils';

/** Re-render on a short interval for the flashes and the respawn countdown. */
function useTicker(active: boolean, ms = 100) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [active, ms]);
}

export function BattleToggle({ className }: { className?: string }) {
  const inBattle = useWorld((s) => s.inBattle);
  const fighters = useWorld((s) => Object.keys(s.battle).length);
  return (
    <button
      onClick={toggleBattle}
      aria-pressed={inBattle}
      title={inBattle ? 'Leave the battle' : 'Join the PvP battle'}
      className={cn('flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-xs font-medium transition', inBattle ? 'bg-red-600 text-white hover:bg-red-700' : 'text-white/85 hover:bg-white/10', className)}
    >
      <span aria-hidden>⚔</span>
      {inBattle ? 'Leave battle' : 'Battle'}
      {fighters > 0 && <span className="rounded-full bg-white/20 px-1.5 tabular-nums">{fighters}</span>}
    </button>
  );
}

export function BattleHud({ mobile = false }: { mobile?: boolean }) {
  const inBattle = useWorld((s) => s.inBattle);
  const stats = useWorld((s) => s.battle);
  const players = useWorld((s) => s.players);
  const self = useWorld((s) => s.self?.sessionId);
  const feed = useWorld((s) => s.killFeed);
  const cameraMode = useWorld((s) => s.cameraMode);
  useTicker(inBattle);
  if (!inBattle || !self || !stats[self]) {
    return feed.length ? <KillFeed feed={feed} mobile={mobile} /> : null;
  }
  const me = stats[self];
  const now = performance.now();
  const dead = me.deadUntil > serverNow();
  const respawnIn = Math.max(0, Math.ceil((me.deadUntil - serverNow()) / 1000));
  const hitMarker = now - battleFx.hitAt < 220;
  const hurt = now - battleFx.hurtAt < 300;
  const board = Object.entries(stats).sort((a, b) => b[1].kills - a[1].kills || a[1].deaths - b[1].deaths).slice(0, 6);
  const crosshair = cameraMode === 'first' || (!mobile && cameraMode === 'third');

  return (
    <>
      {/* hurt flash */}
      <div className={cn('pointer-events-none absolute inset-0 z-10 transition-opacity duration-300', hurt ? 'opacity-100' : 'opacity-0')} style={{ boxShadow: 'inset 0 0 120px 30px rgba(220,38,38,0.55)' }} aria-hidden />

      {crosshair && !dead && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2" aria-hidden>
          <div className={cn('relative h-6 w-6', hitMarker && 'scale-125')}>
            <span className={cn('absolute left-1/2 top-0 h-2 w-0.5 -translate-x-1/2', hitMarker ? 'bg-red-500' : 'bg-white')} />
            <span className={cn('absolute bottom-0 left-1/2 h-2 w-0.5 -translate-x-1/2', hitMarker ? 'bg-red-500' : 'bg-white')} />
            <span className={cn('absolute left-0 top-1/2 h-0.5 w-2 -translate-y-1/2', hitMarker ? 'bg-red-500' : 'bg-white')} />
            <span className={cn('absolute right-0 top-1/2 h-0.5 w-2 -translate-y-1/2', hitMarker ? 'bg-red-500' : 'bg-white')} />
            <span className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/90 shadow" />
          </div>
        </div>
      )}

      {dead && (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center" role="status" aria-live="assertive">
          <div className="rounded-md bg-stone-950/80 px-5 py-3 text-center text-white">
            <p className="text-sm font-semibold">You were eliminated</p>
            <p className="text-xs text-white/70">Respawning in {respawnIn}s</p>
          </div>
        </div>
      )}

      {/* health + score */}
      <div className={cn('pointer-events-none absolute left-1/2 z-10 w-56 -translate-x-1/2', mobile ? 'top-[calc(max(env(safe-area-inset-top),8px)+52px)]' : 'top-3')}>
        <div className="rounded-md bg-stone-950/75 px-3 py-2 text-white shadow-lg backdrop-blur">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium">HP {me.hp}</span>
            <span className="tabular-nums text-white/75">{me.kills} K · {me.deaths} D</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/15" role="meter" aria-label="Health" aria-valuemin={0} aria-valuemax={BATTLE.maxHp} aria-valuenow={me.hp}>
            <div className={cn('h-full transition-[width] duration-200', me.hp > 60 ? 'bg-green-500' : me.hp > 30 ? 'bg-yellow-500' : 'bg-red-500')} style={{ width: `${me.hp}%` }} />
          </div>
          {!mobile && <p className="mt-1.5 text-[11px] text-white/60">{cameraMode === 'first' ? 'Click the view to aim with the mouse · hold click to fire · Esc frees the mouse' : cameraMode === 'third' ? 'Click or F to fire · drag to aim · Eyes view for mouse aim' : 'F to fire where you face · try the Eyes view'}</p>}
          {mobile && <p className="mt-1.5 text-[11px] text-white/60">{cameraMode === 'first' ? 'Drag the view to aim · hold Fire' : 'Hold Fire · Eyes button for aiming'}</p>}
        </div>
        <KillFeed feed={feed} mobile={mobile} inline />
      </div>

      {/* scoreboard */}
      {!mobile && (
        <div className="pointer-events-none absolute left-3 top-14 z-10 w-48 rounded-md bg-stone-950/70 p-2 text-xs text-white shadow-lg backdrop-blur" aria-label="Battle scoreboard">
          <p className="mb-1 font-medium text-white/80">Battle · {Object.keys(stats).length} fighters</p>
          <ol className="space-y-0.5">
            {board.map(([id, s], i) => (
              <li key={id} className={cn('flex items-center gap-2', id === self && 'font-semibold')}>
                <span className="w-3 tabular-nums text-white/50">{i + 1}</span>
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: players[id]?.color ?? '#999' }} aria-hidden />
                <span className="min-w-0 flex-1 truncate">{players[id]?.name ?? 'Player'}</span>
                <span className="tabular-nums">{s.kills}/{s.deaths}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {mobile && !dead && <FireButton />}
    </>
  );
}

/** Touch: hold to keep firing. */
function FireButton() {
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const stop = () => { clearInterval(timer.current); timer.current = undefined; };
  useEffect(() => stop, []);
  return (
        <button
          onPointerDown={(e) => { e.preventDefault(); fire(); stop(); timer.current = setInterval(fire, BATTLE.cooldownMs + 10); }}
          onPointerUp={stop} onPointerCancel={stop} onPointerLeave={stop}
          className="pointer-events-auto absolute bottom-[calc(80px+env(safe-area-inset-bottom))] right-[156px] z-10 grid h-20 w-20 place-items-center rounded-full bg-red-600/90 text-sm font-semibold text-white shadow-lg active:bg-red-700"
          aria-label="Fire"
        >
          Fire
        </button>
  );
}

/** Touch: quick switch between the eyes view (aim by dragging) and the map-like top view. */
export function ViewToggle({ className }: { className?: string }) {
  const mode = useWorld((s) => s.cameraMode);
  const first = mode === 'first';
  return (
    <button onClick={() => useWorld.getState().set({ cameraMode: first ? 'top' : 'first' })} aria-pressed={first}
      className={cn('flex h-10 shrink-0 items-center rounded-full px-3.5 text-xs font-medium text-white', className)}>
      {first ? 'Top view' : 'Eyes view'}
    </button>
  );
}

function KillFeed({ feed, mobile, inline }: { feed: { id: number; text: string }[]; mobile: boolean; inline?: boolean }) {
  if (!feed.length) return null;
  return (
    <ul className={cn('pointer-events-none space-y-1 text-center text-xs', inline ? 'mt-2' : cn('absolute left-1/2 z-10 w-64 -translate-x-1/2', mobile ? 'top-24' : 'top-3'))} aria-live="polite">
      {feed.map((k) => <li key={k.id} className="rounded bg-stone-950/70 px-2 py-1 text-white">{k.text}</li>)}
    </ul>
  );
}
