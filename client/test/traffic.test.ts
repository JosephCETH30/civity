// Traffic invariants on real template cities: vehicles never overlap each other or static objects,
// traffic keeps flowing, and buses serve their stops.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OBJECT_INFO, type CityObject, type Template } from '@civitas/shared';
import { generateTemplate } from '../../server/src/templates.ts';
import { TrafficSystem, TICK } from '../src/engine/simulation/traffic.ts';

type Box = { x0: number; x1: number; z0: number; z1: number };
const overlap = (a: Box, b: Box, eps = 0.05) => a.x0 < b.x1 - eps && b.x0 < a.x1 - eps && a.z0 < b.z1 - eps && b.z0 < a.z1 - eps;

function vehicleBox(sys: TrafficSystem, v: TrafficSystem['vehicles'][number]): Box {
  const p = sys.pose(v);
  const alongX = Math.abs(Math.sin(p.r)) > 0.5;
  const hx = alongX ? v.len / 2 : v.w / 2, hz = alongX ? v.w / 2 : v.len / 2;
  return { x0: p.x - hx, x1: p.x + hx, z0: p.z - hz, z1: p.z + hz };
}
function objectBox(o: CityObject): Box {
  const [w, d] = OBJECT_INFO[o.type].footprint;
  const hw = (w * o.scale.x) / 2, hd = (d * o.scale.z) / 2;
  const c = Math.abs(Math.cos(o.rotationY)), s = Math.abs(Math.sin(o.rotationY));
  const ex = hw * c + hd * s, ez = hw * s + hd * c;
  return { x0: o.position.x - ex, x1: o.position.x + ex, z0: o.position.z - ez, z1: o.position.z + ez };
}

function run(template: Template, extra: CityObject[] = [], seconds = 240) {
  const { objects, routes } = generateTemplate(template, 160);
  const all = [...objects.map((o) => ({ ...o, createdBy: null })), ...extra];
  const sys = new TrafficSystem(all, routes, 3);
  const statics = all.filter((o) => o.type !== 'road').map(objectBox);
  const start = sys.vehicles.map((v) => ({ lane: v.lane, s: v.s }));
  const travelled = sys.vehicles.map(() => 0);
  let busDwells = 0;
  for (let t = 0; t < seconds / TICK; t++) {
    const before = sys.vehicles.map((v) => v.s);
    sys.step();
    sys.vehicles.forEach((v, i) => {
      if (v.kind === 'bus' && v.dwell! > 3.9) busDwells++;
      const d = v.s - before[i];
      travelled[i] += d < 0 ? 0 : d;
    });
    const boxes = sys.vehicles.map((v) => vehicleBox(sys, v));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        assert.ok(!overlap(boxes[i], boxes[j]), `t=${(t * TICK).toFixed(2)}s vehicles ${i} (${sys.vehicles[i].kind}) and ${j} (${sys.vehicles[j].kind}) overlap`);
      }
      for (const sb of statics) assert.ok(!overlap(boxes[i], sb), `t=${(t * TICK).toFixed(2)}s vehicle ${i} drives into a static object`);
    }
  }
  return { sys, travelled, busDwells, start };
}

for (const template of ['modern_city', 'transport_hub', 'small_town', 'university_campus'] as const) {
  test(`${template}: no collisions, traffic flows`, () => {
    const { sys, travelled, busDwells } = run(template);
    const cars = sys.vehicles.filter((v) => v.kind === 'car').length;
    assert.ok(cars >= 20, `enough cars spawned (${cars})`);
    const moving = travelled.filter((d) => d > 60).length;
    assert.ok(moving >= sys.vehicles.length * 0.9, `most vehicles keep moving (${moving}/${sys.vehicles.length})`);
    assert.ok(sys.vehicles.some((v) => v.kind === 'bus'), 'route buses exist');
    assert.ok(busDwells > 0, 'buses stop at their stops');
  });
}

test('an object placed on a road cuts the lane instead of being driven through', () => {
  const blocker = { id: 'blocker', type: 'office' as const, position: { x: 0, y: 0, z: -24 }, rotationY: 0, scale: { x: 1, y: 1, z: 1 }, props: { floors: 4 }, createdBy: null };
  run('modern_city', [blocker], 60); // the static-overlap assertion inside run() is the check
});
