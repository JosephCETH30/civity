import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { simHour, type SimState } from '@civitas/shared';
import { Sky } from '@react-three/drei';
import { lamp, sceneUniforms } from '../materials/materials';
import { localPlayer } from '../core/transient';
import { serverNow } from '../../services/realtime';
import type { QualityProfile } from '../optimization/quality';

const NIGHT = new THREE.Color('#0d1424');
const DAWN = new THREE.Color('#f2b38a');
const DAY = new THREE.Color('#d6e6ee'); // hazy coastal horizon
const OVERCAST = new THREE.Color('#9aa6b2');

/** Sun, sky and fog driven by the shared simulation clock (time of day + weather). */
export function Environment({ sim, profile, far }: { sim: SimState; profile: QualityProfile; far: number }) {
  const { scene } = useThree();
  const sun = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const sky = useRef<THREE.Mesh>(null);
  const sunDir = useMemo(() => new THREE.Vector3(), []);
  const bg = useMemo(() => new THREE.Color(), []);
  const fog = useMemo(() => new THREE.Fog('#bfd9f2', 60, profile.viewDistance), [profile.viewDistance]);

  useEffect(() => {
    scene.background = bg;
    scene.fog = fog;
    return () => { scene.fog = null; };
  }, [scene, bg, fog]);

  useFrame((_, dt) => {
    sceneUniforms.uTime.value += dt;
    const hour = simHour(sim, serverNow());
    const elev = Math.sin(((hour - 6) / 12) * Math.PI); // 1 at noon, -1 at midnight
    const day = THREE.MathUtils.clamp(elev * 1.6 + 0.2, 0, 1);
    const cloudy = sim.weather === 'clear' ? 0 : sim.weather === 'cloudy' ? 0.5 : 0.75;

    bg.copy(NIGHT).lerp(elev < 0.25 && elev > -0.1 ? DAWN : DAY, day).lerp(OVERCAST, cloudy * day);
    fog.color.copy(bg);
    fog.near = sim.weather === 'fog' ? 5 : profile.viewDistance * 0.5;
    fog.far = sim.weather === 'fog' ? Math.min(90, profile.viewDistance) : sim.weather === 'rain' ? profile.viewDistance * 0.7 : profile.viewDistance;

    const az = ((hour - 6) / 12) * Math.PI;
    sunDir.set(Math.cos(az), elev, 0.45).normalize();
    const skyMat = sky.current?.material as THREE.ShaderMaterial | undefined;
    if (skyMat) {
      skyMat.uniforms.sunPosition.value.copy(sunDir);
      skyMat.uniforms.turbidity.value = 2 + cloudy * 10;
    }
    if (sun.current) {
      sun.current.position.set(localPlayer.x + Math.cos(az) * 80, Math.max(elev, 0.05) * 100, localPlayer.z + 40);
      sun.current.target.position.set(localPlayer.x, 0, localPlayer.z);
      sun.current.target.updateMatrixWorld();
      sun.current.intensity = day * (1 - cloudy * 0.6) * 2.2;
    }
    if (hemi.current) hemi.current.intensity = 0.3 + day * 1.1;
    const night = day < 0.35 ? 1 : 0;
    lamp.emissiveIntensity = night * 1.5;
    sceneUniforms.uNight.value = THREE.MathUtils.clamp(1 - day * 2.2, 0, 1);
  });

  const s = profile.shadowMapSize;
  return (
    <>
      {profile.sky && <Sky ref={sky as any} distance={far * 0.9} rayleigh={1.2} mieCoefficient={0.004} mieDirectionalG={0.8} />}
      <hemisphereLight ref={hemi} args={['#d3e6f2', '#b9a98c', 1]} />
      <directionalLight
        ref={sun}
        color="#fff0d9"
        castShadow={profile.shadows}
        shadow-mapSize={[s || 512, s || 512]}
        shadow-camera-left={-70}
        shadow-camera-right={70}
        shadow-camera-top={70}
        shadow-camera-bottom={-70}
        shadow-camera-far={300}
        shadow-bias={-0.0005}
      />
      {(sim.weather === 'rain') && profile.rainParticles > 0 && <Rain count={profile.rainParticles} />}
    </>
  );
}

function Rain({ count }: { count: number }) {
  const ref = useRef<THREE.Points>(null);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      p[i * 3] = (Math.random() - 0.5) * 80;
      p[i * 3 + 1] = Math.random() * 40;
      p[i * 3 + 2] = (Math.random() - 0.5) * 80;
    }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    return g;
  }, [count]);
  useEffect(() => () => geo.dispose(), [geo]);
  useFrame((_, dt) => {
    const pts = ref.current;
    if (!pts) return;
    pts.position.set(localPlayer.x, 0, localPlayer.z);
    const a = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < count; i++) {
      let y = a.getY(i) - dt * 30;
      if (y < 0) y += 40;
      a.setY(i, y);
    }
    a.needsUpdate = true;
  });
  return (
    <points ref={ref} geometry={geo} frustumCulled={false}>
      <pointsMaterial color="#a9c3dd" size={0.15} transparent opacity={0.7} depthWrite={false} />
    </points>
  );
}
