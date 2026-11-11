// PvP blaster battle referee. Opt-in, free for all. Every shot is checked here against the last positions the server
// knows (players as cylinders, buildings as boxes), so a modified client cannot hit through walls or from afar.
import { BATTLE, SOLID_TYPES, OBJECT_INFO, rayBox, rayCylinder, type BattleStats, type Box, type CityObject, type ServerMessage } from '@civitas/shared';

type Vec = [number, number, number];
interface Shooter { id: string; name: string; p: Vec }

const FLOOR_H = 3;

export class Battle {
  stats = new Map<string, BattleStats>();
  private lastShot = new Map<string, number>();
  private timers = new Set<NodeJS.Timeout>();

  constructor(
    private broadcast: (m: ServerMessage) => void,
    private spawn: () => Vec,
  ) {}

  dispose() { for (const t of this.timers) clearTimeout(t); }

  roster(): ServerMessage { return { t: 'battle', stats: Object.fromEntries(this.stats) }; }

  join(id: string) {
    if (!this.stats.has(id)) this.stats.set(id, { hp: BATTLE.maxHp, kills: 0, deaths: 0, deadUntil: 0 });
    this.broadcast(this.roster());
  }

  leave(id: string) {
    if (!this.stats.delete(id)) return;
    this.lastShot.delete(id);
    this.broadcast(this.roster());
  }

  /**
   * Validate and resolve a shot. `players` are everyone in the room (positions from their last move message).
   * Returns false when the shot was ignored (not in battle, dead, too fast, origin too far from the shooter).
   */
  shoot(from: Shooter, o: Vec, d: Vec, players: Shooter[], objects: Iterable<CityObject>, now: number) {
    const me = this.stats.get(from.id);
    if (!me || me.deadUntil > now) return false;
    if (o[1] < 0) return false; // no battles inside building interiors
    if (now - (this.lastShot.get(from.id) ?? 0) < BATTLE.cooldownMs) return false;
    // The muzzle must be at the shooter (allow for movement since the last position update).
    if (Math.hypot(o[0] - from.p[0], o[2] - from.p[2]) > 2.5 || Math.abs(o[1] - from.p[1] - 1.3) > 2) return false;
    const len = Math.hypot(d[0], d[1], d[2]);
    if (len < 0.5 || len > 1.5) return false;
    const dir: Vec = [d[0] / len, d[1] / len, d[2] / len];
    this.lastShot.set(from.id, now);

    // Nearest blocker: ground, buildings.
    let reach: number = BATTLE.range;
    if (dir[1] < -1e-6) reach = Math.min(reach, -o[1] / dir[1]);
    for (const b of boxes(objects)) {
      if (Math.abs(b.cx - o[0]) > BATTLE.range + 20 || Math.abs(b.cz - o[2]) > BATTLE.range + 20) continue;
      const t = rayBox(o, dir, b);
      if (t !== null && t < reach) reach = t;
    }
    // Nearest living opponent in front of that.
    let hit: { id: string; t: number; head: boolean } | null = null;
    for (const p of players) {
      if (p.id === from.id) continue;
      const st = this.stats.get(p.id);
      if (!st || st.deadUntil > now) continue;
      const h = rayCylinder(o, dir, p.p[0], p.p[1], p.p[2], BATTLE.radius, BATTLE.height);
      if (h && h.t < reach && (!hit || h.t < hit.t)) hit = { id: p.id, ...h };
    }
    const end = hit?.t ?? reach;
    const e: Vec = [o[0] + dir[0] * end, o[1] + dir[1] * end, o[2] + dir[2] * end];
    const r = (v: Vec) => v.map((n) => Math.round(n * 100) / 100) as Vec;
    if (!hit) {
      this.broadcast({ t: 'shot', from: from.id, o: r(o), e: r(e) });
      return true;
    }
    const victim = this.stats.get(hit.id)!;
    victim.hp = Math.max(0, victim.hp - (hit.head ? BATTLE.headshot : BATTLE.damage));
    const kill = victim.hp === 0;
    this.broadcast({ t: 'shot', from: from.id, o: r(o), e: r(e), hit: hit.id, hp: victim.hp, kill, head: hit.head });
    if (kill) {
      victim.deaths++;
      victim.deadUntil = now + BATTLE.respawnMs;
      me.kills++;
      this.broadcast(this.roster());
      const id = hit.id;
      const t = setTimeout(() => {
        this.timers.delete(t);
        const st = this.stats.get(id);
        if (!st) return;
        st.hp = BATTLE.maxHp;
        st.deadUntil = 0;
        this.broadcast({ t: 'respawn', id, p: this.spawn() });
        this.broadcast(this.roster());
      }, BATTLE.respawnMs);
      this.timers.add(t);
    }
    return true;
  }
}

// Rebuilt per shot: a city has a few hundred objects at most and shots are rate limited.
function* boxes(objects: Iterable<CityObject>): Generator<Box> {
  for (const o of objects) {
    if (!SOLID_TYPES.includes(o.type)) continue;
    const [w, d] = OBJECT_INFO[o.type].footprint;
    const floors = Number(o.props.floors ?? OBJECT_INFO[o.type].floors ?? 1);
    yield { cx: o.position.x, cz: o.position.z, cos: Math.cos(o.rotationY), sin: Math.sin(o.rotationY), hw: (w * o.scale.x) / 2, hd: (d * o.scale.z) / 2, h: floors * FLOOR_H * o.scale.y };
  }
}
