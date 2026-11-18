// Instancing rule: every object of a type has the same number of parts, whatever its props, id or road joins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OBJECT_TYPES, STYLES } from '@civitas/shared';
import { partsFor } from '../src/engine/objects/parts';

test('part count per type is constant for every style, floor count, colour, id and road join', () => {
  for (const type of OBJECT_TYPES) {
    const base = partsFor({ type, props: {} }).length;
    for (const style of [undefined, ...STYLES]) {
      for (const floors of [1, 3, 12, 40]) {
        for (const id of ['a', 'b7f3', 'zz-99']) {
          for (const join of [undefined, { neg: true, pos: false }, { neg: true, pos: true }]) {
            const n = partsFor({ type, id, props: { style, floors, color: '#a0b0c0' } }, join).length;
            assert.equal(n, base, `${type} style=${style} floors=${floors} id=${id} join=${JSON.stringify(join)}`);
          }
        }
      }
    }
  }
});

test('the facade shader lines up: facade parts start on a floor and are whole floors tall', () => {
  for (const type of OBJECT_TYPES) {
    for (const style of [undefined, ...STYLES]) {
      for (const floors of [1, 2, 3, 6, 12]) {
        for (const p of partsFor({ type, props: { style, floors } })) {
          if (p.mat !== 'facade' || p.size[1] === 0) continue;
          const bottom = p.pos[1] - p.size[1] / 2;
          assert.ok(Math.abs(bottom / 3 - Math.round(bottom / 3)) < 1e-6, `${type}/${style}/${floors}: facade starts at ${bottom}`);
          assert.ok(Math.abs(p.size[1] / 3 - Math.round(p.size[1] / 3)) < 1e-6, `${type}/${style}/${floors}: facade height ${p.size[1]}`);
        }
      }
    }
  }
});
