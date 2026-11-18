// Merge primitive pieces into one geometry with per-vertex colours, so one shared material can draw a multi-colour
// object in a single draw call (avatars, vehicles).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type Piece = { geo: THREE.BufferGeometry; color: string; pos?: [number, number, number]; scale?: [number, number, number]; rot?: [number, number, number] };

/** Merge pieces into one geometry with a per-vertex colour (linear) so one shared material draws them all. */
export function merged(pieces: Piece[]) {
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
  const geos = pieces.map((p) => {
    const g = p.geo; // every piece is a fresh geometry, so transform it in place
    g.deleteAttribute('uv');
    q.setFromEuler(new THREE.Euler(...(p.rot ?? [0, 0, 0])));
    g.applyMatrix4(m.compose(new THREE.Vector3(...(p.pos ?? [0, 0, 0])), q, new THREE.Vector3(...(p.scale ?? [1, 1, 1]))));
    c.set(p.color);
    const n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  });
  const out = mergeGeometries(geos)!;
  geos.forEach((g) => g.dispose());
  out.computeBoundingSphere();
  return out;
}
