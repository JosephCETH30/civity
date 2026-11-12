import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import type { CityObject, ObjectType } from '@civitas/shared';
import { GEOMETRIES, objectMatrix, partMatrix, partsFor, roadJoins, tintFor, type Part, type RoadJoin } from './parts';
import { lamp, MATERIALS } from '../materials/materials';

export { ghostMaterial } from '../materials/materials';

type MatSet = (typeof MATERIALS)['lambert'];
const pick = (set: MatSet, part: Part): THREE.Material => (part.mat === 'lamp' ? lamp : set[part.mat ?? 'base']);

interface Props {
  objects: CityObject[];
  standardMaterial: boolean;
  shadows: boolean;
  viewDistance: number;
  /** World units per culling chunk. Bigger chunks = fewer draw calls, less culling. */
  chunk: number;
  onPick: (id: string, e: ThreeEvent<MouseEvent>) => void;
}

/** All city objects drawn as instanced meshes grouped by (type, spatial chunk) for frustum and distance culling. */
export function CityObjects({ objects, standardMaterial, shadows, viewDistance, chunk, onPick }: Props) {
  // Road tiles that touch another road sideways (junctions, turns, corners) lose their kerb on that side.
  const joins = useMemo(() => roadJoins(objects), [objects]);
  const groups = useMemo(() => {
    const map = new Map<string, { type: ObjectType; cx: number; cz: number; list: CityObject[] }>();
    for (const o of objects) {
      const single = chunk >= 1000; // one chunk for the whole world (low profile)
      const cx = single ? 0 : Math.floor(o.position.x / chunk), cz = single ? 0 : Math.floor(o.position.z / chunk);
      const key = `${o.type}|${cx}|${cz}`;
      let g = map.get(key);
      if (!g) map.set(key, (g = { type: o.type, cx, cz, list: [] }));
      g.list.push(o);
    }
    return [...map.entries()];
  }, [objects, chunk]);
  const set = standardMaterial ? MATERIALS.standard : MATERIALS.lambert;

  return (
    <>
      {groups.map(([key, g]) => (
        <TypeChunk key={key} {...g} chunk={chunk} set={set} shadows={shadows} viewDistance={viewDistance} onPick={onPick} joins={joins} />
      ))}
    </>
  );
}

const TypeChunk = memo(function TypeChunk({
  type, cx, cz, chunk, list, set, shadows, viewDistance, onPick, joins,
}: { joins: Map<string, RoadJoin>; type: ObjectType; cx: number; cz: number; chunk: number; list: CityObject[]; set: MatSet; shadows: boolean; viewDistance: number; onPick: Props['onPick'] }) {
  const group = useRef<THREE.Group>(null);
  const center = useMemo(() => (chunk >= 1000 ? new THREE.Vector3() : new THREE.Vector3((cx + 0.5) * chunk, 0, (cz + 0.5) * chunk)), [cx, cz, chunk]);
  const partCount = partsFor({ type, props: {} }).length;
  // Distance culling: hide the whole chunk beyond the profile's view distance.
  useFrame(({ camera }) => {
    if (!group.current) return;
    const d = Math.hypot(camera.position.x - center.x, camera.position.z - center.z) - chunk * 0.71;
    group.current.visible = d < viewDistance;
  });
  return (
    <group ref={group}>
      {Array.from({ length: partCount }, (_, i) => (
        <PartLayer key={`${i}-${list.length}`} list={list} index={i} set={set} shadows={shadows} onPick={onPick} joins={joins} />
      ))}
    </group>
  );
});

function PartLayer({ list, index, set, shadows, onPick, joins }: { list: CityObject[]; index: number; set: MatSet; shadows: boolean; onPick: Props['onPick']; joins: Map<string, RoadJoin> }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const sample = partsFor(list[0])[index];
  useLayoutEffect(() => {
    const mesh = ref.current!;
    const objM = new THREE.Matrix4(), m = new THREE.Matrix4(), col = new THREE.Color();
    list.forEach((o, i) => {
      const part = partsFor(o, joins.get(o.id))[index];
      partMatrix(objectMatrix(o, objM), part, m);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, col.set(part.color).multiplyScalar(part.mat === 'lamp' ? 1 : tintFor(o.id)));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.computeBoundingBox();
  }, [list, index, joins]);
  return (
    <instancedMesh
      ref={ref}
      args={[GEOMETRIES[sample.geo], pick(set, sample), list.length]}
      castShadow={shadows && !!sample.castShadow}
      receiveShadow={shadows}
      onClick={(e) => {
        if (e.instanceId === undefined || e.delta > 6) return;
        e.stopPropagation();
        onPick(list[e.instanceId].id, e);
      }}
    />
  );
}

/** Non-instanced render of one object (selected object under the gizmo, placement ghost). */
export function SingleObject({ object, material, standard }: { object: Pick<CityObject, 'type' | 'props'>; material?: THREE.Material; standard: boolean }) {
  const parts = useMemo(() => partsFor(object), [object]);
  const set = standard ? MATERIALS.standard : MATERIALS.lambert;
  return (
    <>
      {parts.map((p, i) => (
        <mesh key={i} geometry={GEOMETRIES[p.geo]} position={p.pos} rotation={p.rot ? new THREE.Euler(p.rot[0], p.rot[1], p.rot[2], 'YXZ') : undefined} scale={p.size}
          material={material ?? (p.mat === 'lamp' ? lamp : undefined)} castShadow={!!p.castShadow}>
          {!material && p.mat !== 'lamp' && <PartMaterial base={set[p.mat ?? 'base']} color={p.color} />}
        </mesh>
      ))}
    </>
  );
}

function PartMaterial({ base, color }: { base: THREE.Material; color: string }) {
  const m = useMemo(() => {
    const c = (base as THREE.MeshLambertMaterial).clone();
    c.onBeforeCompile = base.onBeforeCompile; // keep facade windows on the selected object
    c.customProgramCacheKey = base.customProgramCacheKey;
    c.color.set(color);
    return c;
  }, [base, color]);
  useLayoutEffect(() => () => m.dispose(), [m]);
  return <primitive object={m} attach="material" />;
}
