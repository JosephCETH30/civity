// High-frequency state kept OUT of React. The render loop reads it directly every frame.
import type { AnimState } from '@civitas/shared';

export interface RemoteTarget {
  x: number; y: number; z: number; r: number; a: AnimState;
}

/** Latest server-reported pose per remote session id. Rendering interpolates toward it. */
export const remoteTargets = new Map<string, RemoteTarget>();
/** Current rendered (interpolated) pose per remote session — used by spatial audio and 2D map. */
export const remoteRendered = new Map<string, { x: number; z: number }>();

/** Local player pose, mutated by the movement controller. */
export const localPlayer = {
  x: 0, y: 0, z: 4, r: 0, a: 'idle' as AnimState, moved: true,
  vy: 0, // vertical speed while jumping
  inside: null as string | null, // building id when inside an interior
  seat: null as { x: number; z: number; y: number; r: number } | null,
  waveUntil: 0, // performance.now() deadline for the wave emote
  fallUntil: 0, // knocked down by a vehicle until this time
  hitAt: 0, // when the last hit happened (camera shake)
  kx: 0, kz: 0, // knock-back velocity
};

/** Movement input in [-1, 1]; written by keyboard and on-screen joystick. */
export const input = { x: 0, z: 0, run: false, joyX: 0, joyZ: 0 };

/** Renderer measurements, updated once per second by the 3D view. */
export const perf = { fps: 0, calls: 0, tris: 0 };

/** Recent shots to draw as tracers (performance.now() timestamps). */
export const shots: { o: [number, number, number]; e: [number, number, number]; at: number; hit: boolean }[] = [];
/** Last time I hit someone (crosshair hit marker) and the last time I was hit (red screen flash). */
export const battleFx = { hitAt: 0, hurtAt: 0 };

/** Placement ghost position (snapped) for the 3D editor; null if pointer is off the ground. */
export const ghost = { x: 0, z: 0, visible: false };
