// Local-player gameplay: walking with building collision, jumping, sitting, entering/leaving buildings, waving.
// Everything here only moves the local player; the result is synced like any movement (position + anim state),
// so other people see you jump, sit and disappear through a door.
import { INTERIOR_DEPTH, OBJECT_INFO, type CityObject } from '@civitas/shared';
import { useWorld } from '../../stores/world';
import { ENTERABLE } from '../objects/parts';
import { interiorFor, roomSize } from '../objects/interiors';
import { input, localPlayer } from './transient';
import { trafficRef } from '../simulation/traffic';

const GRAVITY = -22;
const JUMP_SPEED = 7;
const RADIUS = 0.35; // player collision radius
const REACH_SEAT = 1.4;
const REACH_DOOR = 2.2;

export interface Seat { x: number; z: number; y: number; r: number }
interface Frame { cx: number; cz: number; cos: number; sin: number; r: number }

const frameOf = (o: CityObject): Frame => ({ cx: o.position.x, cz: o.position.z, cos: Math.cos(o.rotationY), sin: Math.sin(o.rotationY), r: o.rotationY });
/** World -> building-local (local +z is the building front). */
const toLocal = (f: Frame, x: number, z: number) => {
  const dx = x - f.cx, dz = z - f.cz;
  return { lx: dx * f.cos - dz * f.sin, lz: dx * f.sin + dz * f.cos };
};
const toWorld = (f: Frame, lx: number, lz: number) => ({ x: f.cx + lx * f.cos + lz * f.sin, z: f.cz - lx * f.sin + lz * f.cos });

// ---------- cached world queries (rebuilt when the object map changes) ----------
let cacheFor: Record<string, CityObject> | null = null;
let solids: { o: CityObject; f: Frame; hw: number; hd: number }[] = [];
let benches: Seat[] = [];
let parks: { o: CityObject; f: Frame; hw: number; hd: number }[] = [];
let trees: CityObject[] = [];
function ensureCache() {
  const objects = useWorld.getState().objects;
  if (objects === cacheFor) return;
  cacheFor = objects;
  solids = [];
  benches = [];
  parks = [];
  trees = [];
  for (const o of Object.values(objects)) {
    const f = frameOf(o);
    if (ENTERABLE.includes(o.type)) {
      const [w, d] = OBJECT_INFO[o.type].footprint;
      solids.push({ o, f, hw: (w * o.scale.x) / 2, hd: (d * o.scale.z) / 2 });
    } else if (o.type === 'tree') {
      trees.push(o);
    } else if (o.type === 'park') {
      const [w, d] = OBJECT_INFO.park.footprint;
      parks.push({ o, f, hw: (w * o.scale.x) / 2, hd: (d * o.scale.z) / 2 });
    } else if (o.type === 'bench') {
      for (const lx of [-0.5, 0.5]) {
        const p = toWorld(f, lx * o.scale.x, 0.05);
        benches.push({ x: p.x, z: p.z, y: 0, r: o.rotationY });
      }
    }
  }
}

/** Gameplay clock in ms: advances with each player step, so timers (wave, knock-down) pause with the game. */
let clock = 0;
const now = () => clock;
export const playerNow = now;
const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);

function interiorSeats(o: CityObject): Seat[] {
  const f = frameOf(o);
  return interiorFor(o).seats.map((s) => ({ ...toWorld(f, s.x, s.z), y: INTERIOR_DEPTH, r: s.r + o.rotationY }));
}
function exteriorDoor(o: CityObject) {
  const [, d] = OBJECT_INFO[o.type].footprint;
  return toWorld(frameOf(o), 0, (d * o.scale.z) / 2 + 0.9);
}
function interiorDoor(o: CityObject) {
  return toWorld(frameOf(o), 0, roomSize(o).hd - 0.7);
}
const currentBuilding = () => (localPlayer.inside ? useWorld.getState().objects[localPlayer.inside] : undefined);

// ---------- actions ----------
export interface Action { label: string; run: () => void }

/** The one thing the player can do right now (shown as a prompt; E key / action button runs it). */
export function availableAction(): Action | null {
  ensureCache();
  const p = localPlayer;
  if (p.fallUntil > now()) return null;
  if (p.seat) return { label: 'Stand up', run: standUp };
  const inside = currentBuilding();
  if (inside) {
    const door = interiorDoor(inside);
    if (dist(p.x, p.z, door.x, door.z) < REACH_DOOR) return { label: 'Go outside', run: () => exitBuilding(inside) };
    const s = nearestSeat(interiorSeats(inside));
    if (s) return { label: 'Sit down', run: () => sit(s) };
    return null;
  }
  if (p.y > 0.05) return null;
  const s = nearestSeat(benches);
  if (s) return { label: 'Sit on bench', run: () => sit(s) };
  // Every tree has its own Ludo table (one game session per tree).
  let tree: CityObject | null = null, td = 2.6;
  for (const t of trees) {
    const d = dist(p.x, p.z, t.position.x, t.position.z);
    if (d < td) { td = d; tree = t; }
  }
  if (tree) {
    const id = tree.id;
    return { label: 'Play Ludo at this tree', run: () => useWorld.getState().set({ ludoTree: id }) };
  }
  // Parks host the photo-to-3D studio (M7: AI-based graphics).
  for (const pk of parks) {
    const l = toLocal(pk.f, p.x, p.z);
    if (Math.abs(l.lx) <= pk.hw + 1 && Math.abs(l.lz) <= pk.hd + 1) {
      return { label: 'Open the fountain studio (AI realism, photo to 3D)', run: () => useWorld.getState().set({ artStudio: pk.o.id }) };
    }
  }
  let best: { o: CityObject; d: number } | null = null;
  for (const { o } of solids) {
    const door = exteriorDoor(o);
    const d = dist(p.x, p.z, door.x, door.z);
    if (d < REACH_DOOR && (!best || d < best.d)) best = { o, d };
  }
  if (best) {
    const o = best.o;
    return { label: `Enter ${o.props.name || OBJECT_INFO[o.type].label.toLowerCase()}`, run: () => enterBuilding(o) };
  }
  return null;
}

function nearestSeat(seats: Seat[]) {
  let best: Seat | null = null, bd = REACH_SEAT;
  for (const s of seats) {
    const d = dist(localPlayer.x, localPlayer.z, s.x, s.z);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

function sit(s: Seat) {
  Object.assign(localPlayer, { seat: s, x: s.x, z: s.z, y: s.y, r: s.r, vy: 0, a: 'sit', moved: true });
}
function standUp() {
  const s = localPlayer.seat;
  if (!s) return;
  // step forward off the seat
  Object.assign(localPlayer, { seat: null, x: s.x + Math.sin(s.r) * 0.6, z: s.z + Math.cos(s.r) * 0.6, a: 'idle', moved: true });
}
function enterBuilding(o: CityObject) {
  const p = interiorDoor(o);
  Object.assign(localPlayer, { inside: o.id, x: p.x, z: p.z, y: INTERIOR_DEPTH, vy: 0, r: o.rotationY + Math.PI, a: 'idle', moved: true });
  useWorld.getState().set({ inside: o.id, cameraMode: 'third' });
}
function exitBuilding(o: CityObject) {
  const p = exteriorDoor(o);
  Object.assign(localPlayer, { inside: null, seat: null, x: p.x, z: p.z, y: 0, vy: 0, r: o.rotationY, a: 'idle', moved: true });
  useWorld.getState().set({ inside: null });
}
/** Leave any building/seat without a door (reconnect, building deleted). */
export function resetPlayerState() {
  Object.assign(localPlayer, { inside: null, seat: null, vy: 0, y: 0, waveUntil: 0, fallUntil: 0, kx: 0, kz: 0 });
  useWorld.getState().set({ inside: null });
}

export function interact() { availableAction()?.run(); }
export function jump() {
  const p = localPlayer;
  if (p.fallUntil > now()) return;
  if (p.seat) return standUp();
  const floor = p.inside ? INTERIOR_DEPTH : 0;
  if (p.y <= floor + 0.001) p.vy = JUMP_SPEED;
}
export function wave() {
  if (!localPlayer.seat) localPlayer.waveUntil = now() + 2200;
}

// ---------- keyboard ----------
const keys = new Set<string>();
function recompute() {
  input.x = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  input.z = (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0);
  input.run = keys.has('ShiftLeft') || keys.has('ShiftRight');
}
const typing = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
};

/** Install keyboard controls: WASD/arrows move, Shift runs, Space jumps, E interacts, Q waves. Returns a cleanup. */
export function bindKeyboard() {
  const down = (e: KeyboardEvent) => {
    if (typing(e)) return;
    if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) jump(); return; }
    if (e.code === 'KeyE' && !e.repeat) return interact();
    if (e.code === 'KeyQ' && !e.repeat) return wave();
    keys.add(e.code);
    recompute();
  };
  const up = (e: KeyboardEvent) => { keys.delete(e.code); recompute(); };
  const blur = () => { keys.clear(); recompute(); };
  addEventListener('keydown', down);
  addEventListener('keyup', up);
  addEventListener('blur', blur);
  return () => { removeEventListener('keydown', down); removeEventListener('keyup', up); removeEventListener('blur', blur); blur(); };
}


// ---------- per-frame step ----------
/**
 * Advance the local player. `yaw` is the camera azimuth so "forward" means away from the camera.
 * Shared by the 3D view and the 2D fallback so both move identically.
 */
export function stepLocalPlayer(dt: number, yaw: number, worldSize: number) {
  clock += dt * 1000;
  ensureCache();
  const p = localPlayer;
  let ix = input.x + input.joyX, iz = input.z + input.joyZ;
  const len = Math.hypot(ix, iz);
  if (len > 1) { ix /= len; iz /= len; }
  const moving = len > 0.05;

  const building = currentBuilding();
  if (p.inside && !building) resetPlayerState(); // building was deleted while we were inside

  if (p.seat) {
    if (moving) standUp();
    else return;
  }

  const down = p.fallUntil > now();
  if (down) {
    // Knocked down: slide with the impact, no control until you get up.
    const decay = Math.exp(-3 * dt);
    p.kx *= decay; p.kz *= decay;
    const half = worldSize / 2;
    const pushed = collideBuildings(p.x + p.kx * dt, p.z + p.kz * dt);
    p.x = Math.max(-half, Math.min(half, pushed.x));
    p.z = Math.max(-half, Math.min(half, pushed.z));
    p.moved = true;
  } else if (moving) {
    const speed = (input.run ? 12 : 6) * Math.min(1, len);
    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    const dx = ix * cos + iz * sin;
    const dz = -ix * sin + iz * cos;
    let nx = p.x + dx * speed * dt, nz = p.z + dz * speed * dt;

    if (building) {
      // Walls: clamp inside the room in the building's local frame.
      const f = frameOf(building);
      const { hw, hd } = roomSize(building);
      const l = toLocal(f, nx, nz);
      const w = toWorld(f, Math.max(-hw + RADIUS, Math.min(hw - RADIUS, l.lx)), Math.max(-hd + RADIUS, Math.min(hd - RADIUS, l.lz)));
      nx = w.x; nz = w.z;
    } else if (p.y < 6) {
      ({ x: nx, z: nz } = collideBuildings(nx, nz));
    }
    const half = worldSize / 2;
    p.x = Math.max(-half, Math.min(half, nx));
    p.z = Math.max(-half, Math.min(half, nz));
    p.r = Math.atan2(dx, dz);
    p.moved = true;
  }

  // Gravity / jumping.
  const floor = building ? INTERIOR_DEPTH : 0;
  if (p.vy !== 0 || p.y > floor) {
    p.vy += GRAVITY * dt;
    p.y += p.vy * dt;
    if (p.y <= floor) { p.y = floor; p.vy = 0; }
    p.moved = true;
  } else if (p.y < floor) p.y = floor;

  if (!building && p.y < 2.5) collideVehicles(down);

  const airborne = p.y > floor + 0.01;
  const a = p.fallUntil > now() ? 'fall' : airborne ? 'jump' : moving ? 'walk' : p.waveUntil > now() ? 'wave' : 'idle';
  if (a !== p.a) { p.a = a; p.moved = true; }
}

/** Buildings are solid: push a point out along the shallowest axis of any oriented box it is inside. */
function collideBuildings(x: number, z: number) {
  for (const s of solids) {
    if (Math.abs(x - s.f.cx) > s.hw + s.hd + 2 || Math.abs(z - s.f.cz) > s.hw + s.hd + 2) continue;
    const l = toLocal(s.f, x, z);
    const px = s.hw + RADIUS - Math.abs(l.lx), pz = s.hd + RADIUS - Math.abs(l.lz);
    if (px <= 0 || pz <= 0) continue;
    if (px < pz) l.lx += Math.sign(l.lx || 1) * px;
    else l.lz += Math.sign(l.lz || 1) * pz;
    ({ x, z } = toWorld(s.f, l.lx, l.lz));
  }
  return { x, z };
}

const HIT_SPEED = 1.5; // m/s: slower contact just blocks you, faster contact knocks you down
const FALL_MS = 1800;

/** Vehicles are solid; a moving one knocks the player sideways out of its lane and onto the ground. */
function collideVehicles(alreadyDown: boolean) {
  const sys = trafficRef.current;
  if (!sys) return;
  const p = localPlayer;
  for (const v of sys.vehicles) {
    const pose = sys.pose(v);
    if (pose.scale < 0.5) continue;
    const fx = Math.sin(pose.r), fz = Math.cos(pose.r); // vehicle forward
    const dx = p.x - pose.x, dz = p.z - pose.z;
    const along = dx * fx + dz * fz, side = dx * fz - dz * fx; // side: + is the vehicle's left
    const pa = v.len / 2 + RADIUS - Math.abs(along), ps = v.w / 2 + RADIUS - Math.abs(side);
    if (pa <= 0 || ps <= 0) continue;
    if (v.v > HIT_SPEED && !alreadyDown && p.fallUntil < now()) {
      const dir = Math.sign(side || 1);
      const sideSpeed = 6 + v.v * 0.3, fwdSpeed = v.v * 0.6;
      p.kx = fx * fwdSpeed + fz * dir * sideSpeed;
      p.kz = fz * fwdSpeed - fx * dir * sideSpeed;
      p.vy = 4.5;
      p.seat = null;
      p.fallUntil = now() + FALL_MS;
      p.hitAt = now();
      p.moved = true;
      useWorld.getState().notify(v.kind === 'bus' ? 'A bus knocked you over. Use the crossings when the lights are red for traffic.' : 'A car knocked you over. Watch the traffic lights.');
      return;
    }
    // Just touching (or already down): push out sideways or backwards, whichever is shorter.
    if (ps < pa) { const d = Math.sign(side || 1) * ps; p.x += fz * d; p.z -= fx * d; }
    else { const d = Math.sign(along || 1) * pa; p.x += fx * d; p.z += fz * d; }
  }
}
