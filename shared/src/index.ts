// Shared contract between client and server: domain types, validation schemas, wire protocol.
import { z } from 'zod';
import type { LudoState } from './ludo';
import { QUIZ_CATEGORIES, QUIZ_LIMITS, type QuizState } from './quiz';
import type { BattleStats } from './battle';
export * from './ludo';
export * from './quiz';
export * from './battle';

// ---------- Roles & permissions ----------
export const ROLES = ['owner', 'editor', 'participant', 'viewer'] as const;
export type Role = (typeof ROLES)[number];
export const canEdit = (r: Role) => r === 'owner' || r === 'editor';
export const canTalk = (r: Role) => r !== 'viewer';

// ---------- Rooms ----------
export const TEMPLATES = ['modern_city', 'small_town', 'university_campus', 'transport_hub', 'empty_sandbox'] as const;
export type Template = (typeof TEMPLATES)[number];
export const TEMPLATE_LABELS: Record<Template, string> = {
  modern_city: 'Modern City',
  small_town: 'Small Town',
  university_campus: 'University Campus',
  transport_hub: 'Transportation Hub',
  empty_sandbox: 'Empty Sandbox',
};
export const WORLD_SIZES = [96, 160, 240] as const;

export const createRoomSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).default(''),
  visibility: z.enum(['private', 'public']),
  maxParticipants: z.number().int().min(2).max(20),
  template: z.enum(TEMPLATES),
  worldSize: z.union([z.literal(96), z.literal(160), z.literal(240)]),
  defaultRole: z.enum(['editor', 'participant', 'viewer']),
});
export type CreateRoomInput = z.infer<typeof createRoomSchema>;

export interface RoomSummary {
  id: string;
  code: string;
  name: string;
  description: string;
  visibility: 'private' | 'public';
  template: Template;
  worldSize: number;
  maxParticipants: number;
  defaultRole: Role;
  ownerId: string;
  ownerName: string;
  myRole?: Role;
  online?: number;
  updatedAt: string;
}

export interface Profile {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  avatarColor: string;
  /** Null for name-only (device) accounts. With an email the account can sign in on any device. */
  email: string | null;
}

export const usernameSchema = z.string().trim().regex(/^[a-zA-Z0-9_]{3,24}$/, 'Username: 3–24 letters, numbers or _');
export const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
/** The only thing needed to use CIVITAS: a name. */
export const nameSchema = z.object({ name: z.string().trim().min(2, 'Name must be at least 2 characters').max(24).regex(/^[\p{L}\p{N} _.-]+$/u, 'Use letters, numbers, spaces, _ . -') });
const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email('Enter a valid email'));
export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1, 'Enter your password').max(200) });
/** name is required for a new account; it is ignored when a signed-in name-only account adds an email. */
export const registerSchema = z.object({
  email: emailSchema,
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
  name: nameSchema.shape.name.optional(),
});
export const profileUpdateSchema = z.object({
  username: usernameSchema.optional(),
  displayName: z.string().trim().min(1).max(40).optional(),
  avatarColor: hexColor.optional(),
});

// ---------- City objects ----------
export const OBJECT_TYPES = [
  'residential', 'office', 'commercial', 'school', 'hospital', 'park',
  'road', 'tree', 'streetlight', 'bench', 'bus_stop', 'artwork',
] as const;
export type ObjectType = (typeof OBJECT_TYPES)[number];
/** Types users place from the asset library. Photo sculptures (artwork) are only made through the photo-to-3D studio. */
export const PLACEABLE_TYPES = OBJECT_TYPES.filter((t) => t !== 'artwork');
export const BUILDING_TYPES: ObjectType[] = ['residential', 'office', 'commercial', 'school', 'hospital'];
export const STYLES = ['modern', 'classic', 'industrial'] as const;

export const OBJECT_INFO: Record<ObjectType, { label: string; footprint: [number, number]; color: string; floors?: number }> = {
  residential: { label: 'Residential', footprint: [6, 6], color: '#efe4d2', floors: 3 },
  office: { label: 'Office', footprint: [8, 8], color: '#e2dacd', floors: 6 },
  commercial: { label: 'Commercial', footprint: [10, 8], color: '#f2e9da', floors: 2 },
  school: { label: 'School', footprint: [14, 10], color: '#e8d9bd', floors: 2 },
  hospital: { label: 'Hospital', footprint: [12, 12], color: '#f5f3ee', floors: 4 },
  park: { label: 'Park', footprint: [12, 12], color: '#6f9a4f' },
  road: { label: 'Road', footprint: [8, 8], color: '#46494e' },
  tree: { label: 'Tree', footprint: [2, 2], color: '#4d7a34' },
  streetlight: { label: 'Streetlight', footprint: [1, 1], color: '#2f3236' },
  bench: { label: 'Bench', footprint: [2, 1], color: '#8a6446' },
  bus_stop: { label: 'Bus stop', footprint: [3, 2], color: '#2b6f8f' },
  artwork: { label: 'Photo sculpture', footprint: [3, 1.6], color: '#d6cdbd' },
};

const finite = z.number().finite();
export const vec3Schema = z.object({ x: finite, y: finite, z: finite });
export type Vec3 = z.infer<typeof vec3Schema>;

export const objectPropsSchema = z
  .object({
    floors: z.number().int().min(1).max(40).optional(),
    color: hexColor.optional(),
    style: z.enum(STYLES).optional(),
    name: z.string().trim().max(60).optional(),
    // photo sculptures (artwork): uploaded image + AI depth map, and how they are shaped
    assetId: z.uuid().optional(),
    depthScale: z.number().min(0.1).max(3).optional(),
    cutout: z.number().min(0).max(0.8).optional(),
    aspect: z.number().min(0.2).max(5).optional(),
  })
  .strict();

export const objectSpecSchema = z.object({
  type: z.enum(OBJECT_TYPES),
  position: vec3Schema,
  rotationY: finite,
  scale: z.object({ x: z.number().min(0.25).max(4), y: z.number().min(0.25).max(4), z: z.number().min(0.25).max(4) }),
  props: objectPropsSchema,
});
export type ObjectSpec = z.infer<typeof objectSpecSchema>;
export interface CityObject extends ObjectSpec {
  id: string;
  createdBy: string | null;
}
export const objectPatchSchema = objectSpecSchema.omit({ type: true }).partial();

/** Snap to grid, clamp into the world, quantize rotation. Server applies it authoritatively; client uses it for previews. */
export function normalizeSpec(spec: ObjectSpec, worldSize: number): ObjectSpec {
  const half = worldSize / 2;
  const clamp = (v: number) => Math.max(-half, Math.min(half, v));
  const snap = (v: number) => Math.round(v);
  const r = ((spec.rotationY % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return {
    ...spec,
    position: { x: clamp(snap(spec.position.x)), y: 0, z: clamp(snap(spec.position.z)) },
    rotationY: Math.round(r / (Math.PI / 12)) * (Math.PI / 12), // 15° steps
    scale: { x: +spec.scale.x.toFixed(2), y: +spec.scale.y.toFixed(2), z: +spec.scale.z.toFixed(2) },
  };
}

export function defaultSpec(type: ObjectType, position: Vec3): ObjectSpec {
  const info = OBJECT_INFO[type];
  return {
    type,
    position,
    rotationY: 0,
    scale: { x: 1, y: 1, z: 1 },
    props: info.floors ? { floors: info.floors } : {},
  };
}

// ---------- Transport routes ----------
export const routeInputSchema = z.object({
  name: z.string().trim().min(1).max(40),
  stopIds: z.array(z.uuid()).min(2).max(20),
  color: hexColor.default('#2f7de1'),
});
export interface CityRoute {
  id: string;
  name: string;
  transportType: 'bus';
  stopIds: string[];
  color: string;
}

// ---------- Simulation ----------
export const WEATHER = ['clear', 'cloudy', 'rain', 'fog'] as const;
export type Weather = (typeof WEATHER)[number];
export interface SimState {
  running: boolean;
  speed: number; // 0.5 .. 8
  timeOfDay: number; // base hour 0..24 at elapsed = 0
  weather: Weather;
  elapsed: number; // simulated seconds at updatedAt
  updatedAt: number; // server epoch ms
}
export const simPatchSchema = z
  .object({
    running: z.boolean().optional(),
    speed: z.number().min(0.25).max(8).optional(),
    timeOfDay: z.number().min(0).max(24).optional(),
    weather: z.enum(WEATHER).optional(),
    reset: z.literal(true).optional(),
  })
  .strict();

/** Simulated seconds elapsed at `now` (server clock). */
export const simElapsed = (s: SimState, now: number) =>
  s.elapsed + (s.running ? ((now - s.updatedAt) / 1000) * s.speed : 0);
/** One simulated hour passes per real minute at speed 1. */
export const simHour = (s: SimState, now: number) => (((s.timeOfDay + simElapsed(s, now) / 60) % 24) + 24) % 24;

// ---------- Realtime wire protocol ----------
export const ANIM_STATES = ['idle', 'walk', 'jump', 'sit', 'wave', 'fall'] as const;
export type AnimState = (typeof ANIM_STATES)[number];
export interface PlayerState {
  id: string; // session id
  userId: string;
  name: string;
  color: string;
  avatarUrl: string | null;
  role: Role;
  p: [number, number, number];
  r: number;
  a: AnimState;
  activity: string;
}
export interface ChatMessage {
  id: string;
  senderId: string | null;
  senderName: string;
  content: string;
  type: 'user' | 'system' | 'ai';
  createdAt: string;
}

/** Building interiors are rendered this far below the street so they are hidden from outside. */
export const INTERIOR_DEPTH = -60;

export const MAX_CHAT = 500;
export const clientMessageSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('move'), p: z.tuple([finite, finite, finite]), r: finite, a: z.enum(ANIM_STATES) }),
  z.object({ t: z.literal('status'), activity: z.string().max(40) }),
  z.object({ t: z.literal('chat'), text: z.string().trim().min(1).max(MAX_CHAT) }),
  z.object({ t: z.literal('obj_add'), spec: objectSpecSchema }),
  z.object({ t: z.literal('obj_update'), id: z.uuid(), patch: objectPatchSchema }),
  z.object({ t: z.literal('obj_delete'), id: z.uuid() }),
  z.object({ t: z.literal('route_add'), route: routeInputSchema }),
  z.object({ t: z.literal('route_delete'), id: z.uuid() }),
  z.object({ t: z.literal('sim'), patch: simPatchSchema }),
  z.object({ t: z.literal('ping'), n: z.number() }),
  // Ludo table at a tree: every tree is its own game session.
  z.object({
    t: z.literal('ludo'),
    treeId: z.uuid(),
    action: z.enum(['watch', 'unwatch', 'join', 'leave', 'start', 'roll', 'move']),
    seat: z.number().int().min(0).max(3).optional(),
    token: z.number().int().min(0).max(3).optional(),
  }),
  // General-knowledge quiz at a tree.
  z.object({
    t: z.literal('quiz'),
    treeId: z.uuid(),
    action: z.enum(['watch', 'unwatch', 'join', 'leave', 'config', 'start', 'answer']),
    count: z.number().int().min(QUIZ_LIMITS.minCount).max(QUIZ_LIMITS.maxCount).optional(),
    seconds: z.number().int().min(QUIZ_LIMITS.minSeconds).max(QUIZ_LIMITS.maxSeconds).optional(),
    category: z.enum(QUIZ_CATEGORIES).optional(),
    choice: z.number().int().min(0).max(3).optional(),
  }),
  // PvP battle: join/leave, and a shot from the player's chest in a direction (unit vector).
  z.object({ t: z.literal('battle'), action: z.enum(['join', 'leave']) }),
  z.object({ t: z.literal('shoot'), o: z.tuple([finite, finite, finite]), d: z.tuple([finite, finite, finite]) }),
]);
export type ClientMessage = z.input<typeof clientMessageSchema>;

export type ServerMessage =
  | {
      t: 'init';
      self: { sessionId: string; userId: string; role: Role };
      room: RoomSummary;
      players: PlayerState[];
      objects: CityObject[];
      routes: CityRoute[];
      messages: ChatMessage[];
      sim: SimState;
      serverNow: number;
    }
  | { t: 'player_join'; player: PlayerState }
  | { t: 'player_leave'; id: string }
  | { t: 'snap'; players: [string, number, number, number, number, AnimState][] }
  | { t: 'presence'; id: string; activity: string }
  | { t: 'role'; id: string; role: Role }
  | { t: 'chat'; message: ChatMessage }
  | { t: 'obj_added'; object: CityObject }
  | { t: 'obj_updated'; object: CityObject }
  | { t: 'obj_deleted'; id: string }
  | { t: 'route_added'; route: CityRoute }
  | { t: 'route_deleted'; id: string }
  | { t: 'sim'; sim: SimState; serverNow: number }
  | { t: 'pong'; n: number; serverNow: number }
  | { t: 'ludo'; state: LudoState; dice?: number }
  | { t: 'quiz'; state: QuizState }
  /** Full battle roster (session id -> stats); sent when someone joins, leaves, dies or respawns. */
  | { t: 'battle'; stats: Record<string, BattleStats> }
  /** A shot for everyone to draw. `hit` is the session that was hit; `respawn` tells the victim where to reappear. */
  | { t: 'shot'; from: string; o: [number, number, number]; e: [number, number, number]; hit?: string; hp?: number; kill?: boolean; head?: boolean }
  | { t: 'respawn'; id: string; p: [number, number, number] }
  | { t: 'error'; message: string; fatal?: boolean };

// ---------- AI commands (LLM output is validated against this; never executed as code) ----------
export const aiObjectSchema = z.object({
  type: z.enum(OBJECT_TYPES).exclude(['artwork']),
  floors: z.number().int().min(1).max(40).optional(),
  style: z.enum(STYLES).optional(),
  color: hexColor.optional(),
  name: z.string().max(60).optional(),
  position: z.object({ x: finite, z: finite }).optional(),
  near: z.enum(OBJECT_TYPES).exclude(['artwork']).optional(),
  rotationY: finite.optional(),
  scale: z.number().min(0.25).max(4).optional(),
});
export const aiCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create_objects'), objects: z.array(aiObjectSchema).min(1).max(10) }),
  z.object({ action: z.literal('create_route'), name: z.string().min(1).max(40), stopIds: z.array(z.string()).max(20), stopCount: z.number().int().min(2).max(20).optional() }),
  z.object({ action: z.literal('advice'), text: z.string().max(3000) }),
  z.object({ action: z.literal('unsupported'), reason: z.string().max(500) }),
]);
export type AiCommand = z.infer<typeof aiCommandSchema>;
export const aiRequestSchema = z.object({
  prompt: z.string().trim().min(2).max(500),
  origin: z.object({ x: finite, z: finite }).optional(),
});
export interface AiResponse {
  provider: 'groq' | 'gemini' | 'offline';
  command: AiCommand;
  /** Human-readable confirmation of what was executed. */
  summary: string;
  /** Deterministic metrics computed from the city (verified), separate from AI suggestions. */
  analysis?: CityAnalysis;
  createdObjectIds: string[];
  createdRouteId?: string;
}
export interface CityAnalysis {
  counts: Partial<Record<ObjectType, number>>;
  residentialWithoutStop: number;
  residentialTotal: number;
  avgDistanceToSchool: number | null;
  avgDistanceToHospital: number | null;
  avgDistanceToPark: number | null;
  routes: number;
  stopsNotOnRoute: number;
}

const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z);
export const STOP_COVERAGE_RADIUS = 40;

/** Deterministic city metrics. These are facts about the current city, not AI opinions. */
export function analyzeCity(objects: CityObject[], routes: CityRoute[]): CityAnalysis {
  const counts: Partial<Record<ObjectType, number>> = {};
  for (const o of objects) counts[o.type] = (counts[o.type] ?? 0) + 1;
  const of = (t: ObjectType) => objects.filter((o) => o.type === t);
  const homes = of('residential');
  const stops = of('bus_stop');
  const avgNearest = (t: ObjectType) => {
    const targets = of(t);
    if (!homes.length || !targets.length) return null;
    const sum = homes.reduce((s, h) => s + Math.min(...targets.map((x) => dist(h.position, x.position))), 0);
    return Math.round(sum / homes.length);
  };
  const onRoute = new Set(routes.flatMap((r) => r.stopIds));
  return {
    counts,
    residentialTotal: homes.length,
    residentialWithoutStop: homes.filter((h) => !stops.some((s) => dist(h.position, s.position) <= STOP_COVERAGE_RADIUS)).length,
    avgDistanceToSchool: avgNearest('school'),
    avgDistanceToHospital: avgNearest('hospital'),
    avgDistanceToPark: avgNearest('park'),
    routes: routes.length,
    stopsNotOnRoute: stops.filter((s) => !onRoute.has(s.id)).length,
  };
}
