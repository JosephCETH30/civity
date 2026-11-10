// Simulation layer: route lines, traffic (cars + buses) and traffic lights. Vehicles come from TrafficSystem,
// which guarantees they never overlap each other or static objects. Nothing here is saved as city objects.
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import type { CityObject, CityRoute, SimState } from '@civitas/shared';
import { BUS, CAR, lanePoint, TICK, TrafficSystem, trafficRef, type Vehicle } from './traffic';

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

const carBody = new THREE.BoxGeometry(CAR.w, 0.75, CAR.len).translate(0, 0.62, 0);
const carCabin = new THREE.BoxGeometry(CAR.w - 0.25, 0.6, CAR.len * 0.5).translate(0, 1.27, -0.2);
const busBody = new THREE.BoxGeometry(BUS.w, 2.4, BUS.len).translate(0, 1.5, 0);
const busGlass = new THREE.BoxGeometry(BUS.w + 0.04, 0.75, BUS.len - 0.8).translate(0, 2.0, 0);
const paintMat = new THREE.MeshLambertMaterial({ color: 'white' });
const glassMat = new THREE.MeshLambertMaterial({ color: '#25303a' });
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

  const carB = useRef<THREE.InstancedMesh>(null), carC = useRef<THREE.InstancedMesh>(null);
  const busB = useRef<THREE.InstancedMesh>(null), busG = useRef<THREE.InstancedMesh>(null);
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
    const place = (mesh: THREE.InstancedMesh | null, list: Vehicle[], second: THREE.InstancedMesh | null) => {
      if (!mesh) return;
      list.forEach((v, i) => {
        const pose = sys.pose(v);
        const p = prev.current.get(v);
        // Interpolate between ticks unless the vehicle wrapped or changed lane (then snap).
        if (p && p.lane === v.lane && Math.abs(v.s - p.s) < 5) {
          const pp = sys.pose({ ...v, s: p.s + (v.s - p.s) * alpha });
          pose.x = pp.x; pose.z = pp.z;
        }
        o.position.set(pose.x, 0, pose.z);
        o.rotation.set(0, pose.r, 0);
        o.scale.setScalar(Math.max(0.001, pose.scale));
        o.updateMatrix();
        mesh.setMatrixAt(i, o.matrix);
        second?.setMatrixAt(i, o.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (second) second.instanceMatrix.needsUpdate = true;
    };
    place(carB.current, cars, carC.current);
    place(busB.current, buses, busG.current);
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
          <instancedMesh key={`cb${sys.vehicles.length}`} ref={carB} args={[carBody, paintMat, cars.length]} frustumCulled={false} castShadow />
          <instancedMesh key={`cc${sys.vehicles.length}`} ref={carC} args={[carCabin, glassMat, cars.length]} frustumCulled={false} />
        </>
      )}
      {buses.length > 0 && (
        <>
          <instancedMesh key={`bb${sys.vehicles.length}`} ref={busB} args={[busBody, paintMat, buses.length]} frustumCulled={false} castShadow />
          <instancedMesh key={`bg${sys.vehicles.length}`} ref={busG} args={[busGlass, glassMat, buses.length]} frustumCulled={false} />
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
