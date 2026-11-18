// Undo of my city edits: add -> delete, change -> previous transform/props, delete -> object back.
import { test } from 'node:test';
import assert from 'node:assert/strict';

(globalThis as any).matchMedia ??= () => ({ matches: false });
const { realtime } = await import('../src/services/realtime');
const { useWorld } = await import('../src/stores/world');
const { addObject, deleteObject, onObjectAdded, undo, updateObject, resetUndo } = await import('../src/services/editor');
const { defaultSpec } = await import('@civitas/shared');

const sent: any[] = [];
(realtime as any).send = (m: any) => sent.push(m);

test('undo reverses add, change and delete, newest first', () => {
  resetUndo();
  useWorld.getState().set({ self: { sessionId: 's', userId: 'me', role: 'owner' } });
  const spec = defaultSpec('office', { x: 4, y: 0, z: 8 });
  addObject(spec);
  const obj = { ...spec, id: 'o1', createdBy: 'me', rotationX: 0, rotationZ: 0 };
  useWorld.getState().set({ objects: { o1: obj } });
  onObjectAdded(obj);
  updateObject(obj, { position: { x: 10, y: 3, z: 8 }, rotationX: 0.5 });
  deleteObject(obj);
  assert.equal(useWorld.getState().undoCount, 3);

  sent.length = 0;
  undo(); // the delete comes back
  assert.equal(sent[0].t, 'obj_add');
  assert.deepEqual(sent[0].spec.position, { x: 4, y: 0, z: 8 });
  undo(); // the change is reverted to the earlier transform
  assert.equal(sent[1].t, 'obj_update');
  assert.deepEqual(sent[1].patch.position, { x: 4, y: 0, z: 8 });
  assert.equal(sent[1].patch.rotationX, 0);
  undo(); // the add is removed
  assert.deepEqual(sent[2], { t: 'obj_delete', id: 'o1' });
  assert.equal(useWorld.getState().undoCount, 0);
  undo(); // nothing left: no message
  assert.equal(sent.length, 3);
});

test('undoing a delete does not itself become an undoable add', () => {
  resetUndo();
  const obj = { ...defaultSpec('tree', { x: 0, y: 0, z: 0 }), id: 't1', createdBy: 'me' };
  useWorld.getState().set({ objects: { t1: obj } });
  deleteObject(obj);
  undo();
  onObjectAdded({ ...obj, id: 't2' }); // server echo of the restored tree
  assert.equal(useWorld.getState().undoCount, 0);
});
