// In-scene part of the PvP battle: links the camera for aiming, handles firing input, and draws tracers, muzzle
// flashes, impact sparks, elimination bursts and (in first person) the blaster in your hands.
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { BATTLE } from '@civitas/shared';
import { useWorld } from '../../stores/world';
import { bursts, fxShotAt, shots } from '../core/transient';
import { fire, setShootCamera } from './shoot';

const MAX_TRACERS = 40;
const TRACER_MS = 200;
const SPARKS = { flash: 1, wall: 8, hit: 10, kill: 28 } as const;
const BURST_MS = { flash: 70, wall: 320, hit: 380, kill: 900 } as const;
const MAX_PARTICLES = 600;

export function BattleScene() {
  const { camera, gl } = useThree();
  const inBattle = useWorld((s) => s.inBattle);
  const firstPerson = useWorld((s) => s.cameraMode === 'first');

  useEffect(() => { setShootCamera(camera); return () => setShootCamera(null); }, [camera]);

  useEffect(() => {
    if (!inBattle) return;
    const el = gl.domElement;
    let down: { x: number; y: number; t: number } | null = null;
    let auto: ReturnType<typeof setInterval> | undefined;
    const stopAuto = () => { clearInterval(auto); auto = undefined; };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      // Mouse locked in first person: fire now and keep firing while the button is held.
      if (document.pointerLockElement === el) {
        fire();
        stopAuto();
        auto = setInterval(fire, BATTLE.cooldownMs + 10);
        return;
      }
      down = { x: e.clientX, y: e.clientY, t: performance.now() };
    };
    const onUp = (e: PointerEvent) => {
      stopAuto();
      // Otherwise a short click fires; a drag rotates the camera as usual.
      if (down && e.pointerType === 'mouse' && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6 && performance.now() - down.t < 350) fire();
      down = null;
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.code === 'KeyF') fire();
    };
    el.addEventListener('pointerdown', onDown);
    addEventListener('pointerup', onUp);
    addEventListener('blur', stopAuto);
    addEventListener('keydown', onKey);
    return () => {
      stopAuto();
      el.removeEventListener('pointerdown', onDown);
      removeEventListener('pointerup', onUp);
      removeEventListener('blur', stopAuto);
      removeEventListener('keydown', onKey);
    };
  }, [inBattle, gl]);

  return (
    <>
      <Tracers />
      <Particles />
      {inBattle && firstPerson && <ViewModel />}
    </>
  );
}

/** Shots as short-lived glowing beams (one instanced mesh, no allocations per frame). */
// Where the blaster's muzzle is relative to the camera in first person (matches ViewModel).
const MUZZLE = new THREE.Vector3(0.15, -0.13, -1.08);
const GUN_POS = new THREE.Vector3(0.15, -0.15, -0.86);

function Tracers() {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const { camera } = useThree();
  const muzzle = useMemo(() => new THREE.Vector3(), []);
  const geo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffe066', transparent: true, opacity: 0.95, toneMapped: false, depthWrite: false }), []);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(), s: new THREE.Vector3(), d: new THREE.Vector3(), z: new THREE.Vector3(0, 0, 1) }), []);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);

  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const now = performance.now();
    while (shots.length && now - shots[0].at > TRACER_MS) shots.shift();
    const fp = useWorld.getState().cameraMode === 'first';
    if (fp) muzzle.copy(MUZZLE).applyQuaternion(camera.quaternion).add(camera.position);
    let n = 0;
    for (const s of shots) {
      if (n >= MAX_TRACERS) break;
      const o = s.mine && fp ? [muzzle.x, muzzle.y, muzzle.z] : s.o;
      tmp.d.set(s.e[0] - o[0], s.e[1] - o[1], s.e[2] - o[2]);
      const full = tmp.d.length();
      if (full < 0.01) continue;
      tmp.d.divideScalar(full);
      // A bolt that travels: its tail chases its head along the line.
      const k = (now - s.at) / TRACER_MS;
      const head = Math.min(1, k * 3) * full, tail = Math.max(0, k * 2 - 0.6) * full;
      const len = Math.max(0.05, head - tail);
      tmp.q.setFromUnitVectors(tmp.z, tmp.d);
      const mid = tail + len / 2;
      tmp.p.set(o[0] + tmp.d.x * mid, o[1] + tmp.d.y * mid, o[2] + tmp.d.z * mid);
      const w = s.mine && fp ? 0.025 : s.hit ? 0.1 : 0.07;
      tmp.s.set(w, w, len);
      m.setMatrixAt(n++, tmp.m.compose(tmp.p, tmp.q, tmp.s));
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
  });

  return <instancedMesh ref={mesh} args={[geo, mat, MAX_TRACERS]} frustumCulled={false} raycast={() => null} />;
}

const AXIS = new THREE.Vector3(1, 1, 0).normalize();
const rand = (seed: number) => { const x = Math.sin(seed * 12.9898) * 43758.5453; return x - Math.floor(x); };
const COLORS = { flash: new THREE.Color('#fff2a8'), wall: new THREE.Color('#ffc14d'), hit: new THREE.Color('#e23b3b'), kill: new THREE.Color('#ff5a3c') };

/** Muzzle flashes, sparks and elimination bursts: tiny cubes flying out from a point, with gravity. */
function Particles() {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, depthWrite: false }), []);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(), s: new THREE.Vector3(), c: new THREE.Color() }), []);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);

  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const now = performance.now();
    while (bursts.length && now - bursts[0].at > BURST_MS.kill) bursts.shift();
    let n = 0;
    for (const b of bursts) {
      const life = BURST_MS[b.kind];
      const k = (now - b.at) / life;
      if (k >= 1 || (b.mine && b.kind === 'flash' && useWorld.getState().cameraMode === 'first')) continue;
      const t = (now - b.at) / 1000;
      for (let i = 0; i < SPARKS[b.kind] && n < MAX_PARTICLES; i++) {
        if (b.kind === 'flash') {
          tmp.p.set(b.x, b.y, b.z);
          tmp.s.setScalar(0.35 * (1 - k) + 0.05);
        } else {
          const r1 = rand(b.seed + i * 3.1), r2 = rand(b.seed + i * 7.7), r3 = rand(b.seed + i * 1.3);
          const speed = b.kind === 'kill' ? 3 + r3 * 4 : 2 + r3 * 3;
          const a = r1 * Math.PI * 2, up = b.kind === 'kill' ? 0.3 + r2 * 0.9 : r2 * 0.8 - 0.1;
          tmp.p.set(b.x + Math.cos(a) * speed * t, Math.max(0.02, b.y + up * speed * t - 4.9 * t * t), b.z + Math.sin(a) * speed * t);
          tmp.s.setScalar((b.kind === 'kill' ? 0.16 : 0.07) * (1 - k * 0.8));
        }
        tmp.q.setFromAxisAngle(AXIS, t * 9 + i);
        m.setMatrixAt(n, tmp.m.compose(tmp.p, tmp.q, tmp.s));
        m.setColorAt(n, b.kind === 'kill' && i % 3 === 0 ? tmp.c.set('#ffffff') : COLORS[b.kind]);
        n++;
      }
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });

  return <instancedMesh ref={mesh} args={[geo, mat, MAX_PARTICLES]} frustumCulled={false} raycast={() => null} />;
}

/** First person: the blaster held at the bottom right of the view, with recoil and a muzzle flash. */
function ViewModel() {
  const root = useRef<THREE.Group>(null);
  const gun = useRef<THREE.Group>(null);
  const flash = useRef<THREE.Mesh>(null);
  const { camera } = useThree();
  const mats = useMemo(() => ({
    body: new THREE.MeshBasicMaterial({ color: '#2a2e35', depthTest: false }),
    trim: new THREE.MeshBasicMaterial({ color: '#4a515c', depthTest: false }),
    glow: new THREE.MeshBasicMaterial({ color: '#ffd23f', depthTest: false, toneMapped: false }),
    flash: new THREE.MeshBasicMaterial({ color: '#fff3b0', depthTest: false, toneMapped: false, transparent: true }),
  }), []);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  useFrame(() => {
    const r = root.current, g = gun.current;
    if (!r || !g) return;
    r.position.copy(camera.position);
    r.quaternion.copy(camera.quaternion);
    const since = performance.now() - (fxShotAt.get('local') ?? -1e9);
    const kick = since < 120 ? 1 - since / 120 : 0;
    g.position.set(GUN_POS.x, GUN_POS.y + kick * 0.02, GUN_POS.z + kick * 0.07);
    g.rotation.x = kick * 0.18;
    // idle sway
    g.position.x += Math.sin(performance.now() / 600) * 0.004;
    if (flash.current) {
      flash.current.visible = since < 60;
      flash.current.scale.setScalar(0.35 + Math.random() * 0.35);
    }
  });

  return (
    <group ref={root} renderOrder={999}>
      <group ref={gun}>
        <mesh material={mats.body} renderOrder={999}><boxGeometry args={[0.07, 0.08, 0.36]} /></mesh>
        <mesh material={mats.trim} position={[0, -0.07, 0.08]} rotation-x={0.25} renderOrder={999}><boxGeometry args={[0.05, 0.11, 0.06]} /></mesh>
        <mesh material={mats.trim} position={[0, 0.055, -0.03]} renderOrder={999}><boxGeometry args={[0.035, 0.03, 0.16]} /></mesh>
        <mesh material={mats.glow} position={[0, 0.005, -0.19]} renderOrder={999}><boxGeometry args={[0.08, 0.035, 0.03]} /></mesh>
        <mesh ref={flash} material={mats.flash} position={[0, 0.005, -0.24]} renderOrder={1000} visible={false}><octahedronGeometry args={[0.05]} /></mesh>
      </group>
    </group>
  );
}
