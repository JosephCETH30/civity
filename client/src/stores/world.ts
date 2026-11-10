import { create } from 'zustand';
import type { ChatMessage, CityObject, CityRoute, LudoState, ObjectType, PlayerState, Role, RoomSummary, SimState } from '@civitas/shared';
import { hasWebGL, initialQuality, isTouchDevice, type QualityLevel } from '../engine/optimization/quality';

export type ConnStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed';
export type CameraMode = 'third' | 'top' | 'free' | 'overview';
export type Tool = { kind: 'select' } | { kind: 'place'; type: ObjectType } | { kind: 'route'; stops: string[] };

const loadPref = <T,>(k: string, fallback: T): T => {
  try { const v = localStorage.getItem('civitas.' + k); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
};
export const savePref = (k: string, v: unknown) => { try { localStorage.setItem('civitas.' + k, JSON.stringify(v)); } catch { /* ignore */ } };

interface WorldState {
  status: ConnStatus;
  error: string | null;
  room: RoomSummary | null;
  self: { sessionId: string; userId: string; role: Role } | null;
  objects: Record<string, CityObject>;
  routes: Record<string, CityRoute>;
  players: Record<string, PlayerState>; // metadata only; positions live in engine/core/transient
  messages: ChatMessage[];
  unread: number;
  sim: SimState;
  serverOffset: number; // serverNow - Date.now()

  selectedId: string | null;
  /** Building the local player is inside (renders its interior), or null when outdoors. */
  inside: string | null;
  /** Park whose photo-to-3D studio is open, or null. */
  artStudio: string | null;
  /** Tree whose Ludo table is open, the latest table states we have seen, and the last dice roll. */
  ludoTree: string | null;
  ludo: Record<string, LudoState>;
  ludoDice: { treeId: string; value: number; at: number } | null;
  tool: Tool;
  transformMode: 'translate' | 'rotate' | 'scale';
  cameraMode: CameraMode;
  quality: QualityLevel;
  autoQuality: boolean;
  renderMode: '3d' | '2d';
  toast: { text: string; kind: 'info' | 'error' } | null;
  set: (p: Partial<WorldState>) => void;
  reset: () => void;
  notify: (text: string, kind?: 'info' | 'error') => void;
}

const initial = () => ({
  status: 'idle' as ConnStatus,
  error: null,
  room: null,
  self: null,
  objects: {},
  routes: {},
  players: {},
  messages: [],
  unread: 0,
  sim: { running: false, speed: 1, timeOfDay: 10, weather: 'clear' as const, elapsed: 0, updatedAt: Date.now() },
  serverOffset: 0,
  selectedId: null,
  inside: null as string | null,
  artStudio: null as string | null,
  ludoTree: null as string | null,
  ludo: {} as Record<string, LudoState>,
  ludoDice: null as { treeId: string; value: number; at: number } | null,
  tool: { kind: 'select' } as Tool,
});

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useWorld = create<WorldState>((set) => ({
  ...initial(),
  transformMode: 'translate',
  cameraMode: isTouchDevice() ? 'top' : 'third',
  quality: loadPref<QualityLevel>('quality', initialQuality()),
  autoQuality: loadPref('autoQuality', true),
  renderMode: hasWebGL() ? loadPref<'3d' | '2d'>('renderMode', '3d') : '2d',
  toast: null,
  set: (p) => set(p),
  reset: () => set(initial()),
  notify(text, kind = 'info') {
    clearTimeout(toastTimer);
    set({ toast: { text, kind } });
    toastTimer = setTimeout(() => set({ toast: null }), 4000);
  },
}));

export const canEditNow = () => {
  const r = useWorld.getState().self?.role;
  return r === 'owner' || r === 'editor';
};
