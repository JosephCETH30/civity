import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useAnimations, useGLTF } from '@react-three/drei';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AnimState } from '@civitas/shared';
import { fxHitAt, fxShotAt, localPlayer, remoteRendered, remoteTargets } from '../core/transient';
import { lamp } from '../materials/materials';
import { merged } from './merge';

// "Citizen": original stylised city dweller, 1.9 m tall, built from primitives.
// 12 meshes, one per moving segment. Parts that move together are merged into one geometry with vertex colours,
// so every avatar shares ONE material. Pivots (y, metres): hip 0.86, knee 0.47, shoulder 1.46, elbow 1.16.
// Triangles: 723 on Low, 2,184 on Balanced/High (checked in avatar.test.ts) (same parts and pivots, fewer segments on Low).

const HIP_Y = 0.86, HIP_X = 0.11, KNEE = 0.39, SHOULDER_Y = 1.45, SHOULDER_X = 0.3, ELBOW = 0.3, NECK_Y = 1.555;
const SEAT_HIP_Y = 0.59; // seats are 0.48-0.50 m high; thigh radius 0.10 puts the hip pivot here
const SOLE = '#e9e4da', SKIN = '#d9a982', EYE = '#1d1a18';
// The jacket is the player's own colour (matches minimap/scoreboard). Trousers, hair and shoes come from muted,
// natural palettes (no off-white trousers: they read as bare legs from the camera).
const TROUSERS = ['#3a3f47', '#4f6a8f', '#5b4636', '#2f4a5c', '#6b5a45', '#2f6b70'];
const HAIR = ['#2b2118', '#4a3424', '#1d1a18', '#6b4a2f', '#8a5a35'];
const SHOES = ['#2b2a28', '#5b4636', '#3a3f47', '#7a3b2e'];

const capsule = (r: number, total: number, d: Detail) => new THREE.CapsuleGeometry(r, Math.max(0.001, total - 2 * r), d.cap, d.radial);
const sphere = (r: number, d: Detail) => new THREE.SphereGeometry(r, d.sw, d.sh);
type Detail = { radial: number; cap: number; sw: number; sh: number; small: [number, number] };
const DETAIL: Record<'low' | 'high', Detail> = { low: { radial: 6, cap: 1, sw: 7, sh: 5, small: [5, 4] }, high: { radial: 10, cap: 3, sw: 12, sh: 9, small: [8, 6] } };
const small = (r: number, d: Detail) => new THREE.SphereGeometry(r, d.small[0], d.small[1]);

/** Torso: a rounded block, a little wider at the chest than at the hips, flatter front to back. */
function torsoGeo(d: Detail) {
  const g = capsule(0.2, 0.66, { ...d, radial: d.radial + 2, cap: d.cap + 1 }); // the biggest shape gets a bit more detail
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const k = 1.25 * (1 + 0.1 * (p.getY(i) / 0.33)); // 1.12 at the hips -> 1.37 at the chest
    p.setX(i, p.getX(i) * k);
    p.setZ(i, p.getZ(i) * 0.8);
  }
  g.computeVertexNormals();
  return g;
}

export interface CitizenColors { jacket: string; trousers: string; hair: string; shoes: string }
export function citizenColors(jacket: string, seed: string): CitizenColors {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const dist = (a: string, b: string) => { const x = new THREE.Color(a), y = new THREE.Color(b); return Math.hypot(x.r - y.r, x.g - y.g, x.b - y.b); };
  // First palette colour (starting at a per-player offset) that contrasts with the colours already used.
  const pick = (palette: string[], k: number, avoid: string[]) => {
    for (let i = 0; i < palette.length; i++) {
      const c = palette[(Math.abs(h >> k) + i) % palette.length];
      if (avoid.every((a) => dist(a, c) > 0.25)) return c;
    }
    return palette[0];
  };
  const trousers = pick(TROUSERS, 0, [jacket]);
  return { jacket, trousers, hair: pick(HAIR, 4, []), shoes: pick(SHOES, 8, [trousers]) };
}

/** All 12 segment geometries for one colour set and detail level (cached: avatars with the same look share them). */
const geoCache = new Map<string, Record<string, THREE.BufferGeometry>>();
export function citizenGeometry(col: CitizenColors, level: 'low' | 'high') {
  const key = `${col.jacket}|${col.trousers}|${col.hair}|${col.shoes}|${level}`;
  let set = geoCache.get(key);
  if (set) return set;
  const d = DETAIL[level];
  const jacketDark = '#' + new THREE.Color(col.jacket).multiplyScalar(0.9).getHexString();
  set = {
    // torso + neck (local to the hip pivot)
    torso: merged([
      { geo: torsoGeo(d), color: col.jacket, pos: [0, 1.2 - HIP_Y, 0] },
      { geo: new THREE.CylinderGeometry(0.06, 0.07, 0.1, d.radial), color: SKIN, pos: [0, NECK_Y - HIP_Y, 0] },
    ]),
    // jacket hem flaring over the hips (pivot at its top edge so it can swing)
    // (matches the torso's hip cross-section, flaring a little; same jacket colour, a touch darker)
    hem: merged([{ geo: new THREE.CylinderGeometry(0.235, 0.26, 0.13, d.radial + 2, 1, true), color: jacketDark, pos: [0, -0.065, 0], scale: [1, 1, 0.72] }]),
    // head with hair, eyes and brow (pivot at the neck)
    head: merged([
      { geo: sphere(0.18, d), color: SKIN, pos: [0, 0.17, 0], scale: [1, 1.05, 1] },
      // full head of hair: a cap tilted back a little, covering the crown and the back down to the forehead
      { geo: new THREE.SphereGeometry(0.193, d.sw, Math.max(4, d.sh - 2), 0, Math.PI * 2, 0, Math.PI * 0.56), color: col.hair, pos: [0, 0.18, -0.012], rot: [-0.22, 0, 0] },
      { geo: small(0.022, d), color: EYE, pos: [-0.06, 0.165, 0.166] },
      { geo: small(0.022, d), color: EYE, pos: [0.06, 0.165, 0.166] },
      { geo: new THREE.BoxGeometry(0.13, 0.016, 0.03), color: col.hair, pos: [0, 0.21, 0.169] },
    ]),
    // front tuft that lags behind fast moves (pivot at the crown)
    tuft: merged([{ geo: small(0.09, d), color: col.hair, pos: [0, 0, 0.06], scale: [1, 0.42, 0.75], rot: [-0.3, 0, 0] }]),
    // Limb segments overlap a few cm past each joint, so elbows and knees read as one smooth limb (no pinch).
    upperArm: merged([{ geo: capsule(0.072, 0.38, d), color: col.jacket, pos: [0, -0.16, 0] }]),
    forearm: merged([
      { geo: capsule(0.068, 0.32, d), color: col.jacket, pos: [0, -0.12, 0] },
      { geo: small(0.07, d), color: SKIN, pos: [0, -0.3, 0.005], scale: [0.9, 1.15, 0.8] },
    ]),
    thigh: merged([{ geo: capsule(0.1, 0.48, d), color: col.trousers, pos: [0, -0.2, 0] }]),
    shin: merged([
      { geo: capsule(0.092, 0.42, d), color: col.trousers, pos: [0, -0.16, 0] },
      { geo: new THREE.BoxGeometry(0.14, 0.09, 0.27), color: col.shoes, pos: [0, -(HIP_Y - KNEE) + 0.075, 0.05] },
      { geo: new THREE.BoxGeometry(0.15, 0.03, 0.29), color: SOLE, pos: [0, -(HIP_Y - KNEE) + 0.015, 0.05] },
    ]),
  };
  geoCache.set(key, set);
  return set;
}

// One material for every avatar (colours live in the geometry).
const citizenMat = new THREE.MeshLambertMaterial({ vertexColors: true });

// Battle blaster: original chunky toy design. Body, grip and barrel merged; one glowing strip (lamp material).
const blasterGeo = merged([
  { geo: new THREE.BoxGeometry(0.12, 0.14, 0.4), color: '#3a4250', pos: [0, 0, 0.1] },
  { geo: new THREE.BoxGeometry(0.07, 0.15, 0.08), color: '#262b33', pos: [0, -0.1, 0], rot: [0.3, 0, 0] },
  { geo: new THREE.CylinderGeometry(0.035, 0.04, 0.16, 8), color: '#262b33', pos: [0, 0.01, 0.37], rot: [Math.PI / 2, 0, 0] },
  { geo: new THREE.BoxGeometry(0.13, 0.05, 0.12), color: '#e07a3c', pos: [0, 0.075, 0.02] },
]);
const blasterStrip = new THREE.BoxGeometry(0.012, 0.03, 0.26);

const ring = new THREE.RingGeometry(0.6, 0.78, 24).rotateX(-Math.PI / 2);
const speakMat = new THREE.MeshBasicMaterial({ color: '#16a34a', transparent: true, opacity: 0.9 });
const hpBack = new THREE.SpriteMaterial({ color: '#111111', opacity: 0.75, transparent: true, depthWrite: false });
const hpMats = { high: new THREE.SpriteMaterial({ color: '#22c55e', depthWrite: false }), mid: new THREE.SpriteMaterial({ color: '#eab308', depthWrite: false }), low: new THREE.SpriteMaterial({ color: '#ef4444', depthWrite: false }) };
const _v = new THREE.Vector3();


/**
 * Optional custom avatar: put a GLB at client/public/models/avatar.glb (you must have the rights to it).
 * It is used on balanced/high quality; low quality keeps the procedural figure to protect phone frame rates.
 */
const MODEL_URL = '/models/avatar.glb';
let modelCheck: Promise<boolean> | null = null;
function useCustomModel() {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    modelCheck ??= fetch(MODEL_URL, { method: 'HEAD' })
      .then((r) => r.ok && !(r.headers.get('content-type') ?? '').includes('text/html'))
      .catch(() => false);
    let live = true;
    modelCheck.then((v) => live && setOk(v));
    return () => { live = false; };
  }, []);
  return ok;
}

interface Props {
  sessionId: string | 'local';
  name: string;
  color: string;
  /** Stable per-player id (user id) so everyone sees the same trousers/hair colours for a player. */
  seed?: string;
  speaking: boolean;
  showLabel: boolean;
  lite: boolean;
  /** In the PvP battle: holds a blaster; `hp` (0-100) shows a health bar for other players. */
  armed?: boolean;
  hp?: number;
}

const LEG = 0.86; // hip to sole, for stride length
const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

/** Remote avatars interpolate toward the last server pose; the local one reads the controller directly. */
export function Avatar({ sessionId, name, color, seed, speaking, showLabel, lite, armed, hp }: Props) {
  const g = useRef<THREE.Group>(null);
  const pose = useRef<THREE.Group>(null);
  const upper = useRef<THREE.Group>(null);
  const torso = useRef<THREE.Mesh>(null);
  const hem = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const tuft = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null), armR = useRef<THREE.Group>(null);
  const foreL = useRef<THREE.Group>(null), foreR = useRef<THREE.Group>(null);
  const thighL = useRef<THREE.Group>(null), thighR = useRef<THREE.Group>(null);
  const shinL = useRef<THREE.Group>(null), shinR = useRef<THREE.Group>(null);
  const animRef = useRef<AnimState>('idle');
  // Animation memory: clocks, smoothed speed / vertical speed, follow-through angles, idle look-around.
  const st = useRef({ phase: Math.random() * 10, speed: 0, vy: 0, prevAnim: 'idle' as AnimState, animT: 0, landT: 9, lookT: 2, look: 0, headYaw: 0, hemX: 0, hemZ: 0, tuftX: 0, px: 0, py: 0, pz: 0, init: false });
  const colors = useMemo(() => citizenColors(color, seed ?? name), [color, seed, name]);
  const geo = useMemo(() => citizenGeometry(colors, lite ? 'low' : 'high'), [colors, lite]);
  const custom = useCustomModel() && !lite;

  useFrame((_, rawDt) => {
    const grp = g.current;
    if (!grp) return;
    const dt = Math.min(rawDt, 0.1);
    let anim: AnimState;
    if (sessionId === 'local') {
      grp.position.set(localPlayer.x, localPlayer.y, localPlayer.z);
      grp.rotation.y = localPlayer.a === 'sit' ? localPlayer.r : lerpAngle(grp.rotation.y, localPlayer.r, Math.min(1, dt * 12));
      anim = localPlayer.a;
    } else {
      const t = remoteTargets.get(sessionId);
      if (!t) return;
      // Exponential smoothing toward the 10 Hz server pose hides network jitter.
      const k = 1 - Math.exp(-dt * 10);
      _v.set(t.x, t.y, t.z);
      if (grp.position.distanceToSquared(_v) > 400) grp.position.copy(_v); // teleport, don't glide across the map
      else grp.position.lerp(_v, k);
      grp.rotation.y = lerpAngle(grp.rotation.y, t.r, k);
      anim = t.a;
      remoteRendered.set(sessionId, { x: grp.position.x, z: grp.position.z });
    }
    animRef.current = anim;
    const s = st.current;
    // Measured ground speed and vertical speed drive stride length, lean and follow-through.
    if (!s.init) { s.px = grp.position.x; s.py = grp.position.y; s.pz = grp.position.z; s.init = true; }
    const rawSpeed = dt > 0 ? Math.hypot(grp.position.x - s.px, grp.position.z - s.pz) / dt : 0;
    const rawVy = dt > 0 ? (grp.position.y - s.py) / dt : 0;
    s.px = grp.position.x; s.py = grp.position.y; s.pz = grp.position.z;
    s.speed += (Math.min(rawSpeed, 20) - s.speed) * damp(8, dt);
    s.vy += (Math.max(-12, Math.min(12, rawVy)) - s.vy) * damp(10, dt);
    if (anim !== s.prevAnim) { if (s.prevAnim === 'jump') s.landT = 0; s.prevAnim = anim; s.animT = 0; }
    s.animT += dt;
    s.landT += dt;
    if (custom) return; // the GLB plays its own clips

    const walking = anim === 'walk';
    const speed = walking ? Math.max(1.5, s.speed) : 0;
    const amp = walking ? Math.min(0.85, 0.3 + speed * 0.045) : 0;
    // One phase cycle = two steps; step length follows leg angle so the feet don't slide.
    const cycle = Math.max(0.6, 4 * LEG * Math.sin(Math.max(amp, 0.2)));
    s.phase += walking ? (dt * Math.PI * 2 * speed) / cycle : dt * 1.6;
    const sn = Math.sin(s.phase), cs = Math.cos(s.phase);

    let thL = 0, thR = 0, knL = 0.04, knR = 0.04;
    let uaL = 0, uaR = 0, uaLZ = -0.07, uaRZ = 0.07, faL = -0.15, faR = -0.15, faRZ = 0;
    let bodyY = 0, bodyZ = 0, lean = 0, roll = 0, sway = 0, breath = 0, squash = 1, headPitch = 0, look = 0;
    if (walking) {
      thL = -amp * sn; thR = amp * sn;
      knL = 0.1 + 1.3 * amp * Math.max(0, cs); knR = 0.1 + 1.3 * amp * Math.max(0, -cs);
      uaL = amp * 0.8 * sn; uaR = -amp * 0.8 * sn;
      faL = faR = -0.25 - 0.4 * amp;
      bodyY = 0.035 * (1 - Math.abs(sn)) - 0.02; // two bobs per stride, highest when the legs pass
      sway = 0.02 * sn; roll = -0.035 * sn; // weight over the supporting leg
      lean = Math.min(0.28, speed * 0.022);
    } else if (anim === 'idle') {
      breath = Math.sin(s.phase) * 0.012;
      sway = 0.012 * Math.sin(s.phase * 0.37); roll = 0.015 * Math.sin(s.phase * 0.37);
      s.lookT -= dt;
      if (s.lookT < 0) { s.look = Math.random() < 0.5 ? 0 : (Math.random() - 0.5) * 1.1; s.lookT = 2 + Math.random() * 3; }
      look = s.look;
    } else if (anim === 'sit') {
      thL = thR = -1.5; knL = knR = 1.5;
      bodyY = SEAT_HIP_Y - HIP_Y; bodyZ = -0.08;
      uaL = uaR = -0.45; faL = faR = -0.9; // hands resting on the thighs
    } else if (anim === 'jump') {
      const t = s.animT;
      if (t < 0.08) { squash = 1 - 1.2 * t; knL = knR = 0.6; thL = thR = -0.3; } // crouch
      else if (t < 0.22) { squash = 1.07; } // stretch on take-off
      else { thL = thR = -0.9; knL = knR = 1.4; headPitch = -0.15; } // tuck at the top
      uaL = uaR = -2.4; faL = faR = -0.2;
    } else if (anim === 'wave') {
      uaRZ = 2.5; faR = -0.2; faRZ = 0.5 * Math.sin(s.animT * 10);
      breath = Math.sin(s.phase) * 0.01;
    } else if (anim === 'fall') {
      uaLZ = -0.9; uaRZ = 0.9; uaL = uaR = -0.4; knL = 0.5; knR = 0.2;
    }
    // Landing squash, recovering over 0.2 s.
    if (anim !== 'jump' && s.landT < 0.2) {
      const k = 1 - s.landT / 0.2;
      squash *= 1 - 0.12 * k; knL += 0.5 * k; knR += 0.5 * k; thL -= 0.25 * k; thR -= 0.25 * k;
    }
    if (armed && anim !== 'sit' && anim !== 'fall') { uaR = -1.45; uaRZ = 0; faR = 0; faRZ = 0; uaL = -1.15; uaLZ = 0.45; faL = -0.35; }
    // Battle feedback: arm kicks up when firing; the body flinches back when hit.
    const nowMs = performance.now();
    const shotK = Math.max(0, 1 - (nowMs - (fxShotAt.get(sessionId) ?? -1e9)) / 150);
    const hitK = Math.max(0, 1 - (nowMs - (fxHitAt.get(sessionId) ?? -1e9)) / 260);
    uaR -= shotK * 0.35;

    // Follow-through: hem and hair tuft lag behind lean, sway and vertical motion.
    s.hemX += (-lean * 1.1 + s.vy * 0.03 - s.hemX) * damp(6, dt);
    s.hemZ += (-roll * 1.6 - s.hemZ) * damp(6, dt);
    s.tuftX += (Math.max(-0.5, Math.min(0.6, -s.vy * 0.06)) - lean * 0.8 - s.tuftX) * damp(9, dt);
    s.headYaw += (look - s.headYaw) * damp(3, dt);

    const set = (o: THREE.Object3D | null, x: number, z = 0) => { if (o) { o.rotation.x = x; o.rotation.z = z; } };
    set(thighL.current, thL); set(thighR.current, thR);
    set(shinL.current, knL); set(shinR.current, knR);
    set(armL.current, uaL, uaLZ); set(armR.current, uaR, uaRZ);
    set(foreL.current, faL); set(foreR.current, faR, faRZ);
    for (const t of [thighL.current, thighR.current]) if (t) { t.position.y = HIP_Y + bodyY; t.position.z = bodyZ; }
    if (upper.current) {
      upper.current.position.set(sway, HIP_Y + bodyY, bodyZ);
      upper.current.rotation.set(lean, 0, roll);
    }
    if (torso.current) torso.current.scale.set(1 - breath * 0.5, 1 + breath, 1);
    if (hem.current) hem.current.rotation.set(s.hemX, 0, s.hemZ);
    if (tuft.current) tuft.current.rotation.x = s.tuftX;
    if (head.current) head.current.rotation.set(headPitch - lean * 0.5, s.headYaw, 0);
    if (pose.current) {
      // Knocked down: tip over backwards onto the ground, then get back up. Squash/stretch from the feet.
      const k = damp(12, dt);
      const down = anim === 'fall';
      pose.current.rotation.x += ((down ? -1.45 : hitK * -0.4) - pose.current.rotation.x) * k;
      pose.current.rotation.z = hitK * Math.sin(nowMs / 25) * 0.08;
      pose.current.position.y += ((down ? 0.3 : 0) - pose.current.position.y) * k;
      pose.current.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
    }
  });

  const shadow = !lite;
  const limb = (side: -1 | 1) => (
    <group ref={side < 0 ? armL : armR} position={[side * SHOULDER_X, SHOULDER_Y - HIP_Y, 0]}>
      <mesh geometry={geo.upperArm} material={citizenMat} />
      <group ref={side < 0 ? foreL : foreR} position={[0, -ELBOW, 0]}>
        <mesh geometry={geo.forearm} material={citizenMat} />
        {side > 0 && armed && (
          <group position={[0, -0.3, 0.03]} rotation-x={Math.PI / 2}>
            <mesh geometry={blasterGeo} material={citizenMat} />
            <mesh geometry={blasterStrip} material={lamp} position={[0.062, 0.02, 0.1]} />
          </group>
        )}
      </group>
    </group>
  );
  const leg = (side: -1 | 1) => (
    <group ref={side < 0 ? thighL : thighR} position={[side * HIP_X, HIP_Y, 0]}>
      <mesh geometry={geo.thigh} material={citizenMat} />
      <group ref={side < 0 ? shinL : shinR} position={[0, -KNEE, 0]}>
        <mesh geometry={geo.shin} material={citizenMat} castShadow={shadow} />
      </group>
    </group>
  );
  const procedural = (
    <>
      <group ref={upper} position={[0, HIP_Y, 0]}>
        <mesh ref={torso} geometry={geo.torso} material={citizenMat} castShadow={shadow} />
        <group ref={hem} position={[0, 0.14, 0]}><mesh geometry={geo.hem} material={citizenMat} /></group>
        <group ref={head} position={[0, NECK_Y - HIP_Y, 0]}>
          <mesh geometry={geo.head} material={citizenMat} castShadow={shadow} />
          <group ref={tuft} position={[0, 0.35, 0.04]}><mesh geometry={geo.tuft} material={citizenMat} /></group>
        </group>
        {limb(-1)}
        {limb(1)}
      </group>
      {leg(-1)}
      {leg(1)}
    </>
  );

  return (
    <group ref={g}>
      <group ref={pose}>
        {custom ? <Suspense fallback={procedural}><CustomBody anim={animRef} /></Suspense> : procedural}
        {custom && armed && (
          <group position={[0.3, 1.3, 0.3]}>
            <mesh geometry={blasterGeo} material={citizenMat} />
            <mesh geometry={blasterStrip} material={lamp} position={[0.062, 0.02, 0.1]} />
          </group>
        )}
      </group>
      {speaking && <mesh geometry={ring} material={speakMat} position={[0, 0.04, 0]} />}
      {showLabel && <NameLabel name={name} speaking={speaking} />}
      {armed && hp !== undefined && showLabel && (
        <group position={[0, 2.95, 0]}>
          <sprite material={hpBack} scale={[1.04, 0.14, 1]} raycast={() => null} />
          <sprite material={hp > 60 ? hpMats.high : hp > 30 ? hpMats.mid : hpMats.low} center={[0, 0.5]} position={[-0.5, 0, 0.001]} scale={[Math.max(0.001, hp / 100), 0.1, 1]} raycast={() => null} />
        </group>
      )}
    </group>
  );
}

/** Custom GLB body, normalised to ~1.9 m tall. Plays clips named walk/run and idle when the file has them. */
function CustomBody({ anim }: { anim: React.RefObject<AnimState> }) {
  const { scene, animations } = useGLTF(MODEL_URL);
  const root = useRef<THREE.Group>(null);
  const { object, scale, offsetY } = useMemo(() => {
    const object = cloneSkinned(scene);
    object.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    const box = new THREE.Box3().setFromObject(scene);
    const h = Math.max(0.01, box.max.y - box.min.y);
    const scale = 1.9 / h;
    return { object, scale, offsetY: -box.min.y * scale };
  }, [scene]);

  const { actions, names } = useAnimations(animations, root);
  const clip = (re: RegExp) => names.find((n) => re.test(n));
  const walkName = clip(/walk|run/i);
  const idleName = clip(/idle|stand/i) ?? (walkName ? undefined : names[0]);
  const byState: Partial<Record<AnimState, string | undefined>> = { walk: walkName, sit: clip(/sit/i), jump: clip(/jump/i), wave: clip(/wave/i) };
  const current = useRef<string | undefined>(undefined);
  useFrame(() => {
    // No sit clip in the file: lower the model so it still reads as seated.
    if (root.current) root.current.position.y = offsetY + (anim.current === 'sit' && !byState.sit ? -0.4 : 0);
    const want = byState[anim.current] ?? idleName;
    if (want === current.current) return;
    if (current.current) actions[current.current]?.fadeOut(0.2);
    if (want) actions[want]?.reset().fadeIn(0.2).play();
    current.current = want;
  });
  return (
    <group ref={root} position={[0, offsetY, 0]} scale={scale}>
      <primitive object={object} />
    </group>
  );
}

/** Name tag as a camera-facing sprite with a canvas texture: no DOM nodes per avatar. */
function NameLabel({ name, speaking }: { name: string; speaking: boolean }) {
  const { texture, aspect } = useMemo(() => {
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d')!;
    const font = '600 40px system-ui, sans-serif';
    ctx.font = font;
    const text = name;
    const w = Math.ceil(ctx.measureText(text).width) + 40;
    c.width = w; c.height = 64;
    ctx.font = font;
    ctx.fillStyle = speaking ? 'rgba(22,163,74,0.92)' : 'rgba(15,23,42,0.78)';
    ctx.beginPath(); ctx.roundRect(0, 0, w, 64, 32); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, 34);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return { texture: t, aspect: w / 64 };
  }, [name, speaking]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <sprite position={[0, 2.5, 0]} scale={[0.5 * aspect, 0.5, 1]} raycast={() => null}>
      <spriteMaterial map={texture} depthWrite={false} transparent />
    </sprite>
  );
}

function lerpAngle(a: number, b: number, t: number) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
