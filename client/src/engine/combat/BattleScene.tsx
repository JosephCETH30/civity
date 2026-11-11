// In-scene part of the PvP battle: links the camera for aiming, fires on click (not drag) or F, and draws tracers.
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useWorld } from '../../stores/world';
import { shots } from '../core/transient';
import { fire, setShootCamera } from './shoot';

const MAX = 40;
const LIFE_MS = 160;

export function BattleScene() {
  const { camera, gl } = useThree();
  const inBattle = useWorld((s) => s.inBattle);

  useEffect(() => { setShootCamera(camera); return () => setShootCamera(null); }, [camera]);

  useEffect(() => {
    if (!inBattle) return;
    const el = gl.domElement;
    let down: { x: number; y: number; t: number } | null = null;
    const onDown = (e: PointerEvent) => { if (e.button === 0) down = { x: e.clientX, y: e.clientY, t: performance.now() }; };
    const onUp = (e: PointerEvent) => {
      // A short click fires; a drag rotates the camera as usual.
      if (down && e.pointerType === 'mouse' && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6 && performance.now() - down.t < 350) fire();
      down = null;
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.code === 'KeyF') fire();
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    addEventListener('keydown', onKey);
    return () => { el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointerup', onUp); removeEventListener('keydown', onKey); };
  }, [inBattle, gl]);

  return <Tracers />;
}

/** Shots as short-lived glowing beams (one instanced mesh, no allocations per frame). */
function Tracers() {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.9, toneMapped: false }), []);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(), s: new THREE.Vector3(), d: new THREE.Vector3(), z: new THREE.Vector3(0, 0, 1) }), []);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);

  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const now = performance.now();
    while (shots.length && now - shots[0].at > LIFE_MS) shots.shift();
    let n = 0;
    for (const s of shots) {
      if (n >= MAX) break;
      tmp.d.set(s.e[0] - s.o[0], s.e[1] - s.o[1], s.e[2] - s.o[2]);
      const len = tmp.d.length();
      if (len < 0.01) continue;
      tmp.d.divideScalar(len);
      tmp.q.setFromUnitVectors(tmp.z, tmp.d);
      tmp.p.set((s.o[0] + s.e[0]) / 2, (s.o[1] + s.e[1]) / 2, (s.o[2] + s.e[2]) / 2);
      const k = 1 - (now - s.at) / LIFE_MS; // thin out as it fades
      const w = (s.hit ? 0.09 : 0.06) * Math.max(0.3, k);
      tmp.s.set(w, w, len);
      m.setMatrixAt(n++, tmp.m.compose(tmp.p, tmp.q, tmp.s));
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
  });

  return <instancedMesh ref={mesh} args={[geo, mat, MAX]} frustumCulled={false} raycast={() => null} />;
}
