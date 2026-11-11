// Minimap: top-down view of the whole city with everyone's live position, so people can find each other.
// Canvas 2D, redrawn at 10 fps from the same transient positions the 3D view uses. Click a name to centre on them.
import { useEffect, useRef, useState } from 'react';
import { OBJECT_INFO, type CityObject } from '@civitas/shared';
import { useWorld } from '../../stores/world';
import { useMedia } from '../communication/mediaStore';
import { localPlayer, remoteRendered, remoteTargets } from '../../engine/core/transient';
import { cn } from '@/lib/utils';

const COLORS: Partial<Record<CityObject['type'], string>> = {
  road: '#55575c', park: '#7fae63', tree: '#4e7f3a', residential: '#e4d8c3', office: '#cfd2d5', commercial: '#e8dcc7',
  school: '#dcd0b8', hospital: '#efefea', bus_stop: '#2b6f8f', artwork: '#b8a98f', bench: '#8a6446', streetlight: '#2f3236',
};

export function Minimap({ className }: { className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [focus, setFocus] = useState<string | null>(null); // session id to follow, or null = me
  const players = useWorld((s) => s.players);
  const self = useWorld((s) => s.self);
  const size = expanded ? 320 : 176;

  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const ctx = cv.getContext('2d')!;
    let raf = 0, last = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - last < 100) return;
      last = now;
      draw(ctx, cv, focus, expanded);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [focus, expanded]);

  const others = Object.values(players).filter((p) => p.id !== self?.sessionId);
  const dpr = Math.min(2, window.devicePixelRatio || 1);

  return (
    <div className={cn('pointer-events-auto overflow-hidden rounded-[10px] border bg-card/95 shadow-md backdrop-blur', className)} style={{ width: size }} role="region" aria-label="Minimap">
      <canvas
        ref={canvas} width={size * dpr} height={size * dpr} style={{ width: size, height: size }}
        className="block cursor-pointer" onClick={() => setExpanded((e) => !e)} aria-label={expanded ? 'Shrink minimap' : 'Enlarge minimap'} role="button"
      />
      {others.length > 0 && (
        <ul className="max-h-28 overflow-y-auto border-t px-1.5 py-1 text-xs" aria-label="Find a player">
          {others.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => setFocus((f) => (f === p.id ? null : p.id))}
                className={cn('flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-muted', focus === p.id && 'bg-muted font-medium')}
                aria-pressed={focus === p.id}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-white" style={{ background: p.color }} aria-hidden />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                <span className="tabular-nums text-muted-foreground"><Distance id={p.id} /></span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Live distance to another player, in metres, refreshed every half second. */
function Distance({ id }: { id: string }) {
  const [d, setD] = useState<number | null>(null);
  useEffect(() => {
    const t = setInterval(() => {
      const p = remoteRendered.get(id) ?? remoteTargets.get(id);
      setD(p ? Math.round(Math.hypot(p.x - localPlayer.x, p.z - localPlayer.z)) : null);
    }, 500);
    return () => clearInterval(t);
  }, [id]);
  return <>{d === null ? '' : `${d} m`}</>;
}

function draw(ctx: CanvasRenderingContext2D, cv: HTMLCanvasElement, focus: string | null, expanded: boolean) {
  const st = useWorld.getState();
  const room = st.room;
  if (!room) return;
  const W = cv.width, H = cv.height;
  const dpr = W / cv.clientWidth;
  // Whole world always fits; when following someone we also draw a ring on them.
  const world = room.worldSize + 16;
  const s = Math.min(W, H) / world;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#2aa3ab';
  ctx.fillRect(0, 0, W, H);
  ctx.translate(W / 2, H / 2);
  ctx.scale(s, s);
  ctx.fillStyle = '#eadbb8';
  ctx.fillRect(-world / 2, -world / 2, world, world);
  ctx.fillStyle = '#d9cdb6';
  const land = room.worldSize + 8;
  ctx.fillRect(-land / 2, -land / 2, land, land);

  const objs = Object.values(st.objects);
  const order = (o: CityObject) => (o.type === 'road' ? 0 : o.type === 'park' ? 1 : 2);
  objs.sort((a, b) => order(a) - order(b));
  for (const o of objs) {
    if (!expanded && (o.type === 'bench' || o.type === 'streetlight')) continue;
    const [w, d] = OBJECT_INFO[o.type].footprint;
    ctx.save();
    ctx.translate(o.position.x, o.position.z);
    ctx.rotate(-o.rotationY);
    ctx.fillStyle = COLORS[o.type] ?? '#999';
    if (o.type === 'tree') { ctx.beginPath(); ctx.arc(0, 0, 1.4, 0, Math.PI * 2); ctx.fill(); }
    else ctx.fillRect((-w * o.scale.x) / 2, (-d * o.scale.z) / 2, w * o.scale.x, d * o.scale.z);
    ctx.restore();
  }
  for (const r of Object.values(st.routes)) {
    const pts = r.stopIds.map((id) => st.objects[id]).filter(Boolean);
    if (pts.length < 2) continue;
    ctx.strokeStyle = r.color;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.position.x, p.position.z) : ctx.moveTo(p.position.x, p.position.z)));
    ctx.stroke();
  }

  // players: others as dots with initials, me as an arrow pointing where I face
  const speaking = useMedia.getState().speaking;
  const pr = Math.max(2.2, 3.2 / (s / dpr) * 0.9);
  ctx.font = `bold ${pr * 1.1}px system-ui`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const p of Object.values(st.players)) {
    const me = p.id === st.self?.sessionId;
    const pos = me ? localPlayer : remoteRendered.get(p.id) ?? remoteTargets.get(p.id);
    if (!pos) continue;
    if (p.id === focus) {
      ctx.strokeStyle = '#1c1917';
      ctx.lineWidth = 0.9;
      ctx.setLineDash([1.5, 1]);
      ctx.beginPath(); ctx.arc(pos.x, pos.z, pr * 2.4, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      // guide line from me to them
      ctx.beginPath(); ctx.moveTo(localPlayer.x, localPlayer.z); ctx.lineTo(pos.x, pos.z); ctx.stroke();
    }
    ctx.fillStyle = p.color;
    ctx.strokeStyle = speaking.has(p.userId) ? '#22c55e' : '#ffffff';
    ctx.lineWidth = speaking.has(p.userId) ? 1.2 : 0.7;
    if (me) {
      ctx.save();
      ctx.translate(pos.x, pos.z);
      ctx.rotate(-localPlayer.r);
      ctx.beginPath(); ctx.moveTo(0, -pr * 1.7); ctx.lineTo(pr * 1.2, pr * 1.3); ctx.lineTo(0, pr * 0.5); ctx.lineTo(-pr * 1.2, pr * 1.3); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.restore();
    } else {
      ctx.beginPath(); ctx.arc(pos.x, pos.z, pr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.fillText(p.name.slice(0, 1).toUpperCase(), pos.x, pos.z + 0.1);
    }
  }
  // compass
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = 'rgba(28,25,23,0.75)';
  ctx.font = 'bold 10px system-ui';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('N', 6, 5);
  ctx.beginPath(); ctx.moveTo(10, 24); ctx.lineTo(10, 16); ctx.lineTo(7, 19); ctx.moveTo(10, 16); ctx.lineTo(13, 19); ctx.strokeStyle = 'rgba(28,25,23,0.75)'; ctx.lineWidth = 1.5; ctx.stroke();
}
