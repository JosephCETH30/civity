// Shared materials. One instance per (kind, quality class) so every InstancedMesh reuses the same compiled program.
// Building windows and water ripples are computed in the shader: no textures to download or upload to the GPU.
import * as THREE from 'three';

/** 0 = day, 1 = night. Driven by the shared simulation clock in Environment. */
export const sceneUniforms = { uNight: { value: 0 }, uTime: { value: 0 } };

/** Adds window rows to vertical faces using world position (3 m floors, 2.6 m bays). Lit windows glow at night. */
function withFacade<T extends THREE.MeshLambertMaterial | THREE.MeshStandardMaterial>(m: T): T {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = sceneUniforms.uNight;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFacadePos;\nvarying vec3 vFacadeNormal;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          mat4 facadeM = modelMatrix * instanceMatrix;
        #else
          mat4 facadeM = modelMatrix;
        #endif
        vFacadePos = (facadeM * vec4(transformed, 1.0)).xyz;
        vFacadeNormal = normalize(mat3(facadeM) * objectNormal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFacadePos;\nvarying vec3 vFacadeNormal;\nuniform float uNight;\nfloat facadeHash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }\nfloat facadeWin = 0.0; float facadeLit = 0.0;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        if (abs(vFacadeNormal.y) < 0.5 && vFacadePos.y > 0.6) {
          float u = abs(vFacadeNormal.x) > abs(vFacadeNormal.z) ? vFacadePos.z : vFacadePos.x;
          vec2 cell = vec2(u / 2.6, vFacadePos.y / 3.0);
          vec2 f = fract(cell);
          vec2 aa = fwidth(cell) * 1.5;
          float wx = smoothstep(0.18 - aa.x, 0.18 + aa.x, f.x) * (1.0 - smoothstep(0.82 - aa.x, 0.82 + aa.x, f.x));
          float wy = smoothstep(0.32 - aa.y, 0.32 + aa.y, f.y) * (1.0 - smoothstep(0.86 - aa.y, 0.86 + aa.y, f.y));
          facadeWin = wx * wy;
          facadeLit = step(0.45, facadeHash(floor(cell) + floor(vFacadePos.xz * 0.01)));
          vec3 glass = mix(vec3(0.16, 0.22, 0.28), vec3(0.42, 0.55, 0.64), clamp(f.y, 0.0, 1.0) * 0.6);
          diffuseColor.rgb = mix(diffuseColor.rgb, glass, facadeWin * 0.85);
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.78, 0.45) * facadeWin * facadeLit * uNight * 0.9;',
      );
  };
  m.customProgramCacheKey = () => 'facade';
  return m;
}

export function makeMaterials(standard: boolean) {
  const base = standard
    ? new THREE.MeshStandardMaterial({ color: 'white', roughness: 0.85, metalness: 0 })
    : new THREE.MeshLambertMaterial({ color: 'white' });
  const facade = withFacade(
    standard ? new THREE.MeshStandardMaterial({ color: 'white', roughness: 0.7, metalness: 0.05 }) : new THREE.MeshLambertMaterial({ color: 'white' }),
  );
  const leaf = new THREE.MeshLambertMaterial({ color: 'white', side: THREE.DoubleSide });
  return { base, facade, leaf, lamp };
}

export const lamp = new THREE.MeshLambertMaterial({ color: 'white', emissive: new THREE.Color('#ffd27a'), emissiveIntensity: 0 });
export const MATERIALS = { lambert: makeMaterials(false), standard: makeMaterials(true) };
export const ghostMaterial = new THREE.MeshBasicMaterial({ color: '#b93d0c', transparent: true, opacity: 0.4, depthWrite: false });

/** Sea: shallow turquoise near the shore fading to deep teal, with cheap animated glints. */
export function makeWaterMaterial(halfLand: number) {
  const m = new THREE.MeshLambertMaterial({ color: 'white' });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sceneUniforms.uTime;
    shader.uniforms.uHalf = { value: halfLand };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSeaPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSeaPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSeaPos;\nuniform float uTime;\nuniform float uHalf;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float shore = max(abs(vSeaPos.x), abs(vSeaPos.z)) - uHalf;
        float depth = clamp(shore / 60.0, 0.0, 1.0);
        vec3 shallow = vec3(0.24, 0.74, 0.74);
        vec3 deep = vec3(0.04, 0.38, 0.47);
        diffuseColor.rgb = mix(shallow, deep, depth);
        float w = sin(vSeaPos.x * 0.35 + uTime * 0.9) * sin(vSeaPos.z * 0.28 - uTime * 0.7)
                + 0.5 * sin((vSeaPos.x + vSeaPos.z) * 0.9 + uTime * 1.7);
        diffuseColor.rgb += smoothstep(1.05, 1.4, w) * 0.18;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.97, 0.96), (1.0 - smoothstep(0.0, 2.5, shore)) * 0.5);`,
      );
  };
  m.customProgramCacheKey = () => 'sea';
  return m;
}
