import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber';
import { PerformanceMonitor, TransformControls } from '@react-three/drei';
import { defaultSpec, normalizeSpec, OBJECT_INFO, type CityObject } from '@civitas/shared';
import { canEditNow, savePref, useWorld } from '../../stores/world';
import { useMedia } from '../../features/communication/mediaStore';
import { realtime } from '../../services/realtime';
import { ghost, localPlayer, perf } from '../core/transient';
import { bindKeyboard } from '../core/interactions';
import { CityObjects, ghostMaterial, SingleObject } from '../objects/CityObjects';
import { Terrain } from './Terrain';
import { Interior } from '../objects/Interior';
import { ArtworkReliefs } from '../objects/ArtworkReliefs';
import { objectMatrix } from '../objects/parts';
import { Avatar } from '../objects/Avatar';
import { CameraRig } from '../cameras/CameraRig';
import { Environment } from '../lighting/Environment';
import { Transit } from '../simulation/Transit';
import { PROFILES, type QualityLevel } from '../optimization/quality';
import { BattleScene } from '../combat/BattleScene';

const DOWNGRADE: Record<QualityLevel, QualityLevel | null> = { high: 'balanced', balanced: 'low', low: null };

export default function CityCanvas() {
  const quality = useWorld((s) => s.quality);
  const profile = PROFILES[quality];
  const [dprScale, setDprScale] = useState(1);
  useEffect(() => bindKeyboard(), []);

  return (
    <Canvas
      key={profile.antialias ? 'aa' : 'noaa'} // antialias is a context creation flag
      shadows={profile.shadows ? 'percentage' : false}
      dpr={Math.min(window.devicePixelRatio || 1, profile.dpr) * dprScale}
      gl={{ antialias: profile.antialias, powerPreference: 'high-performance', stencil: false }}
      camera={{ position: [localPlayer.x, 30, localPlayer.z + 30], fov: 55, near: 0.5, far: profile.viewDistance }}
      onPointerMissed={() => useWorld.getState().tool.kind === 'select' && useWorld.getState().set({ selectedId: null })}
      style={{ touchAction: 'none' }}
      aria-label="3D city view"
    >
      <PerformanceMonitor
        // Measured FPS decides; device class only picked the starting point.
        bounds={() => [24, 50]}
        flipflops={3}
        onDecline={() => {
          const st = useWorld.getState();
          if (!st.autoQuality) return;
          const next = DOWNGRADE[st.quality];
          if (next) {
            st.set({ quality: next });
            savePref('quality', next);
            st.notify(`Graphics lowered to ${next} to keep things smooth`);
          } else if (dprScale > 0.6) setDprScale((d) => Math.max(0.6, d - 0.2)); // dynamic resolution
        }}
        onFallback={() => {
          const st = useWorld.getState();
          if (st.autoQuality && st.quality === 'low') st.notify('This device is struggling with 3D. You can switch to the 2D map in Settings.', 'error');
        }}
      />
      <Suspense fallback={null}>
        <Scene />
      </Suspense>
    </Canvas>
  );
}

function Scene() {
  const room = useWorld((s) => s.room)!;
  const objectsMap = useWorld((s) => s.objects);
  const routesMap = useWorld((s) => s.routes);
  const players = useWorld((s) => s.players);
  const self = useWorld((s) => s.self);
  const sim = useWorld((s) => s.sim);
  const selectedId = useWorld((s) => s.selectedId);
  const tool = useWorld((s) => s.tool);
  const cameraMode = useWorld((s) => s.cameraMode);
  const quality = useWorld((s) => s.quality);
  const profile = PROFILES[quality];
  const speaking = useMedia((s) => s.speaking);
  const insideId = useWorld((s) => s.inside);
  const battle = useWorld((s) => s.battle);
  const insideObj = insideId ? objectsMap[insideId] : undefined;
  const me = self ? players[self.sessionId] : undefined;

  const allObjects = useMemo(() => Object.values(objectsMap), [objectsMap]);
  const unselected = useMemo(() => Object.values(objectsMap).filter((o) => o.id !== selectedId), [objectsMap, selectedId]);
  const selected = selectedId ? objectsMap[selectedId] : undefined;
  const routes = useMemo(() => Object.values(routesMap), [routesMap]);

  const onPick = (id: string, e: ThreeEvent<MouseEvent>) => {
    const st = useWorld.getState();
    if (st.inBattle && st.tool.kind === 'select') return; // clicks fire the blaster instead
    if (st.tool.kind === 'place') {
      if (!canEditNow()) return st.notify('You do not have edit permission', 'error');
      return realtime.send({ t: 'obj_add', spec: defaultSpec(st.tool.type, { x: e.point.x, y: 0, z: e.point.z }) });
    }
    if (st.tool.kind === 'route') {
      if (st.objects[id]?.type !== 'bus_stop') return st.notify('Pick bus stops to build a route');
      if (!st.tool.stops.includes(id)) st.set({ tool: { kind: 'route', stops: [...st.tool.stops, id] } });
      return;
    }
    st.set({ selectedId: id });
  };

  const onGroundMove = (e: ThreeEvent<PointerEvent>) => {
    ghost.x = e.point.x;
    ghost.z = e.point.z;
    ghost.visible = true;
  };
  const onGroundClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6) return; // was a camera drag
    const st = useWorld.getState();
    if (st.inBattle && st.tool.kind === 'select') return;
    if (st.tool.kind === 'select') return st.set({ selectedId: null });
    if (st.tool.kind !== 'place') return;
    if (!canEditNow()) return st.notify('You do not have edit permission', 'error');
    e.stopPropagation();
    realtime.send({ t: 'obj_add', spec: defaultSpec(st.tool.type, { x: e.point.x, y: 0, z: e.point.z }) });
  };

  return (
    <>
      <PerfProbe />
      <Environment sim={sim} profile={profile} far={profile.viewDistance + 100} />
      <CameraRig mode={cameraMode} worldSize={room.worldSize} far={profile.viewDistance + 100} />

      {/* ground */}
      <Terrain worldSize={room.worldSize} shadows={profile.shadows} onGroundMove={onGroundMove} onGroundOut={() => (ghost.visible = false)} onGroundClick={onGroundClick} />
      <gridHelper args={[room.worldSize, room.worldSize / 8, '#a89a80', '#bdb096']} position={[0, 0.03, 0]} visible={tool.kind === 'place'} />

      <CityObjects objects={unselected} standardMaterial={profile.standardMaterial} shadows={profile.shadows} details={profile.details} viewDistance={profile.viewDistance} chunk={profile.chunk} onPick={onPick} />
      {insideObj && <Interior building={insideObj} />}
      <ArtworkReliefs objects={allObjects} lowDetail={quality === 'low'} />
      {selected && <SelectedObject object={selected} standard={profile.standardMaterial} />}
      {tool.kind === 'place' && <Ghost type={tool.type} worldSize={room.worldSize} />}

      <Transit routes={routes} objects={objectsMap} sim={sim} highlightStops={tool.kind === 'route' ? tool.stops : []} carsPer100m={quality === 'low' ? 1.5 : 3} />

      <BattleScene />
      {me && <Avatar sessionId="local" name={me.name} color={me.color} speaking={speaking.has(me.userId)} showLabel={false} lite={quality === 'low'} armed={!!battle[me.id]} />}
      {Object.values(players)
        .filter((p) => p.id !== self?.sessionId)
        .map((p) => (
          <Avatar key={p.id} sessionId={p.id} name={p.name} color={p.color} speaking={speaking.has(p.userId)} showLabel lite={quality === 'low'} armed={!!battle[p.id]} hp={battle[p.id]?.hp} />
        ))}
    </>
  );
}

function Ghost({ type, worldSize }: { type: CityObject['type']; worldSize: number }) {
  const ref = useRef<THREE.Group>(null);
  const obj = useMemo(() => ({ type, props: OBJECT_INFO[type].floors ? { floors: OBJECT_INFO[type].floors } : {} }), [type]);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    g.visible = ghost.visible;
    const s = normalizeSpec(defaultSpec(type, { x: ghost.x, y: 0, z: ghost.z }), worldSize);
    g.position.set(s.position.x, 0, s.position.z);
  });
  return (
    <group ref={ref} raycast={() => null}>
      <SingleObject object={obj} material={ghostMaterial} standard={false} />
    </group>
  );
}

/** Selected object rendered individually with a transform gizmo (editors) or a highlight (others). */
function SelectedObject({ object, standard }: { object: CityObject; standard: boolean }) {
  const mode = useWorld((s) => s.transformMode);
  const editable = useWorld((s) => s.self?.role === 'owner' || s.self?.role === 'editor');
  const [target, setTarget] = useState<THREE.Group | null>(null);
  const m = useMemo(() => objectMatrix(object), [object]);
  const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
  m.decompose(pos, quat, scl);

  const commit = () => {
    if (!target) return;
    const yaw = new THREE.Euler().setFromQuaternion(target.quaternion, 'YXZ').y;
    const patch = {
      position: { x: target.position.x, y: 0, z: target.position.z },
      rotationY: yaw,
      scale: { x: clampScale(target.scale.x), y: clampScale(target.scale.y), z: clampScale(target.scale.z) },
    };
    realtime.send({ t: 'obj_update', id: object.id, patch });
  };

  return (
    <>
      <group ref={setTarget} position={pos} quaternion={quat} scale={scl}>
        <SingleObject object={object} standard={standard} />
        <mesh position={[0, 0.06, 0]} rotation-x={-Math.PI / 2} raycast={() => null}>
          <ringGeometry args={[Math.max(...OBJECT_INFO[object.type].footprint) * 0.6, Math.max(...OBJECT_INFO[object.type].footprint) * 0.6 + 0.4, 32]} />
          <meshBasicMaterial color="#b93d0c" />
        </mesh>
      </group>
      {editable && target && (
        <TransformControls
          object={target}
          mode={mode}
          translationSnap={1}
          rotationSnap={Math.PI / 12}
          scaleSnap={0.25}
          showY={mode !== 'translate'}
          showX={mode !== 'rotate'}
          showZ={mode !== 'rotate'}
          onMouseUp={commit}
        />
      )}
    </>
  );
}
const clampScale = (v: number) => Math.max(0.25, Math.min(4, Math.round(v * 4) / 4));

/** Measured renderer stats (previous frame), shown in Settings so real devices can be checked. */
function PerfProbe() {
  const acc = useRef({ frames: 0, t: 0 });
  useFrame(({ gl }, dt) => {
    const a = acc.current;
    a.frames++;
    a.t += dt;
    if (a.t < 1) return;
    perf.fps = Math.round(a.frames / a.t);
    perf.calls = gl.info.render.calls;
    perf.tris = gl.info.render.triangles;
    a.frames = 0;
    a.t = 0;
  });
  return null;
}
