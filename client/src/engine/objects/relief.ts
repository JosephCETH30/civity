// Photo -> 3D relief. A dense plane is displaced per vertex by the AI depth map (brighter = closer), then normals
// are recomputed so the sculpture is lit like real geometry instead of a flat picture.
import * as THREE from 'three';

export const RELIEF_WIDTH = 2.6; // metres; fits the 3 m plinth

/** Read a depth image into a 0..1 float grid (red channel of a grayscale image). */
export function depthGrid(img: CanvasImageSource & { width: number; height: number }) {
  const w = img.width, h = img.height;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, w, h).data;
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = px[i * 4] / 255;
  return { w, h, data: out };
}

/** Bilinear sample of the depth grid at uv in [0,1] (v = 0 at the bottom, as in plane UVs). */
function sample(g: ReturnType<typeof depthGrid>, u: number, v: number) {
  const x = Math.min(g.w - 1, Math.max(0, u * (g.w - 1)));
  const y = Math.min(g.h - 1, Math.max(0, (1 - v) * (g.h - 1)));
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(g.w - 1, x0 + 1), y1 = Math.min(g.h - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  const a = g.data[y0 * g.w + x0], b = g.data[y0 * g.w + x1], c = g.data[y1 * g.w + x0], d = g.data[y1 * g.w + x1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

/**
 * Relief geometry: width RELIEF_WIDTH, height from the photo aspect, origin at the bottom centre,
 * displaced towards +z by depth * depthScale. `segments` is the grid resolution along the longer side.
 */
export function reliefGeometry(g: ReturnType<typeof depthGrid>, aspect: number, depthScale: number, segments: number) {
  const w = RELIEF_WIDTH;
  const h = Math.min(3.4, w / aspect);
  const sx = aspect >= 1 ? segments : Math.max(8, Math.round(segments * aspect));
  const sy = aspect >= 1 ? Math.max(8, Math.round(segments / aspect)) : segments;
  const geo = new THREE.PlaneGeometry(w * Math.min(1, (h * aspect) / w), h, sx, sy).translate(0, h / 2, 0);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setZ(i, sample(g, uv.getX(i), uv.getY(i)) * depthScale);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}
