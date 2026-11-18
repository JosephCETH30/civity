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
/** Small deterministic random sequence from an id (per-object variation that every viewer sees the same). */
const rand = (seed: string) => {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296;
};
const shade = (hex: string, f: number) => '#' + new THREE.Color(hex).multiplyScalar(f).getHexString();

export const DETAIL_TYPES: ObjectType[] = ['bench', 'streetlight'];
export const ENTERABLE: ObjectType[] = ['residential', 'office', 'commercial', 'school', 'hospital'];

const FRONDS = 6;

/** For roads: which sides (local -x / +x) join another road. Joined sides get asphalt instead of a kerb. */
export interface RoadJoin { neg: boolean; pos: boolean }

export function partsFor(o: Pick<CityObject, 'type' | 'props'> & { id?: string }, join?: RoadJoin): Part[] {
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
    case 'park': {
      // Grass with a crossing path, a low edge kerb, four shrubs, and the fountain (the AI studio landmark).
      const KERB = '#cfc6b4', SHRUB = shade(c, 0.78);
      return [
        { geo: 'box', pos: [0, 0.06, 0], size: [w, 0.12, d], color: c },
        { geo: 'box', pos: [0, 0.13, 0], size: [1.8, 0.03, d], color: '#e4d8bf' },
        { geo: 'box', pos: [0, 0.13, 0], size: [w, 0.03, 1.8], color: '#e4d8bf' },
        { geo: 'box', pos: [0, 0.1, d / 2 - 0.1], size: [w, 0.2, 0.2], color: KERB },
        { geo: 'box', pos: [0, 0.1, -d / 2 + 0.1], size: [w, 0.2, 0.2], color: KERB },
        { geo: 'box', pos: [w / 2 - 0.1, 0.1, 0], size: [0.2, 0.2, d - 0.4], color: KERB },
        { geo: 'box', pos: [-w / 2 + 0.1, 0.1, 0], size: [0.2, 0.2, d - 0.4], color: KERB },
        { geo: 'sphere', pos: [w / 2 - 2, 0.5, d / 2 - 2], size: [1.6, 0.9, 1.4], color: SHRUB },
        { geo: 'sphere', pos: [-w / 2 + 2, 0.5, d / 2 - 2], size: [1.3, 0.8, 1.5], color: SHRUB },
        { geo: 'sphere', pos: [w / 2 - 2, 0.5, -d / 2 + 2], size: [1.4, 0.85, 1.3], color: SHRUB },
        { geo: 'sphere', pos: [-w / 2 + 2, 0.5, -d / 2 + 2], size: [1.5, 0.9, 1.6], color: SHRUB },
        { geo: 'cyl', pos: [0, 0.3, 0], size: [3.2, 0.5, 3.2], color: '#d6cdbd' },
        { geo: 'cyl', pos: [0, 0.52, 0], size: [2.7, 0.06, 2.7], color: '#5fb8c4' },
        { geo: 'cyl', pos: [0, 0.9, 0], size: [0.35, 0.8, 0.35], color: '#d6cdbd' },
      ];
    }
    case 'road': {
      // At junctions, turns and corners the joined side is plain asphalt (no kerb, no edge stone, no centre line),
      // so crossing roads read as one continuous surface. Markings sit 5-10 mm above the asphalt (no flicker).
      const kerb = (side: -1 | 1, open: boolean): Part =>
        open
          ? { geo: 'box', pos: [side * 3.5, 0.04, 0], size: [1, 0.08, d], color: c }
          : { geo: 'box', pos: [side * 3.5, 0.1, 0], size: [1, 0.2, d], color: '#d8d1c4' };
      const edge = (side: -1 | 1, open: boolean): Part =>
        ({ geo: 'box', pos: [side * 3.06, 0.105, 0], size: open ? [0, 0, 0] : [0.14, 0.21, d], color: '#ebe6dc' });
      const joined = !!join && (join.neg || join.pos);
      const dash = (z: number): Part => ({ geo: 'box', pos: [0, 0.085, z], size: joined ? [0, 0, 0] : [0.15, 0.01, 2.2], color: '#efe9da' });
      return [
        { geo: 'box', pos: [0, 0.04, 0], size: [6, 0.08, d], color: c },
        kerb(-1, !!join?.neg),
        kerb(1, !!join?.pos),
        edge(-1, !!join?.neg),
        edge(1, !!join?.pos),
        dash(-d / 4),
        dash(d / 4),
      ];
    }
    case 'tree': {
      // Palm: a slightly curved trunk of 4 shrinking segments (ringed look), coconuts, a crown of drooping fronds.
      // Lean direction/amount and frond angles vary per tree (stable per object id) through rotation and size only.
      const r = rand(o.id ?? '');
      const leanDir = r() * Math.PI * 2, lean = 0.03 + r() * 0.05;
      const parts: Part[] = [];
      const p = [0, 0, 0];
      const heights = [1.5, 1.4, 1.3, 1.2], widths = [0.5, 0.42, 0.36, 0.3];
      heights.forEach((h, i) => {
        const tilt = lean * (i + 1);
        const up = [Math.sin(tilt) * Math.sin(leanDir), Math.cos(tilt), Math.sin(tilt) * Math.cos(leanDir)];
        parts.push({ geo: 'taper', pos: [p[0] + up[0] * h / 2, p[1] + up[1] * h / 2, p[2] + up[2] * h / 2], size: [widths[i], h + 0.08, widths[i]], rot: [tilt, leanDir, 0], color: i % 2 ? '#8b7356' : '#7d6649', castShadow: true });
        p[0] += up[0] * h; p[1] += up[1] * h; p[2] += up[2] * h;
      });
      for (let k = 0; k < 3; k++) {
        const a = leanDir + k * 2.1;
        parts.push({ geo: 'sphere', pos: [p[0] + Math.sin(a) * 0.16, p[1] - 0.18, p[2] + Math.cos(a) * 0.16], size: [0.24, 0.26, 0.24], color: '#5b4a2f' });
      }
      const spin = r() * Math.PI * 2;
      for (let k = 0; k < FRONDS; k++) {
        const droop = -0.32 + r() * 0.22;
        parts.push({ geo: 'frond', pos: [p[0], p[1] + 0.05, p[2]], size: [1.05 + r() * 0.2, 1, 3.1 + r() * 0.6], rot: [droop, spin + (k / FRONDS) * Math.PI * 2, 0], color: k % 2 ? c : shade(c, 1.15), mat: 'leaf', castShadow: true });
      }
      return parts;
    }
    case 'streetlight':
      // About 6 m: base collar, slim pole, angled + horizontal arm, a warm lamp head under a thin dark cap.
      return [
        { geo: 'cyl', pos: [0, 2.8, 0], size: [0.16, 5.6, 0.16], color: c, castShadow: true },
        { geo: 'cyl', pos: [0, 0.25, 0], size: [0.32, 0.5, 0.32], color: c },
        { geo: 'box', pos: [0, 5.72, 0.32], size: [0.1, 0.1, 0.8], rot: [-0.45, 0, 0], color: c },
        { geo: 'box', pos: [0, 5.9, 0.98], size: [0.1, 0.1, 0.7], color: c },
        { geo: 'box', pos: [0, 5.97, 1.42], size: [0.4, 0.05, 0.54], color: '#24272b' },
        { geo: 'box', pos: [0, 5.86, 1.42], size: [0.32, 0.16, 0.46], color: '#fff3c4', mat: 'lamp' }, // glows at night, seen from any side
      ];
    case 'bench':
      // Slatted seat (top at 0.50 m, matching the seated avatar), a slightly reclined slatted back, two side frames.
      return [
        { geo: 'box', pos: [0, 0.475, 0], size: [w, 0.05, 0.15], color: c },
        { geo: 'box', pos: [0, 0.475, -0.17], size: [w, 0.05, 0.15], color: c },
        { geo: 'box', pos: [0, 0.475, 0.17], size: [w, 0.05, 0.15], color: c },
        { geo: 'box', pos: [0, 0.7, -0.28], size: [w, 0.1, 0.04], rot: [-0.18, 0, 0], color: c },
        { geo: 'box', pos: [0, 0.88, -0.31], size: [w, 0.1, 0.04], rot: [-0.18, 0, 0], color: c },
        { geo: 'box', pos: [-w / 2 + 0.15, 0.3, -0.03], size: [0.07, 0.6, 0.55], color: '#3a3a3a' },
        { geo: 'box', pos: [w / 2 - 0.15, 0.3, -0.03], size: [0.07, 0.6, 0.55], color: '#3a3a3a' },
      ];
    case 'artwork':
      // Stone plinth; the 3D relief made from the photo is drawn on top by ArtworkReliefs.
      return [
        { geo: 'box', pos: [0, 0.3, 0], size: [w, 0.6, d], color: c, castShadow: true },
        { geo: 'box', pos: [0, 0.62, d / 2 - 0.15], size: [0.9, 0.04, 0.25], color: '#4a4741' },
      ];
    case 'bus_stop':
      // Shelter: roof, glass back, a blank lit ad panel, a bench inside, two front posts, and a sign pole on the kerb side (+z).
      return [
        { geo: 'box', pos: [0, 2.6, 0], size: [w + 0.2, 0.12, d], color: '#e8e4dc', castShadow: true },
        { geo: 'box', pos: [0, 1.3, -d / 2 + 0.1], size: [w, 2.2, 0.06], color: '#9fb8c4' },
        { geo: 'box', pos: [w / 2 - 0.55, 1.25, -d / 2 + 0.16], size: [0.9, 1.6, 0.06], color: '#f2efe6', mat: 'lamp' },
        { geo: 'box', pos: [-0.3, 0.475, -d / 2 + 0.42], size: [w * 0.55, 0.05, 0.4], color: '#8a6446' },
        { geo: 'box', pos: [-0.3, 0.225, -d / 2 + 0.42], size: [w * 0.5, 0.45, 0.3], color: '#3a3a3a' },
        { geo: 'cyl', pos: [-w / 2 + 0.1, 1.3, d / 2 - 0.1], size: [0.08, 2.6, 0.08], color: '#2f3236' },
        { geo: 'cyl', pos: [w / 2 - 0.1, 1.3, d / 2 - 0.1], size: [0.08, 2.6, 0.08], color: '#2f3236' },
        { geo: 'cyl', pos: [w / 2 + 0.4, 1.5, d / 2 - 0.1], size: [0.1, 3, 0.1], color: '#2f3236' },
        { geo: 'box', pos: [w / 2 + 0.4, 2.9, d / 2 - 0.1], size: [0.6, 0.6, 0.06], color: c, mat: 'lamp' },
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

/**
 * Road joins for every road tile: a side is joined when another road sits one tile (8 m) away in that
 * lateral direction, i.e. the tile is part of a junction, turn or corner.
 */
export function roadJoins(objects: Pick<CityObject, 'id' | 'type' | 'position' | 'rotationY'>[]) {
  const roads = objects.filter((o) => o.type === 'road');
  const near = (x: number, z: number) => roads.some((r) => Math.abs(r.position.x - x) < 1.5 && Math.abs(r.position.z - z) < 1.5);
  const out = new Map<string, RoadJoin>();
  for (const r of roads) {
    // local +x in world space for this tile's rotation
    const lx = Math.cos(r.rotationY), lz = -Math.sin(r.rotationY);
    out.set(r.id, { neg: near(r.position.x - lx * 8, r.position.z - lz * 8), pos: near(r.position.x + lx * 8, r.position.z + lz * 8) });
  }
  return out;
}
