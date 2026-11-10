// Interior of the building the local player is in. Rendered below the street (INTERIOR_DEPTH) so nobody outside
// can see it. Walls are single-sided planes facing inward, so the orbit camera looks in like a dollhouse.
import { useMemo } from 'react';
import * as THREE from 'three';
import { INTERIOR_DEPTH, type CityObject } from '@civitas/shared';
import { GEOMETRIES } from './parts';
import { interiorFor } from './interiors';
import { lamp } from '../materials/materials';

const mats = new Map<string, THREE.Material>();
const mat = (c: string, side: THREE.Side = THREE.FrontSide) => {
  const k = c + side;
  let m = mats.get(k);
  if (!m) mats.set(k, (m = new THREE.MeshLambertMaterial({ color: c, side })));
  return m;
};
const plane = new THREE.PlaneGeometry(1, 1);

export function Interior({ building }: { building: CityObject }) {
  const layout = useMemo(() => interiorFor(building), [building]);
  const { hw, hd, height: h } = layout;
  const W = hw * 2, D = hd * 2;
  return (
    <group position={[building.position.x, INTERIOR_DEPTH, building.position.z]} rotation-y={building.rotationY}>
      {/* floor and ceiling */}
      <mesh geometry={plane} material={mat(layout.floor)} rotation-x={-Math.PI / 2} scale={[W, D, 1]} receiveShadow />
      <mesh geometry={plane} material={mat('#f4f1ea')} position-y={h} rotation-x={Math.PI / 2} scale={[W, D, 1]} />
      {/* walls, normals pointing into the room */}
      <mesh geometry={plane} material={mat(layout.wall)} position={[0, h / 2, -hd]} scale={[W, h, 1]} />
      <mesh geometry={plane} material={mat(layout.wall)} position={[0, h / 2, hd]} rotation-y={Math.PI} scale={[W, h, 1]} />
      <mesh geometry={plane} material={mat(layout.wall)} position={[-hw, h / 2, 0]} rotation-y={Math.PI / 2} scale={[D, h, 1]} />
      <mesh geometry={plane} material={mat(layout.wall)} position={[hw, h / 2, 0]} rotation-y={-Math.PI / 2} scale={[D, h, 1]} />
      {/* skirting, door (front wall) and windows (side walls) */}
      <mesh geometry={GEOMETRIES.box} material={mat('#d9d1c3')} position={[0, 0.06, -hd + 0.02]} scale={[W, 0.12, 0.04]} />
      <mesh geometry={plane} material={mat('#4a3426')} position={[0, 1.15, hd - 0.02]} rotation-y={Math.PI} scale={[1.5, 2.3, 1]} />
      <mesh geometry={plane} material={mat('#e9d9a6')} position={[0, 2.45, hd - 0.03]} rotation-y={Math.PI} scale={[0.3, 0.12, 1]} />
      {[-1, 1].map((side) => (
        <mesh key={side} geometry={plane} material={mat('#9ec9d8')} position={[side * (hw - 0.02), 1.6, 0]} rotation-y={(-side * Math.PI) / 2} scale={[Math.min(D * 0.5, 2.6), 1.2, 1]} />
      ))}
      {/* ceiling lights (glow at night like street lamps) */}
      {[-1, 1].map((side) => (
        // downward-facing planes: visible from inside, invisible to the dollhouse camera above
        <mesh key={side} geometry={plane} material={lamp} position={[side * hw * 0.45, h - 0.02, 0]} rotation-x={Math.PI / 2} scale={[0.9, 0.9, 1]} />
      ))}
      {layout.parts.map((p, i) => (
        <mesh key={i} geometry={GEOMETRIES[p.geo]} material={mat(p.color)} position={p.pos} scale={p.size} castShadow={false} />
      ))}
    </group>
  );
}
