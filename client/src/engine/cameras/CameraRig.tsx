import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitImpl } from 'three-stdlib';
import { INTERIOR_DEPTH } from '@civitas/shared';
import { localPlayer } from '../core/transient';
import { playerNow, stepLocalPlayer } from '../core/interactions';
import { useWorld, type CameraMode } from '../../stores/world';

const PRESETS: Record<CameraMode, { dist: number; polar: number; minPolar: number; maxPolar: number; follow: boolean; pan: boolean }> = {
  third: { dist: 10, polar: 1.18, minPolar: 0.3, maxPolar: 1.45, follow: true, pan: false },
  top: { dist: 58, polar: 0.15, minPolar: 0, maxPolar: 0.6, follow: true, pan: false },
  free: { dist: 50, polar: 0.9, minPolar: 0.05, maxPolar: 1.5, follow: false, pan: true },
  overview: { dist: 0, polar: 0.75, minPolar: 0.2, maxPolar: 1.2, follow: false, pan: true },
};
// Battle in Follow view: closer and lower, so the screen centre (crosshair) points where you shoot.
const BATTLE_THIRD = { ...PRESETS.third, dist: 6.5, polar: 1.42, minPolar: 0.95, maxPolar: 1.62 };

/** One OrbitControls instance (mouse, touch drag, pinch, wheel) configured per camera mode. Also drives the local player. */
export function CameraRig({ mode, worldSize, far }: { mode: CameraMode; worldSize: number; far: number }) {
  const controls = useRef<OrbitImpl>(null);
  const { camera } = useThree();
  const last = useRef(new THREE.Vector3(localPlayer.x, 0, localPlayer.z));
  const transition = useRef(0);
  const desired = useRef(new THREE.Vector3());
  const inBattle = useWorld((s) => s.inBattle);

  useEffect(() => {
    camera.far = far;
    camera.updateProjectionMatrix();
  }, [camera, far]);

  // Mode change: compute a target camera position and glide there.
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const p = mode === 'third' && inBattle ? BATTLE_THIRD : PRESETS[mode];
    const target = p.follow ? new THREE.Vector3(localPlayer.x, (localPlayer.inside ? INTERIOR_DEPTH : 0) + 1.5, localPlayer.z) : mode === 'overview' ? new THREE.Vector3(0, 0, 0) : c.target.clone();
    const dist = mode === 'overview' ? worldSize * 0.95 : localPlayer.inside ? 8 : p.dist;
    const az = c.getAzimuthalAngle();
    c.target.copy(target);
    desired.current.setFromSphericalCoords(dist, p.polar, az).add(target);
    transition.current = 1;
    c.minPolarAngle = p.minPolar;
    c.maxPolarAngle = p.maxPolar;
    c.enablePan = p.pan;
    c.minDistance = mode === 'third' ? (inBattle ? 3.5 : 5) : 8;
    c.maxDistance = Math.max(60, worldSize * 1.4);
    last.current.set(localPlayer.x, localPlayer.inside ? INTERIOR_DEPTH : 0, localPlayer.z);
  }, [mode, worldSize, inBattle]);

  // Chase camera (GTA-style): while you walk in Follow mode the camera swings round behind the character.
  // Dragging the camera takes over; the chase resumes shortly after you let go.
  const drag = useRef({ active: false, endedAt: 0 });
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const start = () => { drag.current.active = true; };
    const end = () => { drag.current.active = false; drag.current.endedAt = performance.now(); };
    c.addEventListener('start', start);
    c.addEventListener('end', end);
    return () => { c.removeEventListener('start', start); c.removeEventListener('end', end); };
  }, []);

  useFrame((_, rawDt) => {
    const c = controls.current;
    if (!c) return;
    const dt = Math.min(rawDt, 0.1);
    stepLocalPlayer(dt, c.getAzimuthalAngle(), worldSize);
    if (mode === 'third' && localPlayer.a === 'walk' && !drag.current.active && performance.now() - drag.current.endedAt > 700) {
      const cur = c.getAzimuthalAngle();
      const behind = localPlayer.r + Math.PI;
      const delta = Math.atan2(Math.sin(behind - cur), Math.cos(behind - cur));
      // Walking toward the camera (S) must not swing it round, or the character would circle forever.
      if (Math.abs(delta) > 0.01 && Math.abs(delta) < 2.2) c.setAzimuthalAngle(cur + delta * (1 - Math.exp(-dt * 2.4)));
    }
    // Follow the floor the player stands on (street or a building interior), not the jump arc.
    const floor = localPlayer.inside ? INTERIOR_DEPTH : 0;
    if (PRESETS[mode].follow) {
      // Move camera and target together by the player's delta: keeps the user's chosen orbit angle.
      const dx = localPlayer.x - last.current.x, dy = floor - last.current.y, dz = localPlayer.z - last.current.z;
      c.target.x += dx; c.target.y += dy; c.target.z += dz;
      camera.position.x += dx; camera.position.y += dy; camera.position.z += dz;
      desired.current.x += dx; desired.current.y += dy; desired.current.z += dz;
    }
    // Indoors: keep the camera close so the room fills the view.
    c.maxDistance = localPlayer.inside ? 11 : Math.max(60, worldSize * 1.4);
    last.current.set(localPlayer.x, floor, localPlayer.z);
    // Short shake when a vehicle hits you.
    const since = playerNow() - localPlayer.hitAt;
    if (localPlayer.hitAt && since < 350) {
      const amp = 0.35 * (1 - since / 350);
      camera.position.x += (Math.random() - 0.5) * amp;
      camera.position.y += (Math.random() - 0.5) * amp;
    }
    if (transition.current > 0) {
      camera.position.lerp(desired.current, 1 - Math.exp(-dt * 6));
      transition.current = camera.position.distanceTo(desired.current) < 0.5 ? 0 : 1;
    }
    c.update();
  });

  return <OrbitControls ref={controls as any} makeDefault enableDamping dampingFactor={0.12} screenSpacePanning={false} />;
}
