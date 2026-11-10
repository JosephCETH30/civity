import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OBJECT_INFO, TEMPLATES } from '@civitas/shared';
import { generateTemplate } from '../src/templates.ts';
import { safeSpawn } from '../src/realtime.ts';

test('players never spawn on a road or inside an object', () => {
  for (const t of TEMPLATES) {
    const objects = generateTemplate(t, 160).objects.map((o) => ({ ...o, createdBy: null }));
    for (let i = 0; i < 20; i++) {
      const [x, , z] = safeSpawn(objects, 160);
      for (const o of objects) {
        if (o.type === 'park') continue;
        const [w, d] = OBJECT_INFO[o.type].footprint;
        const c = Math.cos(o.rotationY), s = Math.sin(o.rotationY);
        const dx = x - o.position.x, dz = z - o.position.z;
        const inside = Math.abs(dx * c - dz * s) < (w * o.scale.x) / 2 && Math.abs(dx * s + dz * c) < (d * o.scale.z) / 2;
        assert.ok(!inside, `${t}: spawn (${x}, ${z}) is inside a ${o.type}`);
      }
    }
  }
});
