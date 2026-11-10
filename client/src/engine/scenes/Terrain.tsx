// Surroundings: paved city ground, beach, animated sea, a pier with boats rocking on the swell. Decorative only
// (not editable), built from a handful of draw calls so it costs almost nothing on phones.
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { makeWaterMaterial } from '../materials/materials';

const BEACH = 14; // metres of sand between the city edge and the water

interface Props {
  worldSize: number;
  shadows: boolean;
  onGroundMove: (e: ThreeEvent<PointerEvent>) => void;
  onGroundOut: () => void;
  onGroundClick: (e: ThreeEvent<MouseEvent>) => void;
}

export function Terrain({ worldSize: W, shadows, onGroundMove, onGroundOut, onGroundClick }: Props) {
  const land = W + 8;
  const shore = W + 2 * BEACH;
  const water = useMemo(() => makeWaterMaterial(shore / 2), [shore]);
  useLayoutEffect(() => () => water.dispose(), [water]);

  return (
    <>
      {/* paved city ground; receives pointer events for placement */}
      <mesh position={[0, -0.1, 0]} receiveShadow={shadows} onPointerMove={onGroundMove} onPointerOut={onGroundOut} onClick={onGroundClick}>
        <boxGeometry args={[land, 0.2, land]} />
        <meshLambertMaterial color="#d9cdb6" />
      </mesh>
      {/* beach */}
      <mesh position={[0, -0.35, 0]} receiveShadow={shadows}>
        <boxGeometry args={[shore, 0.6, shore]} />
        <meshLambertMaterial color="#eadbb8" />
      </mesh>
      {/* sea */}
      <mesh position={[0, -0.5, 0]} rotation-x={-Math.PI / 2} material={water}>
        <planeGeometry args={[shore * 8, shore * 8]} />
      </mesh>
      <Harbour shoreHalf={shore / 2} shadows={shadows} />
    </>
  );
}

const hullGeo = new THREE.CylinderGeometry(0.5, 0.42, 1, 8, 1).rotateX(Math.PI / 2).scale(1, 1, 1);
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const hullMat = new THREE.MeshLambertMaterial({ color: '#f4f2ee' });
const cabinMat = new THREE.MeshLambertMaterial({ color: '#2a3a45' });

/** A pier off the south shore with boats tied up on both sides. */
function Harbour({ shoreHalf, shadows }: { shoreHalf: number; shadows: boolean }) {
  const hulls = useRef<THREE.InstancedMesh>(null);
  const cabins = useRef<THREE.InstancedMesh>(null);
  const pierLen = 34;
  const px = shoreHalf * 0.35, pz = shoreHalf + pierLen / 2 - 1;
  const boats = useMemo(() => {
    const list: { x: number; z: number; len: number; rot: number }[] = [];
    for (let i = 0; i < 4; i++) {
      list.push({ x: px - 6.5, z: shoreHalf + 6 + i * 7.5, len: 9 + (i % 2) * 3, rot: 0 });
      list.push({ x: px + 6.5, z: shoreHalf + 8 + i * 7.5, len: 8 + ((i + 1) % 2) * 4, rot: 0 });
    }
    list.push({ x: px + 30, z: shoreHalf + 40, len: 22, rot: 0.6 }); // a larger yacht at anchor
    return list;
  }, [px, shoreHalf]);

  // Boats rock gently on the swell (wall clock: decoration, not simulation state).
  const o = useMemo(() => new THREE.Object3D(), []);
  const place = (t: number) => {
    boats.forEach((b, i) => {
      const bob = Math.sin(t * 1.3 + i * 1.7) * 0.12, roll = Math.sin(t * 0.9 + i) * 0.04;
      o.position.set(b.x, -0.15 + bob, b.z);
      o.rotation.set(0, b.rot, roll);
      o.scale.set(b.len * 0.32, 1.4, b.len);
      o.updateMatrix();
      hulls.current!.setMatrixAt(i, o.matrix);
      o.position.set(b.x, 0.95 + bob, b.z - b.len * 0.08);
      o.scale.set(b.len * 0.2, 0.9, b.len * 0.38);
      o.updateMatrix();
      cabins.current!.setMatrixAt(i, o.matrix);
    });
    hulls.current!.instanceMatrix.needsUpdate = true;
    cabins.current!.instanceMatrix.needsUpdate = true;
  };
  useLayoutEffect(() => {
    place(0);
    hulls.current!.computeBoundingSphere();
    cabins.current!.computeBoundingSphere();
  }, [boats]);
  useFrame(({ clock }) => place(clock.elapsedTime));

  return (
    <>
      <mesh position={[px, -0.05, pz]} receiveShadow={shadows} castShadow={shadows}>
        <boxGeometry args={[4, 0.5, pierLen]} />
        <meshLambertMaterial color="#cdbfa6" />
      </mesh>
      <instancedMesh ref={hulls} args={[hullGeo, hullMat, boats.length]} castShadow={shadows} />
      <instancedMesh ref={cabins} args={[boxGeo, cabinMat, boats.length]} />
    </>
  );
}
