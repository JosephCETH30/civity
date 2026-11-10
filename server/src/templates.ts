import { randomUUID } from 'node:crypto';
import { defaultSpec, type CityRoute, type ObjectSpec, type ObjectType, type Template } from '@civitas/shared';

type Seeded = ObjectSpec & { id: string };

/** Deterministic PRNG so templates are reproducible. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MIX: Record<Exclude<Template, 'empty_sandbox'>, [ObjectType, number][]> = {
  modern_city: [['office', 3], ['commercial', 3], ['residential', 4], ['park', 1]],
  small_town: [['residential', 7], ['commercial', 2], ['park', 1]],
  university_campus: [['school', 4], ['residential', 3], ['park', 2], ['office', 1]],
  transport_hub: [['commercial', 4], ['office', 3], ['residential', 2], ['park', 1]],
};
const FLOORS: Partial<Record<ObjectType, [number, number]>> = {
  office: [4, 10], commercial: [1, 3], residential: [2, 4], school: [2, 3], hospital: [3, 5],
};

export function generateTemplate(template: Template, worldSize: number): { objects: Seeded[]; routes: CityRoute[] } {
  const objects: Seeded[] = [];
  const routes: CityRoute[] = [];
  if (template === 'empty_sandbox') return { objects, routes };

  const rand = mulberry32(worldSize * 31 + template.length);
  const add = (type: ObjectType, x: number, z: number, extra: Partial<ObjectSpec> = {}) => {
    const spec = { ...defaultSpec(type, { x, y: 0, z }), ...extra, id: randomUUID() };
    objects.push(spec);
    return spec;
  };

  const half = worldSize / 2;
  const block = template === 'small_town' ? 40 : 48;
  const lines: number[] = [];
  for (let v = -Math.floor((half - 8) / block) * block; v <= half - 8; v += block) lines.push(v);

  // Road grid: 8x8 tiles. One tile at each intersection.
  const roadKeys = new Set<string>();
  for (const line of lines) {
    for (let t = -half + 4; t <= half - 4; t += 8) {
      for (const [x, z, rot] of [[line, t, 0], [t, line, Math.PI / 2]] as const) {
        const sx = Math.round(x / 8) * 8, sz = Math.round(z / 8) * 8;
        const key = `${sx},${sz}`;
        if (roadKeys.has(key)) continue;
        roadKeys.add(key);
        add('road', sx, sz, { rotationY: rot });
      }
    }
  }
  const onRoad = (x: number, z: number, pad: number) =>
    lines.some((l) => Math.abs(x - l) < 4 + pad || Math.abs(z - l) < 4 + pad);

  // Streetlights at intersections.
  for (const a of lines) for (const b of lines) add('streetlight', a + 5, b + 5);

  // Blocks: fill each block with a 2x2 grid of lots.
  const mix = MIX[template];
  const total = mix.reduce((s, [, w]) => s + w, 0);
  const pick = () => {
    let r = rand() * total;
    for (const [t, w] of mix) if ((r -= w) < 0) return t;
    return mix[0][0];
  };
  const cells = [-half, ...lines, half];
  const lots: [number, number][] = [];
  for (let i = 0; i < cells.length - 1; i++) {
    for (let j = 0; j < cells.length - 1; j++) {
      const x0 = cells[i] + 6, x1 = cells[i + 1] - 6, z0 = cells[j] + 6, z1 = cells[j + 1] - 6;
      if (x1 - x0 < 12 || z1 - z0 < 12) continue;
      for (const fx of [0.27, 0.73]) for (const fz of [0.27, 0.73]) lots.push([Math.round(x0 + (x1 - x0) * fx), Math.round(z0 + (z1 - z0) * fz)]);
    }
  }
  // Guarantee one hospital and one school near the center; rest from the template mix.
  lots.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
  lots.forEach(([x, z], i) => {
    const type: ObjectType = i === 0 ? 'park' : i === 1 ? 'hospital' : i === 2 ? 'school' : pick();
    const range = FLOORS[type];
    add(type, x, z, {
      rotationY: rand() < 0.5 ? 0 : Math.PI / 2,
      props: range ? { floors: range[0] + Math.floor(rand() * (range[1] - range[0] + 1)) } : {},
    });
    if (type === 'park') {
      add('tree', x - 3, z - 3); add('tree', x + 3, z + 2); add('bench', x, z + 4);
    }
  });

  // Street trees along road edges.
  for (const line of lines) {
    for (let t = -half + 12; t <= half - 12; t += 16) {
      if (!onRoad(t, line + 7, 1) && rand() < 0.8) add('tree', t, line + 7);
      if (!onRoad(line - 7, t, 1) && rand() < 0.8) add('tree', line - 7, t);
    }
  }

  // Bus stops on the first horizontal road, plus a route connecting them.
  const stops: Seeded[] = [];
  const stopLine = lines[Math.floor(lines.length / 2)] ?? 0;
  const stopCount = template === 'transport_hub' ? 6 : 4;
  for (let k = 0; k < stopCount; k++) {
    const x = Math.round(-half + 16 + ((worldSize - 32) * k) / (stopCount - 1));
    stops.push(add('bus_stop', x, stopLine + 6, { props: { name: `Stop ${String.fromCharCode(65 + k)}` } }));
  }
  routes.push({ id: randomUUID(), name: 'Line 1', transportType: 'bus', stopIds: stops.map((s) => s.id), color: '#2f7de1' });
  if (template === 'transport_hub' && lines.length > 1) {
    const vLine = lines[0];
    const vStops = [0, 1, 2].map((k) =>
      add('bus_stop', vLine + 6, Math.round(-half + 20 + ((worldSize - 40) * k) / 2), { rotationY: Math.PI / 2, props: { name: `Stop ${k + 1}` } }),
    );
    routes.push({ id: randomUUID(), name: 'Line 2', transportType: 'bus', stopIds: vStops.map((s) => s.id), color: '#e0663a' });
  }
  return { objects, routes };
}
