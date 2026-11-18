// Simulation layer: route lines, traffic (cars + buses) and traffic lights. Vehicles come from TrafficSystem,
// which guarantees they never overlap each other or static objects. Nothing here is saved as city objects.
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import type { CityObject, CityRoute, SimState } from '@civitas/shared';
import { lanePoint, TICK, TrafficSystem, trafficRef, type Vehicle } from './traffic';
import { merged } from '../objects/merge';
import { sceneUniforms } from '../materials/materials';

export function Transit({ routes, objects, sim, highlightStops, carsPer100m }: {
  routes: CityRoute[]; objects: Record<string, CityObject>; sim: SimState; highlightStops: string[]; carsPer100m: number;
}) {
  const lines = useMemo(
    () => routes
      .map((r) => ({ route: r, pts: r.stopIds.map((id) => objects[id]).filter(Boolean).map((o) => new THREE.Vector3(o.position.x, 0.3, o.position.z)) }))
      .filter((x) => x.pts.length >= 2),
    [routes, objects],
  );
  const draft = useMemo(
    () => highlightStops.map((id) => objects[id]).filter(Boolean).map((o) => new THREE.Vector3(o.position.x, 0.5, o.position.z)),
    [highlightStops, objects],
  );

  return (
    <>
      {lines.map(({ route, pts }) => <Line key={route.id} points={pts} color={route.color} lineWidth={3} transparent opacity={0.7} />)}
      {draft.length >= 2 && <Line points={draft} color="#f59e0b" lineWidth={4} dashed dashSize={1.5} gapSize={1} />}
      {draft.map((p, i) => (
        <mesh key={i} position={[p.x, 4.2, p.z]}>
          <sphereGeometry args={[0.6, 10, 8]} />
          <meshBasicMaterial color="#f59e0b" />
        </mesh>
      ))}
      <Traffic objects={objects} routes={routes} sim={sim} carsPer100m={carsPer100m} />
    </>
  );
}

// Original city vehicles, kept inside the collision boxes from traffic.ts (CAR 4.4 x 1.9, BUS 7.2 x 2.5). Local +z is
// the direction of travel; with left-hand traffic the kerb (bus doors) is on the vehicle's left, local +x.
// Each vehicle is 3 instanced meshes: paint (tinted per vehicle), trim (glass, wheels, stripe) and lights.
const box = (x: number, y: number, z: number) => new THREE.BoxGeometry(x, y, z);
const wheel = (r: number, wd: number, sides = 8) => new THREE.CylinderGeometry(r, r, wd, sides); // low-sided: dozens of cars on screen
const GLASS = '#26313b', TYRE = '#1d2024', HUB = '#b8bcc1', STRIPE = '#f2efe6';
const sideWheels = (xs: number, zs: number[], r: number, y: number) =>
  zs.flatMap((z) => [-1, 1].flatMap((sx) => [
    { geo: wheel(r, 0.24), color: TYRE, pos: [sx * xs, y, z] as [number, number, number], rot: [0, 0, Math.PI / 2] as [number, number, number] },
    { geo: wheel(r * 0.5, 0.26, 6), color: HUB, pos: [sx * xs, y, z] as [number, number, number], rot: [0, 0, Math.PI / 2] as [number, number, number] },
  ]));
const carPaint = merged([
  { geo: box(1.86, 0.55, 3.9), color: '#ffffff', pos: [0, 0.6, 0] },
  { geo: box(1.74, 0.42, 0.26), color: '#ffffff', pos: [0, 0.55, 2.06] }, // rounded-looking nose
  { geo: box(1.76, 0.5, 0.2), color: '#ffffff', pos: [0, 0.6, -2.05] },
  { geo: box(1.58, 0.08, 1.55), color: '#ffffff', pos: [0, 1.46, -0.3] }, // roof over the cabin
]);
const carTrim = merged([
  { geo: box(1.6, 0.56, 1.55), color: GLASS, pos: [0, 1.15, -0.3] },
  { geo: box(1.56, 0.05, 0.82), color: GLASS, pos: [0, 1.15, 0.78], rot: [0.74, 0, 0] }, // sloped windscreen
  { geo: box(1.56, 0.05, 0.6), color: GLASS, pos: [0, 1.2, -1.32], rot: [2.27, 0, 0] }, // rear glass
  { geo: box(1.9, 0.12, 0.12), color: '#3a3e44', pos: [0, 0.4, 2.12] }, // bumpers
  { geo: box(1.9, 0.12, 0.12), color: '#3a3e44', pos: [0, 0.42, -2.12] },
  ...sideWheels(0.84, [1.35, -1.35], 0.33, 0.33),
]);
const carLights = merged([
  { geo: box(0.36, 0.14, 0.06), color: '#fff1c9', pos: [-0.6, 0.66, 2.2] },
  { geo: box(0.36, 0.14, 0.06), color: '#fff1c9', pos: [0.6, 0.66, 2.2] },
  { geo: box(0.34, 0.12, 0.06), color: '#e0322b', pos: [-0.62, 0.72, -2.17] },
  { geo: box(0.34, 0.12, 0.06), color: '#e0322b', pos: [0.62, 0.72, -2.17] },
]);
const busPaint = merged([{ geo: box(2.46, 2.3, 7.1), color: '#ffffff', pos: [0, 1.55, 0] }]);
const busTrim = merged([
  { geo: box(2.5, 0.85, 5.7), color: GLASS, pos: [0, 2.05, -0.45] }, // continuous window band, both sides
  { geo: box(2.3, 1.15, 0.06), color: GLASS, pos: [0, 1.95, 3.56] }, // windscreen
  { geo: box(2.5, 0.22, 7.12), color: STRIPE, pos: [0, 1.2, 0] }, // livery stripe
  { geo: box(0.04, 2.0, 1.0), color: GLASS, pos: [1.25, 1.4, 2.55] }, // doors on the kerb side
  { geo: box(0.04, 2.0, 1.0), color: GLASS, pos: [1.25, 1.4, -0.7] },
  { geo: box(1.4, 0.3, 2.2), color: '#cfd2d4', pos: [0, 2.85, -1.6] }, // roof unit
  ...sideWheels(1.12, [2.35, -1.8, -2.75], 0.45, 0.45),
]);
const busLights = merged([
  { geo: box(0.4, 0.16, 0.06), color: '#fff1c9', pos: [-0.85, 0.75, 3.58] },
  { geo: box(0.4, 0.16, 0.06), color: '#fff1c9', pos: [0.85, 0.75, 3.58] },
  { geo: box(0.36, 0.2, 0.06), color: '#e0322b', pos: [-0.9, 0.85, -3.58] },
  { geo: box(0.36, 0.2, 0.06), color: '#e0322b', pos: [0.9, 0.85, -3.58] },
  { geo: box(1.8, 0.32, 0.06), color: '#ffc95e', pos: [0, 2.58, 3.58] }, // blank destination panel
]);
const paintMat = new THREE.MeshLambertMaterial({ color: 'white' });
const trimMat = new THREE.MeshLambertMaterial({ vertexColors: true });
// Lights are unlit colours: soft by day, bright at night (driven by the scene's night factor).
const lightsMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
const poleGeo = new THREE.CylinderGeometry(0.08, 0.08, 3, 6).translate(0, 1.5, 0);
const headGeo = new THREE.BoxGeometry(0.32, 0.8, 0.32).translate(0, 3.2, 0);
const poleMat = new THREE.MeshLambertMaterial({ color: '#2f3236' });
const lightMat = new THREE.MeshBasicMaterial({ color: 'white' });
const RED = new THREE.Color('#e5483b'), AMBER = new THREE.Color('#f2b33d'), GREEN = new THREE.Color('#3fbf6a');

function Traffic({ objects, routes, sim, carsPer100m }: { objects: Record<string, CityObject>; routes: CityRoute[]; sim: SimState; carsPer100m: number }) {
  // Rebuilt when the city or routes change (edits are rare); vehicles restart from a clean layout.
  const sys = useMemo(() => new TrafficSystem(Object.values(objects), routes, carsPer100m), [objects, routes, carsPer100m]);
  useLayoutEffect(() => {
    trafficRef.current = sys;
    return () => { if (trafficRef.current === sys) trafficRef.current = null; };
  }, [sys]);

  const cars = useMemo(() => sys.vehicles.filter((v) => v.kind === 'car'), [sys]);
  const buses = useMemo(() => sys.vehicles.filter((v) => v.kind === 'bus'), [sys]);
  const signals = useMemo(
    () => sys.lanes.flatMap((lane) => lane.stops.map((st) => {
      // On the kerb beside the stop line (left-hand traffic: the kerb is on the lane's outer side).
      const p = lanePoint(lane, st);
      const runC = lane.axis === 'x' ? lane.c + lane.dir * 1.5 : lane.c - lane.dir * 1.5;
      const lat = runC + (lane.c - runC) * 2.4;
      return { axis: lane.axis, x: lane.axis === 'x' ? p.x : lat, z: lane.axis === 'x' ? lat : p.z };
    })),
    [sys],
  );

  const carB = useRef<THREE.InstancedMesh>(null), carC = useRef<THREE.InstancedMesh>(null), carL = useRef<THREE.InstancedMesh>(null);
  const busB = useRef<THREE.InstancedMesh>(null), busG = useRef<THREE.InstancedMesh>(null), busL = useRef<THREE.InstancedMesh>(null);
  const pitch = useRef(new Map<Vehicle, { v: number; p: number }>());
  const poles = useRef<THREE.InstancedMesh>(null), heads = useRef<THREE.InstancedMesh>(null);
  const acc = useRef(0);
  const prev = useRef(new Map<Vehicle, { lane: number; s: number }>());
  const o = useMemo(() => new THREE.Object3D(), []);

  useLayoutEffect(() => {
    const col = new THREE.Color();
    cars.forEach((v, i) => carB.current?.setColorAt(i, col.set(v.color)));
    buses.forEach((v, i) => busB.current?.setColorAt(i, col.set(v.color)));
    for (const m of [carB.current, busB.current]) if (m?.instanceColor) m.instanceColor.needsUpdate = true;
    signals.forEach((s, i) => {
      o.position.set(s.x, 0, s.z);
      o.rotation.set(0, 0, 0);
      o.scale.setScalar(1);
      o.updateMatrix();
      poles.current?.setMatrixAt(i, o.matrix);
      heads.current?.setMatrixAt(i, o.matrix);
    });
    for (const m of [poles.current, heads.current]) if (m) { m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); }
  }, [cars, buses, signals, o]);

  useFrame((_, dt) => {
    // Fixed ticks: paused with the simulation, faster with its speed setting.
    if (sim.running) {
      acc.current += Math.min(dt, 0.1) * sim.speed;
      let n = 0;
      while (acc.current >= TICK && n++ < 40) {
        for (const v of sys.vehicles) prev.current.set(v, { lane: v.lane, s: v.s });
        sys.step();
        acc.current -= TICK;
      }
    }
    const alpha = sim.running ? Math.min(1, acc.current / TICK) : 1;
    const night = sceneUniforms.uNight.value;
    lightsMat.color.setScalar(0.7 + night * 0.9);
    trimMat.color.setScalar(1 - night * 0.25); // glass a little darker at night
    const place = (mesh: THREE.InstancedMesh | null, list: Vehicle[], second: THREE.InstancedMesh | null, third: THREE.InstancedMesh | null) => {
      if (!mesh) return;
      list.forEach((v, i) => {
        const pose = sys.pose(v);
        const p = prev.current.get(v);
        // Interpolate between ticks unless the vehicle wrapped or changed lane (then snap).
        if (p && p.lane === v.lane && Math.abs(v.s - p.s) < 5) {
          const pp = sys.pose({ ...v, s: p.s + (v.s - p.s) * alpha });
          pose.x = pp.x; pose.z = pp.z;
        }
        // Small nose dip while braking (smoothed), part of the matrix we already update every frame.
        const pm = pitch.current.get(v) ?? { v: v.v, p: 0 };
        const decel = Math.max(0, (pm.v - v.v) / Math.max(dt, 1e-3));
        pm.p += (Math.min(0.035, decel * 0.004) - pm.p) * (1 - Math.exp(-dt * 6));
        pm.v = v.v;
        pitch.current.set(v, pm);
        o.position.set(pose.x, 0, pose.z);
        o.rotation.set(pm.p, pose.r, 0, 'YXZ');
        o.scale.setScalar(Math.max(0.001, pose.scale));
        o.updateMatrix();
        mesh.setMatrixAt(i, o.matrix);
        second?.setMatrixAt(i, o.matrix);
        third?.setMatrixAt(i, o.matrix);
      });
      for (const m of [mesh, second, third]) if (m) m.instanceMatrix.needsUpdate = true;
    };
    place(carB.current, cars, carC.current, carL.current);
    place(busB.current, buses, busG.current, busL.current);
    const h = heads.current;
    if (h) {
      const gx = sys.greenLeft('x'), gz = sys.greenLeft('z');
      signals.forEach((s, i) => {
        const g = s.axis === 'x' ? gx : gz;
        h.setColorAt(i, g > 2.6 ? GREEN : g > 0 ? AMBER : RED);
      });
      if (h.instanceColor) h.instanceColor.needsUpdate = true;
    }
  });

  return (
    <>
      {cars.length > 0 && (
        <>
          <instancedMesh key={`cb${sys.vehicles.length}`} ref={carB} args={[carPaint, paintMat, cars.length]} frustumCulled={false} castShadow />
          <instancedMesh key={`cc${sys.vehicles.length}`} ref={carC} args={[carTrim, trimMat, cars.length]} frustumCulled={false} />
          <instancedMesh key={`cl${sys.vehicles.length}`} ref={carL} args={[carLights, lightsMat, cars.length]} frustumCulled={false} />
        </>
      )}
      {buses.length > 0 && (
        <>
          <instancedMesh key={`bb${sys.vehicles.length}`} ref={busB} args={[busPaint, paintMat, buses.length]} frustumCulled={false} castShadow />
          <instancedMesh key={`bg${sys.vehicles.length}`} ref={busG} args={[busTrim, trimMat, buses.length]} frustumCulled={false} />
          <instancedMesh key={`bl${sys.vehicles.length}`} ref={busL} args={[busLights, lightsMat, buses.length]} frustumCulled={false} />
        </>
      )}
      {signals.length > 0 && (
        <>
          <instancedMesh key={`p${signals.length}`} ref={poles} args={[poleGeo, poleMat, signals.length]} />
          <instancedMesh key={`h${signals.length}`} ref={heads} args={[headGeo, lightMat, signals.length]} />
        </>
      )}
    </>
  );
}
