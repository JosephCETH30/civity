// Scene cameras drawn the way Blender shows them: a pyramid of lines from the lens to the image plane (its field
// of view at 16:9), with a small triangle marking "up". The camera you are looking through is hidden.
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { CityObject } from '@civitas/shared';
import { useWorld } from '../../stores/world';
import { objectMatrix } from './parts';

export const CAMERA_ASPECT = 16 / 9;
const DEPTH = 2.5; // how far in front of the lens the outline's image plane is drawn
const lineMat = new THREE.LineBasicMaterial({ color: '#1d1d1f' });

function frustumGeometry(fovDeg: number) {
  const h = Math.tan((fovDeg * Math.PI) / 360) * DEPTH, w = h * CAMERA_ASPECT;
  const a: [number, number, number] = [0, 0, 0.55]; // lens tip
  const z = 0.55 + DEPTH;
  const c = [[-w, -h], [w, -h], [w, h], [-w, h]].map(([x, y]) => [x, y, z] as [number, number, number]);
  const up: [number, number, number][] = [[-w * 0.4, h * 1.1, z], [0, h * 1.6, z], [w * 0.4, h * 1.1, z]];
  const segs = [
    ...c.flatMap((p) => [a, p]), // lens to each corner
    ...c.flatMap((p, i) => [p, c[(i + 1) % 4]]), // image plane
    up[0], up[1], up[1], up[2], up[2], up[0], // "up" triangle
  ];
  return new THREE.BufferGeometry().setFromPoints(segs.map(([x, y, zz]) => new THREE.Vector3(x, y, zz)));
}

export function SceneCameras({ objects }: { objects: CityObject[] }) {
  const viewing = useWorld((s) => s.viewCamera);
  const cams = useMemo(() => objects.filter((o) => o.type === 'camera'), [objects]);
  return (
    <>
      {cams.filter((o) => o.id !== viewing).map((o) => <Frustum key={o.id} object={o} />)}
    </>
  );
}

function Frustum({ object }: { object: CityObject }) {
  const fov = object.props.fov ?? 40;
  const geo = useMemo(() => frustumGeometry(fov), [fov]);
  useEffect(() => () => geo.dispose(), [geo]);
  const m = useMemo(() => objectMatrix(object), [object]);
  return <lineSegments geometry={geo} material={lineMat} matrix={m} matrixAutoUpdate={false} raycast={() => null} />;
}
