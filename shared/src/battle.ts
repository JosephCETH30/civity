// PvP blaster battle: opt-in, free for all. The server is the referee: it checks every shot against the positions
// it knows (players and buildings) and owns health, kills and respawns. Clients only aim and draw.

export const BATTLE = {
  maxHp: 100,
  damage: 25, // 4 hits
  headshot: 50, // hit in the top 0.35 m
  range: 80,
  cooldownMs: 280,
  respawnMs: 3000,
  radius: 0.6, // hit cylinder (a bit generous: positions are ~100 ms old)
  height: 1.9,
} as const;

/** Object types that block shots (the solid buildings). */
export const SOLID_TYPES: readonly string[] = ['residential', 'office', 'commercial', 'school', 'hospital'];

export interface BattleStats { hp: number; kills: number; deaths: number; deadUntil: number }

export interface Box { cx: number; cz: number; cos: number; sin: number; hw: number; hd: number; h: number }

/**
 * Distance along the ray (o + t*d, |d| = 1) to where it enters a vertical cylinder at (px, py, pz), or null.
 * Returns which part was hit: the top 0.35 m counts as the head.
 */
export function rayCylinder(o: [number, number, number], d: [number, number, number], px: number, py: number, pz: number, r: number, h: number) {
  const ox = o[0] - px, oz = o[2] - pz;
  const a = d[0] * d[0] + d[2] * d[2];
  if (a < 1e-9) return null;
  const b = 2 * (ox * d[0] + oz * d[2]);
  const c = ox * ox + oz * oz - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  for (const t of [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]) {
    if (t < 0) continue;
    const y = o[1] + d[1] * t - py;
    if (y >= 0 && y <= h) return { t, head: y > h - 0.35 };
  }
  return null;
}

/** Distance along the ray to an oriented box (building) standing on the ground, or null. Slab method in local frame. */
export function rayBox(o: [number, number, number], d: [number, number, number], b: Box) {
  const dx = o[0] - b.cx, dz = o[2] - b.cz;
  // world -> local (same convention as the client: local +z is the building front)
  const lo = [dx * b.cos - dz * b.sin, o[1], dx * b.sin + dz * b.cos];
  const ld = [d[0] * b.cos - d[2] * b.sin, d[1], d[0] * b.sin + d[2] * b.cos];
  const min = [-b.hw, 0, -b.hd], max = [b.hw, b.h, b.hd];
  let t0 = 0, t1 = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(ld[i]) < 1e-9) {
      if (lo[i] < min[i] || lo[i] > max[i]) return null;
      continue;
    }
    let a = (min[i] - lo[i]) / ld[i], c = (max[i] - lo[i]) / ld[i];
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, c);
    if (t0 > t1) return null;
  }
  return t0;
}
