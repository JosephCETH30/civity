// Lightweight 2D top-down renderer for devices that cannot run WebGL well.
// Same room, same multiplayer state, same edit operations as the 3D view.
import { useEffect, useRef } from 'react';
import { defaultSpec, OBJECT_INFO, type CityObject } from '@civitas/shared';
import { canEditNow, useWorld } from '../../stores/world';
import { useMedia } from '../../features/communication/mediaStore';
import { realtime } from '../../services/realtime';
import { localPlayer, remoteRendered, remoteTargets } from '../core/transient';
import { bindKeyboard, stepLocalPlayer } from '../core/interactions';
import { partsFor } from '../objects/parts';

export default function Map2D() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef({ scale: 4, cx: 0, cz: 0, follow: true });

  useEffect(() => bindKeyboard(), []);

  useEffect(() => {
    const cv = canvas.current!;
    const ctx = cv.getContext('2d')!;
    let raf = 0, last = performance.now(), lastDraw = 0;

    const resize = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      cv.width = cv.clientWidth * dpr;
      cv.height = cv.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(cv);

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const st = useWorld.getState();
      if (!st.room) return;
      stepLocalPlayer(dt, 0, st.room.worldSize);
      // Interpolate remote players (same smoothing as 3D).
      for (const [id, t] of remoteTargets) {
        const r = remoteRendered.get(id) ?? { x: t.x, z: t.z };
        const k = 1 - Math.exp(-dt * 10);
        r.x += (t.x - r.x) * k; r.z += (t.z - r.z) * k;
        remoteRendered.set(id, r);
      }
      if (now - lastDraw < 50) return; // ~20 fps is plenty for a map, saves battery
      lastDraw = now;
      draw(ctx, cv.clientWidth, cv.clientHeight, view.current, st);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  // Pointer: drag to pan, wheel/pinch to zoom, tap to select or place.
  useEffect(() => {
    const cv = canvas.current!;
    const pointers = new Map<number, { x: number; y: number }>();
    let moved = 0, pinch = 0;
    const toWorld = (px: number, py: number) => {
      const v = view.current, r = cv.getBoundingClientRect();
      return { x: (px - r.left - r.width / 2) / v.scale + v.cx, z: (py - r.top - r.height / 2) / v.scale + v.cz };
    };
    const down = (e: PointerEvent) => {
      cv.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved = 0;
      if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
    };
    const move = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const v = view.current;
      if (pointers.size === 2) {
        p.x = e.clientX; p.y = e.clientY;
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) v.scale = clamp(v.scale * (d / pinch), 1, 20);
        pinch = d;
        moved += 10;
        return;
      }
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      moved += Math.abs(dx) + Math.abs(dy);
      if (moved > 6) { v.follow = false; v.cx -= dx / v.scale; v.cz -= dy / v.scale; }
      p.x = e.clientX; p.y = e.clientY;
    };
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size) return;
      if (moved > 6) return;
      const w = toWorld(e.clientX, e.clientY);
      const st = useWorld.getState();
      if (st.tool.kind === 'place') {
        if (!canEditNow()) return st.notify('You do not have edit permission', 'error');
        return realtime.send({ t: 'obj_add', spec: defaultSpec(st.tool.type, { x: w.x, y: 0, z: w.z }) });
      }
      const hit = pick(Object.values(st.objects), w.x, w.z);
      if (st.tool.kind === 'route') {
        if (hit?.type === 'bus_stop' && !st.tool.stops.includes(hit.id)) st.set({ tool: { kind: 'route', stops: [...st.tool.stops, hit.id] } });
        return;
      }
      st.set({ selectedId: hit?.id ?? null });
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      view.current.scale = clamp(view.current.scale * (e.deltaY < 0 ? 1.1 : 0.9), 1, 20);
    };
    cv.addEventListener('pointerdown', down);
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', wheel, { passive: false });
    return () => {
      cv.removeEventListener('pointerdown', down); cv.removeEventListener('pointermove', move);
      cv.removeEventListener('pointerup', up); cv.removeEventListener('pointercancel', up); cv.removeEventListener('wheel', wheel);
    };
  }, []);

  return (
    <div className="relative h-full w-full">
      <canvas ref={canvas} className="h-full w-full touch-none bg-[#2aa3ab]" role="img" aria-label="2D city map" />
      <button
        className="absolute right-3 top-20 rounded-lg bg-white/90 md:top-3 px-3 py-1.5 text-xs font-medium shadow"
        onClick={() => (view.current.follow = true)}
      >
        Center on me
      </button>
    </div>
  );
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Top-most object whose (rotated) footprint contains the point. Buildings beat roads. */
function pick(objects: CityObject[], x: number, z: number) {
  const order = (o: CityObject) => (o.type === 'road' ? 0 : o.type === 'park' ? 1 : 2);
  return objects
    .filter((o) => {
      const [w, d] = OBJECT_INFO[o.type].footprint;
      const dx = x - o.position.x, dz = z - o.position.z;
      const c = Math.cos(-o.rotationY), s = Math.sin(-o.rotationY);
      const lx = dx * c + dz * s, lz = -dx * s + dz * c;
      return Math.abs(lx) <= (Math.max(w, 2) * o.scale.x) / 2 && Math.abs(lz) <= (Math.max(d, 2) * o.scale.z) / 2;
    })
    .sort((a, b) => order(b) - order(a))[0];
}

function draw(ctx: CanvasRenderingContext2D, W: number, H: number, v: { scale: number; cx: number; cz: number; follow: boolean }, st: ReturnType<typeof useWorld.getState>) {
  if (v.follow) { v.cx = localPlayer.x; v.cz = localPlayer.z; }
  const room = st.room!;
  ctx.fillStyle = '#2aa3ab'; // sea, matching the 3D view
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(v.scale, v.scale);
  ctx.translate(-v.cx, -v.cz);
  const beach = room.worldSize + 28, land = room.worldSize + 8;
  ctx.fillStyle = '#eadbb8';
  ctx.fillRect(-beach / 2, -beach / 2, beach, beach);
  ctx.fillStyle = '#d9cdb6';
  ctx.fillRect(-land / 2, -land / 2, land, land);

  const objs = Object.values(st.objects);
  const order = (o: CityObject) => (o.type === 'road' ? 0 : o.type === 'park' ? 1 : 2);
  objs.sort((a, b) => order(a) - order(b));
  for (const o of objs) {
    const [w, d] = OBJECT_INFO[o.type].footprint;
    ctx.save();
    ctx.translate(o.position.x, o.position.z);
    ctx.rotate(-o.rotationY);
    ctx.scale(o.scale.x, o.scale.z);
    ctx.fillStyle = partsFor(o)[0].color;
    if (o.type === 'tree') { ctx.beginPath(); ctx.arc(0, 0, 1.3, 0, Math.PI * 2); ctx.fill(); }
    else ctx.fillRect(-w / 2, -d / 2, w, d);
    if (o.id === st.selectedId) { ctx.strokeStyle = '#2f6fe4'; ctx.lineWidth = 3 / v.scale; ctx.strokeRect(-w / 2 - 1, -d / 2 - 1, w + 2, d + 2); }
    ctx.restore();
  }
  // routes
  for (const r of Object.values(st.routes)) {
    const pts = r.stopIds.map((id) => st.objects[id]).filter(Boolean);
    if (pts.length < 2) continue;
    ctx.strokeStyle = r.color;
    ctx.lineWidth = 2.5 / v.scale * 2;
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.position.x, p.position.z) : ctx.moveTo(p.position.x, p.position.z)));
    ctx.stroke();
  }
  if (st.tool.kind === 'route') {
    ctx.fillStyle = '#f59e0b';
    for (const id of st.tool.stops) { const o = st.objects[id]; if (o) { ctx.beginPath(); ctx.arc(o.position.x, o.position.z, 2.5, 0, Math.PI * 2); ctx.fill(); } }
  }
  // players
  const speaking = useMedia.getState().speaking;
  ctx.font = `${12 / v.scale}px system-ui`;
  ctx.textAlign = 'center';
  for (const p of Object.values(st.players)) {
    const isMe = p.id === st.self?.sessionId;
    const pos = isMe ? localPlayer : remoteRendered.get(p.id);
    if (!pos) continue;
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(pos.x, pos.z, 1.4, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = (speaking.has(p.userId) ? 4 : 2) / v.scale;
    ctx.strokeStyle = speaking.has(p.userId) ? '#22c55e' : isMe ? '#ffffff' : '#0f172a';
    ctx.stroke();
    ctx.fillStyle = '#0f172a';
    ctx.fillText(isMe ? 'You' : p.name, pos.x, pos.z - 2.4);
  }
  ctx.restore();
}
