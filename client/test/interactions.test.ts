// Gameplay rules for the local player: collision, doors, interiors, seats, jumping.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Browser APIs the store touches at import time.
(globalThis as any).matchMedia ??= () => ({ matches: false });

const { INTERIOR_DEPTH, defaultSpec } = await import('@civitas/shared');
const { useWorld } = await import('../src/stores/world.ts');
const { localPlayer, input } = await import('../src/engine/core/transient.ts');
const ix = await import('../src/engine/core/interactions.ts');

const house = { ...defaultSpec('residential', { x: 0, y: 0, z: 0 }), id: 'house', createdBy: null }; // 6x6, door faces +z
const bench = { ...defaultSpec('bench', { x: 20, y: 0, z: 0 }), id: 'bench', createdBy: null };
useWorld.getState().set({ objects: { house, bench } });

const place = (x: number, z: number) => Object.assign(localPlayer, { x, z, y: 0, vy: 0, inside: null, seat: null, a: 'idle' });
const walk = (x: number, z: number, seconds: number) => {
  Object.assign(input, { x, z, joyX: 0, joyZ: 0, run: false });
  for (let t = 0; t < seconds; t += 1 / 60) ix.stepLocalPlayer(1 / 60, 0, 200);
  Object.assign(input, { x: 0, z: 0 });
};

test('buildings are solid', () => {
  place(0, 10);
  walk(0, -1, 3); // walk straight at the front wall (camera yaw 0: input z -1 = toward -z)
  assert.ok(localPlayer.z >= 3 + 0.35 - 1e-6, `stopped at the wall, z=${localPlayer.z}`);
});

test('enter through the door, walls inside, leave again', () => {
  place(0, 3.9);
  assert.match(ix.availableAction()?.label ?? '', /Enter residential/);
  ix.interact();
  assert.equal(localPlayer.inside, 'house');
  assert.equal(localPlayer.y, INTERIOR_DEPTH);
  assert.equal(useWorld.getState().inside, 'house');
  walk(0, -1, 3); // toward the back wall
  assert.ok(localPlayer.z > -3, `kept inside the room, z=${localPlayer.z}`);
  assert.equal(localPlayer.y, INTERIOR_DEPTH, 'stays on the interior floor');
  walk(0, 1, 3); // back to the door
  assert.equal(ix.availableAction()?.label, 'Go outside');
  ix.interact();
  assert.equal(localPlayer.inside, null);
  assert.equal(localPlayer.y, 0);
  assert.ok(localPlayer.z > 3, 'outside, in front of the door');
});

test('sit on a sofa inside', () => {
  place(0, 3.9);
  ix.interact();
  // sofa seats are at the back wall
  Object.assign(localPlayer, { x: -0.55, z: -2.85 + 0.6 });
  assert.equal(ix.availableAction()?.label, 'Sit down');
  ix.interact();
  assert.equal(localPlayer.a, 'sit');
  assert.ok(localPlayer.seat);
  walk(0, 1, 0.1); // any movement stands you up
  assert.equal(localPlayer.seat, null);
  ix.resetPlayerState();
});

test('sit on a bench and stand up', () => {
  place(20.3, 0.8);
  assert.equal(ix.availableAction()?.label, 'Sit on bench');
  ix.interact();
  assert.equal(localPlayer.a, 'sit');
  assert.equal(ix.availableAction()?.label, 'Stand up');
  ix.interact();
  assert.equal(localPlayer.seat, null);
});

test('jump goes up and lands', () => {
  place(40, 40);
  ix.jump();
  let peak = 0;
  for (let i = 0; i < 120; i++) { ix.stepLocalPlayer(1 / 60, 0, 200); peak = Math.max(peak, localPlayer.y); if (i === 10) assert.equal(localPlayer.a, 'jump'); }
  assert.ok(peak > 0.8 && peak < 1.5, `peak ${peak}`);
  assert.equal(localPlayer.y, 0);
  assert.equal(localPlayer.a, 'idle');
});

test('deleting the building you are in puts you back outside', () => {
  place(0, 3.9);
  ix.interact();
  useWorld.getState().set({ objects: { bench } });
  ix.stepLocalPlayer(1 / 60, 0, 200);
  assert.equal(localPlayer.inside, null);
  assert.equal(localPlayer.y, 0);
});

test('a moving car knocks you down and out of its lane; a stopped one is just solid', async () => {
  const { trafficRef } = await import('../src/engine/simulation/traffic.ts');
  useWorld.getState().set({ objects: {} });
  const car = { kind: 'car', v: 8, len: 4.4, w: 1.9 };
  trafficRef.current = { vehicles: [car], pose: () => ({ x: 50, z: 50, r: 0, scale: 1 }) } as any; // heading +z
  place(50.3, 50.5); // standing in the car's path, slightly to its right-hand side... x > car.x
  ix.stepLocalPlayer(1 / 60, 0, 200);
  assert.equal(localPlayer.a, 'fall');
  assert.equal(ix.availableAction(), null, 'no actions while knocked down');
  for (let i = 0; i < 60; i++) ix.stepLocalPlayer(1 / 60, 0, 200);
  assert.ok(Math.abs(localPlayer.x - 50) > 1.3, `thrown sideways out of the lane (x=${localPlayer.x.toFixed(2)})`);
  for (let i = 0; i < 120; i++) ix.stepLocalPlayer(1 / 60, 0, 200);
  assert.equal(localPlayer.a, 'idle', 'gets back up');

  car.v = 0;
  place(50.2, 50);
  ix.stepLocalPlayer(1 / 60, 0, 200);
  assert.notEqual(localPlayer.a, 'fall', 'a stopped car does not knock you down');
  assert.ok(Math.abs(localPlayer.x - 50) >= 0.95 + 0.35 - 1e-6 || Math.abs(localPlayer.z - 50) >= 2.2 + 0.35 - 1e-6, 'pushed out of the car body');
  trafficRef.current = null;
});
