// Traffic model: cars and buses that never overlap each other or static objects.
//  - Lanes come from straight runs of road tiles (left-hand traffic, as in Indonesia), split wherever an
//    object sits on the lane, so nothing drives through a building, tree or bench placed on a road.
//  - Car following: a vehicle never closes to less than GAP metres behind the one ahead in its lane.
//  - Intersections: two-phase signals with an all-red clearance; a vehicle only crosses its stop line with
//    enough green left AND room on the far side, so nothing ever waits inside a junction.
//  - Buses use the same lanes and rules, dwell at their stops and turn back at the end of the line.
// Pure data + a fixed-timestep step(), so it is unit-testable without WebGL.
// shortcut: runs locally on each client (not bit-identical across clients); fine for ambient traffic.
import { OBJECT_INFO, type CityObject, type CityRoute } from '@civitas/shared';

export const TICK = 0.05;
const ACCEL = 5;
const GAP = 2.5; // minimum bumper-to-bumper distance
const STOP_BACK = 5.5; // stop line is this far before an intersection centre
const CYCLE = 24, GREEN = 10, CLEAR = 2; // x green 0-10, all red 10-12, z green 12-22, all red 22-24
const MIN_GREEN_TO_ENTER = 2.6;
const BRAKE = 7; // comfortable deceleration used to plan stops (m/s²)
const JUNCTION_HALF = 4; // a junction is the 8x8 m crossing tile

const BUS_DWELL = 4;
export const CAR = { len: 4.4, w: 1.9, vmax: 9 };
const END_MARGIN = 3; // keeps a car's half length (2.2 m) plus 0.8 m clear of a lane's cut ends
export const BUS = { len: 7.2, w: 2.5, vmax: 7 };

export type Axis = 'x' | 'z';
export interface Lane {
  id: number;
  axis: Axis;
  dir: 1 | -1;
  c: number; // lateral coordinate of the lane centre line
  from: number; // along-axis coordinate where s = 0 (dir 1) / where s = L (dir -1)
  L: number;
  run: number; // index of the road run this lane belongs to
  stops: number[]; // stop-line positions in s, ascending
}
export interface Vehicle {
  id: number;
  kind: 'car' | 'bus';
  lane: number;
  s: number; // centre position along the lane
  v: number;
  len: number;
  w: number;
  color: string;
  // buses only
  targets?: number[]; // remaining stop positions on this lane (ascending s)
  dwell?: number;
  route?: { stops: { run: number; along: number }[] };
}

interface Run { axis: Axis; c: number; a0: number; a1: number } // tile centres a0..a1 along the axis

/** Highest speed that still stops within distance d (never overshoots in one tick). */
const stopSpeed = (d: number) => (d <= 0 ? 0 : Math.min(Math.sqrt(2 * BRAKE * d), d / TICK));

const key = (x: number, z: number) => `${Math.round(x)},${Math.round(z)}`;

/** Straight runs of road tiles (>= 3 tiles), independent of each tile's rotation. */
function findRuns(roads: CityObject[]): { runs: Run[]; tiles: Set<string> } {
  const tiles = new Set(roads.map((r) => key(r.position.x, r.position.z)));
  const runs: Run[] = [];
  for (const axis of ['x', 'z'] as const) {
    const lines = new Map<number, number[]>();
    for (const r of roads) {
      const c = Math.round(axis === 'x' ? r.position.z : r.position.x);
      const a = Math.round(axis === 'x' ? r.position.x : r.position.z);
      lines.set(c, [...(lines.get(c) ?? []), a]);
    }
    for (const [c, list] of lines) {
      const sorted = [...new Set(list)].sort((p, q) => p - q);
      let start = 0;
      for (let i = 1; i <= sorted.length; i++) {
        if (i === sorted.length || sorted[i] - sorted[i - 1] > 9) {
          if (i - start >= 3) runs.push({ axis, c, a0: sorted[start], a1: sorted[i - 1] });
          start = i;
        }
      }
    }
  }
  return { runs, tiles };
}

/** Along-axis interval an object's footprint covers on a lane band [c - halfW, c + halfW], or null. */
function blockInterval(o: CityObject, axis: Axis, c: number, halfW: number): [number, number] | null {
  const [fw, fd] = OBJECT_INFO[o.type].footprint;
  const hw = (fw * o.scale.x) / 2 + 0.4, hd = (fd * o.scale.z) / 2 + 0.4;
  const cos = Math.abs(Math.cos(o.rotationY)), sin = Math.abs(Math.sin(o.rotationY));
  const ex = hw * cos + hd * sin, ez = hw * sin + hd * cos; // axis-aligned half extents of the rotated box
  const lat = axis === 'x' ? o.position.z : o.position.x, latE = axis === 'x' ? ez : ex;
  if (Math.abs(lat - c) > latE + halfW) return null;
  const along = axis === 'x' ? o.position.x : o.position.z, alongE = axis === 'x' ? ex : ez;
  return [along - alongE, along + alongE];
}

const STATIC_BLOCKERS = new Set(['residential', 'office', 'commercial', 'school', 'hospital', 'park', 'tree', 'streetlight', 'bench', 'bus_stop', 'artwork']);

export function heading(l: Lane) {
  return l.axis === 'x' ? (l.dir === 1 ? Math.PI / 2 : -Math.PI / 2) : l.dir === 1 ? 0 : Math.PI;
}
/** World position of a point at distance s along a lane. */
export function lanePoint(l: Lane, s: number) {
  const along = l.dir === 1 ? l.from + s : l.from + l.L - s;
  return l.axis === 'x' ? { x: along, z: l.c } : { x: l.c, z: along };
}
const alongToS = (l: Lane, along: number) => (l.dir === 1 ? along - l.from : l.from + l.L - along);

/** The traffic currently on screen, for player collisions (set by the Transit component). */
export const trafficRef: { current: TrafficSystem | null } = { current: null };

export class TrafficSystem {
  lanes: Lane[] = [];
  vehicles: Vehicle[] = [];
  time = 0;
  private runs: Run[] = [];

  constructor(objects: CityObject[], routes: CityRoute[], carsPer100m: number) {
    const roads = objects.filter((o) => o.type === 'road');
    const statics = objects.filter((o) => STATIC_BLOCKERS.has(o.type));
    const { runs, tiles } = findRuns(roads);
    this.runs = runs;

    runs.forEach((run, ri) => {
      // Intersections on this run: perpendicular runs that share a tile with it.
      const crossings = runs
        .filter((o) => o.axis !== run.axis && o.c >= run.a0 - 0.5 && o.c <= run.a1 + 0.5 && run.c >= o.a0 - 0.5 && run.c <= o.a1 + 0.5)
        .filter((o) => (run.axis === 'x' ? tiles.has(key(o.c, run.c)) : tiles.has(key(run.c, o.c))))
        .map((o) => o.c);
      for (const dir of [1, -1] as const) {
        // Left-hand traffic: the lane sits on the driver's left.
        const c = run.axis === 'x' ? run.c - dir * 1.5 : run.c + dir * 1.5;
        // Free along-intervals of the lane, after cutting out anything standing on it.
        let free: [number, number][] = [[run.a0 - 4, run.a1 + 4]];
        for (const o of statics) {
          const b = blockInterval(o, run.axis, c, 1.2);
          if (!b) continue;
          free = free.flatMap(([p, q]) => {
            if (b[1] <= p || b[0] >= q) return [[p, q]];
            const out: [number, number][] = [];
            if (b[0] > p) out.push([p, b[0]]);
            if (b[1] < q) out.push([b[1], q]);
            return out;
          });
        }
        for (let [p, q] of free) {
          // A junction too close to a lane end cannot be signalled (no room to stop before or clear after it):
          // cut the lane short of it. Then keep vehicle bodies off the cut edges (END_MARGIN).
          const room = JUNCTION_HALF + STOP_BACK + CAR.len;
          for (const k of [...crossings].sort((m, n) => m - n)) {
            if (k <= p || k >= q) continue;
            if (k - p < room) p = k + JUNCTION_HALF;
            else if (q - k < room) q = k - JUNCTION_HALF;
          }
          p += END_MARGIN;
          q -= END_MARGIN;
          if (q - p < 16) continue;
          const lane: Lane = { id: this.lanes.length, axis: run.axis, dir, c, from: p, L: q - p, run: ri, stops: [] };
          lane.stops = crossings
            .filter((k) => k > p && k < q)
            .map((k) => alongToS(lane, k) - STOP_BACK)
            .sort((m, n) => m - n);
          this.lanes.push(lane);
        }
      }
    });

    this.placeBuses(routes, objects);
    this.placeCars(carsPer100m);
  }

  /** Buses run on one road: the run that all of a route's stops sit beside. Other routes get no bus. */
  private placeBuses(routes: CityRoute[], objects: CityObject[]) {
    const byId = new Map(objects.map((o) => [o.id, o]));
    for (const r of routes) {
      const stops = r.stopIds.map((id) => byId.get(id)).filter((o): o is CityObject => !!o);
      if (stops.length < 2) continue;
      const ri = this.runs.findIndex((run) =>
        stops.every((s) => {
          const lat = run.axis === 'x' ? s.position.z : s.position.x, along = run.axis === 'x' ? s.position.x : s.position.z;
          return Math.abs(lat - run.c) <= 9 && along >= run.a0 - 4 && along <= run.a1 + 4;
        }),
      );
      if (ri < 0) continue;
      const run = this.runs[ri];
      const along = stops.map((s) => (run.axis === 'x' ? s.position.x : s.position.z));
      const lane = this.lanes.find((l) => l.run === ri && l.dir === 1 && along.every((a) => alongToS(l, a) > BUS.len && alongToS(l, a) < l.L - BUS.len));
      if (!lane) continue;
      const targets = along.map((a) => this.clearOfJunctions(lane, alongToS(lane, a))).sort((p, q) => p - q);
      this.vehicles.push({
        id: this.vehicles.length, kind: 'bus', lane: lane.id, s: targets[0], v: 0, len: BUS.len, w: BUS.w, color: r.color,
        targets: targets.slice(1), dwell: BUS_DWELL, route: { stops: along.map((a) => ({ run: ri, along: a })) },
      });
    }
  }

  private placeCars(per100m: number) {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const colors = ['#f4f2ee', '#2f3236', '#b8532e', '#5b7f99', '#9aa0a6', '#d9c7a0'];
    for (const lane of this.lanes) {
      const n = Math.floor((lane.L / 100) * per100m);
      for (let k = 0; k < n; k++) {
        const s = ((k + 0.3 + rnd() * 0.4) / n) * lane.L;
        // never start inside a junction or on top of another vehicle
        if (lane.stops.some((st) => s > st - CAR.len && s < st + 2 * STOP_BACK + CAR.len)) continue;
        if (this.vehicles.some((v) => v.lane === lane.id && Math.abs(v.s - s) < (v.len + CAR.len) / 2 + GAP)) continue;
        if (s < CAR.len || s > lane.L - CAR.len) continue;
        this.vehicles.push({ id: this.vehicles.length, kind: 'car', lane: lane.id, s, v: 0, len: CAR.len, w: CAR.w, color: colors[this.vehicles.length % colors.length] });
      }
    }
  }

  /** Seconds of green left for an axis at the current time (0 when red). */
  greenLeft(axis: Axis) {
    const p = ((this.time % CYCLE) + CYCLE) % CYCLE;
    if (axis === 'x') return p < GREEN ? GREEN - p : 0;
    return p >= GREEN + CLEAR && p < 2 * GREEN + CLEAR ? 2 * GREEN + CLEAR - p : 0;
  }

  step() {
    this.time += TICK;
    const byLane = new Map<number, Vehicle[]>();
    for (const v of this.vehicles) {
      const list = byLane.get(v.lane);
      if (list) list.push(v);
      else byLane.set(v.lane, [v]);
    }
    for (const list of byLane.values()) list.sort((a, b) => a.s - b.s);

    // Process each lane from the front vehicle backwards so followers react to updated leaders.
    for (const [laneId, list] of byLane) {
      const lane = this.lanes[laneId];
      for (let i = list.length - 1; i >= 0; i--) {
        const veh = list[i];
        const leader = list.length > 1 ? (i < list.length - 1 ? list[i + 1] : list[0]) : null;
        const leaderS = leader ? (i < list.length - 1 ? leader.s : leader.s + lane.L) : Infinity; // ring for cars
        const isBus = veh.kind === 'bus';
        let vmax = isBus ? BUS.vmax : CAR.vmax;

        let limit = vmax;
        if (leader && !(isBus && i === list.length - 1)) {
          const gap = leaderS - veh.s - (leader.len + veh.len) / 2;
          limit = Math.min(limit, stopSpeed(gap - GAP));
        }
        // Signals at the next stop line the front bumper has not passed.
        const front = veh.s + veh.len / 2;
        const st = lane.stops.find((x) => x >= front - 0.05);
        if (st !== undefined) {
          const farSide = st + 2 * STOP_BACK;
          const roomBeyond = !leader || leaderS - leader.len / 2 - farSide >= veh.len + GAP || leaderS < st;
          const go = this.greenLeft(lane.axis) > MIN_GREEN_TO_ENTER && roomBeyond;
          if (!go) limit = Math.min(limit, stopSpeed(st - front));
        }
        if (isBus) {
          if (veh.dwell! > 0) { veh.dwell! -= TICK; veh.v = 0; continue; }
          const target = veh.targets![0];
          if (target === undefined) { this.turnBus(veh); continue; }
          limit = Math.min(limit, stopSpeed(target - veh.s));
          if (target - veh.s < 0.05) { veh.targets!.shift(); veh.dwell = BUS_DWELL; veh.v = 0; continue; }
        }
        veh.v = Math.min(limit, veh.v + ACCEL * TICK);
        veh.s += veh.v * TICK;
        if (!isBus && veh.s > lane.L) veh.s -= lane.L; // cars loop the lane segment
      }
    }
  }

  /** Move a bus stop target forward if the bus body would sit inside a junction while dwelling. */
  private clearOfJunctions(lane: Lane, t: number) {
    for (const st of lane.stops) {
      const j0 = st, j1 = st + 2 * STOP_BACK; // from stop line to the far side of the junction
      if (t + BUS.len / 2 > j0 - 0.5 && t - BUS.len / 2 < j1 + 0.5) t = j1 + BUS.len / 2 + 1;
    }
    return Math.min(t, lane.L - BUS.len / 2);
  }

  /** End of the line: move the bus to the opposite lane of the same road if there is room. */
  private turnBus(bus: Vehicle) {
    const cur = this.lanes[bus.lane];
    const along = cur.dir === 1 ? cur.from + bus.s : cur.from + cur.L - bus.s;
    const opp = this.lanes.find((l) => l.run === cur.run && l.dir === -cur.dir && along >= l.from && along <= l.from + l.L);
    if (!opp) return;
    const s = alongToS(opp, along);
    const clear = this.vehicles.every((v) => v.lane !== opp.id || Math.abs(v.s - s) > (v.len + bus.len) / 2 + GAP + 2);
    if (!clear) return;
    const targets = bus.route!.stops.map((p) => this.clearOfJunctions(opp, alongToS(opp, p.along))).filter((t) => t > s + 0.5).sort((p, q) => p - q);
    Object.assign(bus, { lane: opp.id, s, v: 0, targets, dwell: 1 });
  }

  /** World-space pose of a vehicle, plus a 0..1 scale that fades cars in/out at the open ends of a lane. */
  pose(v: Vehicle) {
    const lane = this.lanes[v.lane];
    const p = lanePoint(lane, v.s);
    const edge = v.kind === 'car' ? Math.min(1, Math.max(0, (Math.min(v.s, lane.L - v.s) - 1) / 3)) : 1;
    return { x: p.x, z: p.z, r: heading(lane), scale: edge };
  }
}
