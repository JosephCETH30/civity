// Aiming and firing for the PvP battle. The client only proposes a shot (muzzle + direction); the server decides hits.
// Third-person view: aim through the screen centre (crosshair). Top-down / touch: fire where the character faces,
// with a small aim assist toward the nearest opponent in front.
import * as THREE from 'three';
import { BATTLE, OBJECT_INFO, SOLID_TYPES, rayBox, rayCylinder } from '@civitas/shared';
import { useWorld } from '../../stores/world';
import { realtime, serverNow } from '../../services/realtime';
import { battleFx, localPlayer, remoteRendered, remoteTargets } from '../core/transient';

type Vec = [number, number, number];
let camera: THREE.Camera | null = null;
let last = 0;
const _dir = new THREE.Vector3();

export const setShootCamera = (c: THREE.Camera | null) => { camera = c; };

/** Opponents that can be hit right now, with their rendered positions. */
function targets() {
  const st = useWorld.getState();
  const me = st.self?.sessionId;
  const now = serverNow();
  const out: { id: string; x: number; y: number; z: number }[] = [];
  for (const [id, s] of Object.entries(st.battle)) {
    if (id === me || s.deadUntil > now) continue;
    const t = remoteTargets.get(id);
    const r = remoteRendered.get(id);
    if (t) out.push({ id, x: r?.x ?? t.x, y: t.y, z: r?.z ?? t.z });
  }
  return out;
}

function nearestBlock(o: Vec, d: Vec, max: number) {
  let t = max;
  if (d[1] < -1e-6) t = Math.min(t, -o[1] / d[1]);
  for (const ob of Object.values(useWorld.getState().objects)) {
    if (!SOLID_TYPES.includes(ob.type)) continue;
    if (Math.abs(ob.position.x - o[0]) > max + 20 || Math.abs(ob.position.z - o[2]) > max + 20) continue;
    const [w, dd] = OBJECT_INFO[ob.type].footprint;
    const floors = Number(ob.props.floors ?? OBJECT_INFO[ob.type].floors ?? 1);
    const hit = rayBox(o, d, { cx: ob.position.x, cz: ob.position.z, cos: Math.cos(ob.rotationY), sin: Math.sin(ob.rotationY), hw: (w * ob.scale.x) / 2, hd: (dd * ob.scale.z) / 2, h: floors * 3 * ob.scale.y });
    if (hit !== null && hit < t) t = hit;
  }
  return t;
}

export function fire() {
  const st = useWorld.getState();
  const me = st.self?.sessionId;
  if (!st.inBattle || !me) return;
  const stats = st.battle[me];
  if (!stats || stats.deadUntil > serverNow()) return;
  if (localPlayer.inside) return st.notify('No fighting indoors. Step outside first.');
  const nowMs = performance.now();
  if (nowMs - last < BATTLE.cooldownMs) return;
  last = nowMs;

  const o: Vec = [localPlayer.x, localPlayer.y + 1.3, localPlayer.z];
  let d: Vec;
  camera?.getWorldDirection(_dir);
  const firstPerson = st.cameraMode === 'first';
  const thirdPerson = (firstPerson || (st.cameraMode === 'third' && Math.abs(_dir.y) < 0.75)) && !!camera;
  if (thirdPerson && camera) {
    // Ray from the camera through the crosshair; aim the muzzle at whatever that ray hits first beyond the player.
    const ro: Vec = [camera.position.x, camera.position.y, camera.position.z];
    const rd: Vec = [_dir.x, _dir.y, _dir.z];
    const tMin = firstPerson ? 0.3 : Math.hypot(o[0] - ro[0], o[1] - ro[1], o[2] - ro[2]) + 0.6;
    let t = nearestBlock(ro, rd, BATTLE.range + tMin);
    for (const p of targets()) {
      const h = rayCylinder(ro, rd, p.x, p.y, p.z, BATTLE.radius, BATTLE.height);
      if (h && h.t > tMin && h.t < t) t = h.t;
    }
    t = Math.max(t, tMin + 1);
    const aim = [ro[0] + rd[0] * t, ro[1] + rd[1] * t, ro[2] + rd[2] * t];
    const v = new THREE.Vector3(aim[0] - o[0], aim[1] - o[1], aim[2] - o[2]).normalize();
    d = [v.x, v.y, v.z];
  } else {
    // Facing direction, nudged toward the closest opponent within ~25 degrees and 45 m.
    const fx = Math.sin(localPlayer.r), fz = Math.cos(localPlayer.r);
    d = [fx, 0, fz];
    let best = Infinity;
    for (const p of targets()) {
      const dx = p.x - o[0], dz = p.z - o[2];
      const dist = Math.hypot(dx, dz);
      if (dist < 0.5 || dist > 45) continue;
      const cos = (dx * fx + dz * fz) / dist;
      if (cos < 0.9 || dist >= best) continue;
      best = dist;
      const v = new THREE.Vector3(dx, p.y + 1.2 - o[1], dz).normalize();
      d = [v.x, v.y, v.z];
    }
  }
  // Turn the character toward the shot so others see who fired where; kick the view up a little (recoil).
  if (!firstPerson) { localPlayer.r = Math.atan2(d[0], d[2]); localPlayer.moved = true; }
  battleFx.recoil += 0.035;
  realtime.send({ t: 'shoot', o, d });
}

export function toggleBattle() {
  const st = useWorld.getState();
  if (!st.inBattle && st.renderMode === '2d') return st.notify('Battle needs the 3D view. Switch to 3D in Settings.', 'error');
  realtime.send({ t: 'battle', action: st.inBattle ? 'leave' : 'join' });
  if (!st.inBattle && (st.cameraMode === 'free' || st.cameraMode === 'overview')) st.set({ cameraMode: 'third' });
}
