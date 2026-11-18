// Citizen avatar: triangle budget per quality level and stable per-player colours.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BufferGeometry } from 'three';
import { citizenColors, citizenGeometry } from '../src/engine/objects/Avatar';

const PAIRED = ['upperArm', 'forearm', 'thigh', 'shin']; // left + right use the same geometry
const tris = (set: Record<string, BufferGeometry>) =>
  Object.entries(set).reduce((n, [k, g]) => n + ((g.index?.count ?? g.attributes.position.count) / 3) * (PAIRED.includes(k) ? 2 : 1), 0);

test('Citizen stays inside the triangle budget (Low <= 800)', () => {
  const col = citizenColors('#3b77c9', 'user-1');
  const low = tris(citizenGeometry(col, 'low'));
  const high = tris(citizenGeometry(col, 'high'));
  assert.ok(low <= 800, `low ${low}`);
  assert.ok(high > low && high <= 2500, `high ${high}`);
});

test('Citizen colours: trousers differ from the jacket, shoes from the trousers, and are the same for every viewer', () => {
  const col = citizenColors('#3b77c9', 'user-1');
  assert.notEqual(col.trousers, col.jacket);
  assert.notEqual(col.shoes, col.trousers);
  assert.deepEqual(citizenColors('#3b77c9', 'user-1'), col);
});
