// Procedural asset definitions. Every object type is a fixed list of primitive parts,
// so each (type, part) can be drawn as ONE InstancedMesh regardless of how many objects exist.
// Realism comes from proportions, a coastal palette, and a facade shader (windows per floor), not from polygons.
import * as THREE from 'three';
import { OBJECT_INFO, type CityObject, type ObjectType } from '@civitas/shared';

export type GeoKey = 'box' | 'cyl' | 'taper' | 'cone8' | 'pyramid' | 'sphere' | 'frond';
export type MaterialKey = 'base' | 'facade' | 'lamp' | 'leaf';
export interface Part {
  geo: GeoKey;
  pos: [number, number, number]; // center, object-local, before object scale
  size: [number, number, number];
  rot?: [number, number, number]; // euler XYZ, radians
  color: string;
  mat?: MaterialKey; // default 'base'
  castShadow?: boolean;
}

// Unit-sized shared geometries (1x1x1 bounding box, centered).
export const GEOMETRIES: Record<GeoKey, THREE.BufferGeometry> = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
  taper: new THREE.CylinderGeometry(0.32, 0.5, 1, 6),
  cone8: new THREE.ConeGeometry(0.5, 1, 8),
  pyramid: new THREE.ConeGeometry(0.71, 1, 4).rotateY(Math.PI / 4),
  sphere: new THREE.IcosahedronGeometry(0.5, 1),
  // Palm frond: a leaf that starts at the origin and droops outward along +z.
  frond: (() => {
    const g = new THREE.PlaneGeometry(1, 1, 1, 4).rotateX(-Math.PI / 2).translate(0, 0, 0.5);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const z = p.getZ(i);
      p.setY(i, -z * z * 0.6); // droop
      p.setX(i, p.getX(i) * (1 - z * 0.7)); // taper to the tip
    }
    g.computeVertexNormals();
    return g;
  })(),
};

const FLOOR_H = 3;
const ROOF = '#b8532e'; // terracotta, as in the reference harbour
const DOOR = '#4a3426';
const shade = (hex: string, f: number) => '#' + new THREE.Color(hex).multiplyScalar(f).getHexString();

export const DETAIL_TYPES: ObjectType[] = ['bench', 'streetlight'];
export const ENTERABLE: ObjectType[] = ['residential', 'office', 'commercial', 'school', 'hospital'];

const FRONDS = 6;

export function partsFor(o: Pick<CityObject, 'type' | 'props'>): Part[] {
  const info = OBJECT_INFO[o.type];
  const [w, d] = info.footprint;
  const c = o.props.color ?? (o.props.style === 'modern' && o.type === 'office' ? '#b9c7d0' : info.color);
  const floors = o.props.floors ?? info.floors ?? 1;
  const h = floors * FLOOR_H;
  const classic = o.props.style === 'classic';
  switch (o.type) {
    case 'residential':
      return [
        { geo: 'box', pos: [0, h / 2, 0], size: [w, h, d], color: c, mat: 'facade', castShadow: true },
        { geo: 'pyramid', pos: [0, h + 1.1, 0], size: [w + 0.8, 2.2, d + 0.8], color: o.props.style === 'modern' ? '#4b5058' : ROOF, castShadow: true },
        { geo: 'box', pos: [0, 1.15, d / 2 + 0.04], size: [1.5, 2.3, 0.1], color: DOOR },
      ];
    case 'office':
      return [
        { geo: 'box', pos: [0, h / 2, 0], size: [w, h, d], color: c, mat: 'facade', castShadow: true },
        { geo: 'box', pos: [0, h + 0.15, 0], size: [w + 0.3, 0.3, d + 0.3], color: '#d9d4cc' },
        { geo: 'box', pos: [1, h + 1, -1], size: [w * 0.35, 1.4, d * 0.35], color: '#bfbab2' },
        { geo: 'box', pos: [0, 1.15, d / 2 + 0.04], size: [1.5, 2.3, 0.1], color: DOOR },
      ];
    case 'commercial':
      return [
        { geo: 'box', pos: [0, h / 2, 0], size: [w, h, d], color: c, mat: 'facade', castShadow: true },
        { geo: 'pyramid', pos: [0, h + 0.9, 0], size: [w + 1, 1.8, d + 1], color: classic ? '#8f3f22' : ROOF, castShadow: true },
        { geo: 'box', pos: [0, 2.7, d / 2 + 0.7], size: [w * 0.85, 0.12, 1.4], color: '#e9e2d4' },
        { geo: 'box', pos: [0, 1.15, d / 2 + 0.04], size: [1.5, 2.3, 0.1], color: DOOR },
      ];
    case 'school':
      return [
        { geo: 'box', pos: [0, h / 2, 0], size: [w, h, d], color: c, mat: 'facade', castShadow: true },
        { geo: 'pyramid', pos: [0, h + 1.2, 0], size: [w + 1, 2.4, d + 1], color: ROOF, castShadow: true },
        { geo: 'box', pos: [0, 1.15, d / 2 + 0.04], size: [1.5, 2.3, 0.1], color: DOOR },
      ];
    case 'hospital':
      return [
        { geo: 'box', pos: [0, h / 2, 0], size: [w, h, d], color: c, mat: 'facade', castShadow: true },
        { geo: 'box', pos: [0, h + 0.15, 0], size: [w + 0.3, 0.3, d + 0.3], color: '#d9d4cc' },
        { geo: 'box', pos: [0, h + 0.35, 0], size: [w * 0.45, 0.12, 1.5], color: '#c0392b' },
        { geo: 'box', pos: [0, h + 0.35, 0], size: [1.5, 0.12, d * 0.45], color: '#c0392b' },
        { geo: 'box', pos: [0, 1.15, d / 2 + 0.04], size: [1.5, 2.3, 0.1], color: DOOR },
      ];
    case 'park':
      return [
        { geo: 'box', pos: [0, 0.06, 0], size: [w, 0.12, d], color: c },
        { geo: 'box', pos: [0, 0.13, 0], size: [1.8, 0.03, d], color: '#e4d8bf' },
        { geo: 'box', pos: [0, 0.13, 0], size: [w, 0.03, 1.8], color: '#e4d8bf' },
        { geo: 'cyl', pos: [0, 0.3, 0], size: [3.2, 0.5, 3.2], color: '#d6cdbd' },
        { geo: 'cyl', pos: [0, 0.52, 0], size: [2.7, 0.06, 2.7], color: '#5fb8c4' },
        { geo: 'cyl', pos: [0, 0.9, 0], size: [0.35, 0.8, 0.35], color: '#d6cdbd' },
      ];
    case 'road':
      return [
        { geo: 'box', pos: [0, 0.04, 0], size: [6, 0.08, d], color: c },
        { geo: 'box', pos: [-3.5, 0.1, 0], size: [1, 0.2, d], color: '#d8d1c4' },
        { geo: 'box', pos: [3.5, 0.1, 0], size: [1, 0.2, d], color: '#d8d1c4' },
        { geo: 'box', pos: [0, 0.085, 0], size: [0.15, 0.01, d * 0.45], color: '#efe9da' },
      ];
    case 'tree': {
      // Palm: tapered trunk, coconut cluster, ring of drooping fronds.
      const parts: Part[] = [
        { geo: 'taper', pos: [0, 2.6, 0], size: [0.45, 5.2, 0.45], color: '#8b7356', castShadow: true },
        { geo: 'sphere', pos: [0, 5.2, 0], size: [0.7, 0.6, 0.7], color: '#5b4a2f' },
      ];
      for (let k = 0; k < FRONDS; k++) {
        parts.push({ geo: 'frond', pos: [0, 5.35, 0], size: [1.1, 1, 3.4], rot: [-0.25, (k / FRONDS) * Math.PI * 2, 0], color: k % 2 ? c : shade(c, 1.15), mat: 'leaf', castShadow: true });
      }
      return parts;
    }
    case 'streetlight':
      return [
        { geo: 'cyl', pos: [0, 2.5, 0], size: [0.14, 5, 0.14], color: c },
        { geo: 'box', pos: [0, 5, 0.5], size: [0.2, 0.12, 1.1], color: c },
        { geo: 'sphere', pos: [0, 4.9, 0.95], size: [0.45, 0.3, 0.45], color: '#fff3c4', mat: 'lamp' },
      ];
    case 'bench':
      return [
        { geo: 'box', pos: [0, 0.45, 0], size: [w, 0.1, 0.55], color: c },
        { geo: 'box', pos: [0, 0.8, -0.26], size: [w, 0.5, 0.08], color: c },
        { geo: 'box', pos: [0, 0.22, 0], size: [w * 0.9, 0.44, 0.4], color: '#3a3a3a' },
      ];
    case 'bus_stop':
      return [
        { geo: 'box', pos: [0, 2.5, 0], size: [w, 0.12, d], color: '#e8e4dc' },
        { geo: 'box', pos: [0, 1.25, -d / 2 + 0.1], size: [w, 2.5, 0.08], color: '#9fb8c4' },
        { geo: 'cyl', pos: [w / 2 + 0.4, 1.5, 0], size: [0.1, 3, 0.1], color: '#2f3236' },
        { geo: 'box', pos: [w / 2 + 0.4, 2.9, 0], size: [0.6, 0.6, 0.06], color: c, mat: 'lamp' },
      ];
  }
}

const _p = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _y = new THREE.Vector3(0, 1, 0);
const _pos = new THREE.Vector3();
const _scl = new THREE.Vector3();

/** World matrix of the object (position, Y rotation, scale). */
export function objectMatrix(o: Pick<CityObject, 'position' | 'rotationY' | 'scale'>, out = new THREE.Matrix4()) {
  _q.setFromAxisAngle(_y, o.rotationY);
  return out.compose(_pos.set(o.position.x, o.position.y, o.position.z), _q, _scl.set(o.scale.x, o.scale.y, o.scale.z));
}

/** Matrix of one part inside an object: object * T(part.pos) * R(part.rot) * S(part.size). */
export function partMatrix(objM: THREE.Matrix4, part: Part, out: THREE.Matrix4) {
  if (part.rot) _q.setFromEuler(_e.set(part.rot[0], part.rot[1], part.rot[2], 'YXZ'));
  else _q.identity();
  _p.compose(_pos.set(part.pos[0], part.pos[1], part.pos[2]), _q, _scl.set(part.size[0], part.size[1], part.size[2]));
  return out.multiplyMatrices(objM, _p);
}

/** Small deterministic per-object tint so repeated buildings do not look cloned. */
export function tintFor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return 0.93 + ((h >>> 0) % 1000) / 1000 * 0.1;
}
