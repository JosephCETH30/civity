import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useAnimations, useGLTF } from '@react-three/drei';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AnimState } from '@civitas/shared';
import { localPlayer, remoteRendered, remoteTargets } from '../core/transient';

// Original stylised figure (not a licensed character). ~600 triangles, 7 draw calls full / 2 lite.
const torsoGeo = new THREE.CapsuleGeometry(0.3, 0.45, 4, 10);
const headGeo = new THREE.SphereGeometry(0.24, 14, 10);
const hairGeo = new THREE.SphereGeometry(0.255, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
const legGeo = new THREE.CapsuleGeometry(0.11, 0.55, 3, 8).translate(0, -0.38, 0); // pivot at hip
const armGeo = new THREE.CapsuleGeometry(0.08, 0.48, 3, 8).translate(0, -0.32, 0); // pivot at shoulder
const ring = new THREE.RingGeometry(0.6, 0.78, 24).rotateX(-Math.PI / 2);
const skin = new THREE.MeshLambertMaterial({ color: '#d9a982' });
const hair = new THREE.MeshLambertMaterial({ color: '#2b2118' });
const trousers = new THREE.MeshLambertMaterial({ color: '#2f3640' });
const speakMat = new THREE.MeshBasicMaterial({ color: '#16a34a', transparent: true, opacity: 0.9 });
const _v = new THREE.Vector3();
const bodyMats = new Map<string, THREE.Material>();
const bodyMat = (c: string) => {
  let m = bodyMats.get(c);
  if (!m) bodyMats.set(c, (m = new THREE.MeshLambertMaterial({ color: c })));
  return m;
};

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
  speaking: boolean;
  showLabel: boolean;
  lite: boolean;
}

/** Remote avatars interpolate toward the last server pose; the local one reads the controller directly. */
export function Avatar({ sessionId, name, color, speaking, showLabel, lite }: Props) {
  const g = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Mesh>(null);
  const legR = useRef<THREE.Mesh>(null);
  const armL = useRef<THREE.Mesh>(null);
  const armR = useRef<THREE.Mesh>(null);
  const torso = useRef<THREE.Group>(null);
  const animRef = useRef<AnimState>('idle');
  const pose = useRef<THREE.Group>(null);
  const phase = useRef(Math.random() * 10);
  const mat = useMemo(() => bodyMat(color), [color]);
  const custom = useCustomModel() && !lite;

  useFrame((_, dt) => {
    const grp = g.current;
    if (!grp) return;
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
    const walking = anim === 'walk';
    animRef.current = anim;
    phase.current += dt * (walking ? 8 : anim === 'wave' ? 10 : 1.6);
    const swing = walking ? Math.sin(phase.current) * 0.55 : 0;
    // Pose per state. Legs/arms pivot at hip/shoulder; the body drops 0.45 m when seated.
    let legX = swing, armLX = -swing * 0.8, armRX = swing * 0.8, armRZ = 0, bodyY = 0;
    if (anim === 'sit') { legX = -1.45; armLX = armRX = -0.35; bodyY = -0.42; }
    else if (anim === 'jump') { legX = 0.45; armLX = armRX = -2.4; }
    else if (anim === 'wave') { armRZ = 2.5 + Math.sin(phase.current) * 0.35; }
    if (legL.current) legL.current.rotation.x = anim === 'sit' ? legX : anim === 'jump' ? -legX : legX;
    if (legR.current) legR.current.rotation.x = anim === 'sit' || anim === 'jump' ? legX : -legX;
    if (legL.current) legL.current.position.y = 0.85 + bodyY;
    if (legR.current) legR.current.position.y = 0.85 + bodyY;
    if (armL.current) { armL.current.rotation.x = armLX; armL.current.position.y = 1.55 + bodyY; }
    if (armR.current) { armR.current.rotation.x = armRX; armR.current.rotation.z = armRZ; armR.current.position.y = 1.55 + bodyY; }
    if (torso.current) torso.current.position.y = bodyY + (walking ? Math.abs(Math.sin(phase.current)) * 0.05 : anim === 'idle' ? Math.sin(phase.current) * 0.012 : 0);
    // Knocked down: tip over backwards onto the ground, then get back up.
    if (pose.current) {
      const k = 1 - Math.exp(-dt * 12);
      const down = anim === 'fall';
      pose.current.rotation.x += ((down ? -1.45 : 0) - pose.current.rotation.x) * k;
      pose.current.position.y += ((down ? 0.3 : 0) - pose.current.position.y) * k;
    }
  });

  const procedural = (
    <>
      <group ref={torso}>
        <mesh geometry={torsoGeo} material={mat} position={[0, 1.27, 0]} castShadow={!lite} />
        <mesh geometry={headGeo} material={skin} position={[0, 1.86, 0]} castShadow={!lite} />
        {!lite && <mesh geometry={hairGeo} material={hair} position={[0, 1.88, -0.03]} rotation-x={-0.25} />}
      </group>
      {!lite && (
        <>
          <mesh ref={armL} geometry={armGeo} material={mat} position={[-0.38, 1.55, 0]} />
          <mesh ref={armR} geometry={armGeo} material={mat} position={[0.38, 1.55, 0]} />
          <mesh ref={legL} geometry={legGeo} material={trousers} position={[-0.13, 0.85, 0]} />
          <mesh ref={legR} geometry={legGeo} material={trousers} position={[0.13, 0.85, 0]} />
        </>
      )}
    </>
  );

  return (
    <group ref={g}>
      <group ref={pose}>{custom ? <Suspense fallback={procedural}><CustomBody anim={animRef} /></Suspense> : procedural}</group>
      {speaking && <mesh geometry={ring} material={speakMat} position={[0, 0.04, 0]} />}
      {showLabel && <NameLabel name={name} speaking={speaking} />}
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
