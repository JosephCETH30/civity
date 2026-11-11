// AI city assistant: natural language -> validated AiCommand -> the same world operations manual editing uses.
// The model only ever produces JSON data. Nothing it returns is executed as code.
import {
  aiCommandSchema, analyzeCity, BUILDING_TYPES, defaultSpec, OBJECT_INFO, STOP_COVERAGE_RADIUS, STYLES, PLACEABLE_TYPES,
  type AiCommand, type AiResponse, type CityAnalysis, type CityObject, type CityRoute, type ObjectType,
} from '@civitas/shared';
import { config } from './config.ts';
import { geminiText, groqChat } from './providers.ts';
import type { CityRoom } from './realtime.ts';

type XZ = { x: number; z: number };

// Order matters: longer / more specific phrases first. Includes basic Indonesian keywords.
// Photo sculptures are made in the photo-to-3D studio, never from text.
type TextType = Exclude<ObjectType, 'artwork'>;
const TYPE_WORDS: [RegExp, TextType][] = [
  [/rumah sakit|hospital|clinic|klinik/, 'hospital'],
  [/bus ?stop|halte|stop\b|station/, 'bus_stop'],
  [/street ?light|lamp|lampu/, 'streetlight'],
  [/office|tower|skyscraper|kantor|perkantoran/, 'office'],
  [/school|university|campus|faculty|college|sekolah|kampus/, 'school'],
  [/shop|store|mall|market|commercial|retail|toko|pasar/, 'commercial'],
  [/house|home|residential|apartment|housing|rumah|perumahan/, 'residential'],
  [/park|garden|plaza|taman/, 'park'],
  [/tree|pohon/, 'tree'],
  [/bench|bangku/, 'bench'],
  [/road|street|jalan/, 'road'],
];
const NUM_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, a: 1, an: 1,
};
const COLORS: Record<string, string> = {
  red: '#d9534f', blue: '#4a7fd6', green: '#5fae5a', yellow: '#f0cf5a', white: '#f2f2ee', gray: '#9aa0a6',
  grey: '#9aa0a6', black: '#3a3d42', orange: '#ec9a48', purple: '#9b6fd0', pink: '#e79ab8', glass: '#9ec9e8', brown: '#a07050',
};
const num = (s: string | undefined) => (s ? (/^\d+$/.test(s) ? Number(s) : NUM_WORDS[s]) : undefined);
const findType = (s: string) => TYPE_WORDS.find(([re]) => re.test(s))?.[1];

/** Deterministic rule-based parser. Used when no LLM key is configured or the LLM fails. */
export function parseOffline(prompt: string): AiCommand {
  const p = prompt.toLowerCase();
  if (/\b(route|line|rute|jalur)\b/.test(p) && /(bus|connect|hubung|transit)/.test(p)) {
    const m = p.match(/\b(\d+|two|three|four|five|six|seven|eight|nine|ten)\s+(bus\s+)?stops?\b/);
    return { action: 'create_route', name: 'AI Line', stopIds: [], stopCount: Math.min(20, Math.max(2, num(m?.[1]) ?? 3)) };
  }
  if (/(suggest|analy|improv|recommend|gap|distribution|evaluate|saran|analisis)/.test(p)) {
    return { action: 'advice', text: '' }; // filled from deterministic analysis
  }
  if (!/(create|add|build|place|make|put|generate|buat|tambah|bangun)/.test(p)) {
    return { action: 'unsupported', reason: 'Try "add a park near the school", "create a modern office building with ten floors", "create a bus route connecting three stops", or "analyze the distribution of public facilities".' };
  }
  const [main, nearPart] = p.split(/\b(?:near|next to|beside|close to|dekat)\b/);
  const type = findType(main);
  if (!type) return { action: 'unsupported', reason: 'I could not tell which kind of object to create. Supported: ' + Object.values(OBJECT_INFO).map((i) => i.label.toLowerCase()).join(', ') + '.' };
  const floors = num(main.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)[\s-]*(floor|storey|story|level|lantai)/)?.[1]);
  const count = num(main.match(/\b(\d+|two|three|four|five|six|seven|eight|nine|ten)\s+\w*\s*(trees?|houses?|homes?|benches|bench|lamps?|streetlights?|buildings?|offices?|shops?|parks?|stops?)\b/)?.[1]) ?? 1;
  const colorWord = Object.keys(COLORS).find((c) => new RegExp(`\\b${c}\\b`).test(main));
  const style: (typeof STYLES)[number] | undefined = /\bmodern|glass\b/.test(main) ? 'modern' : /\bclassic|old|historic\b/.test(main) ? 'classic' : /\bindustrial\b/.test(main) ? 'industrial' : undefined;
  const near = nearPart ? findType(nearPart) : undefined;
  const isBuilding = BUILDING_TYPES.includes(type);
  const obj = {
    type,
    ...(isBuilding && floors ? { floors: Math.min(40, floors) } : {}),
    ...(colorWord ? { color: COLORS[colorWord] } : {}),
    ...(style && isBuilding ? { style } : {}),
    ...(near ? { near } : {}),
  };
  return { action: 'create_objects', objects: Array.from({ length: Math.min(10, count) }, () => ({ ...obj })) };
}

function adviceFromAnalysis(a: CityAnalysis): string {
  const tips: string[] = [];
  if (a.residentialTotal && a.residentialWithoutStop) tips.push(`${a.residentialWithoutStop} of ${a.residentialTotal} residential buildings are more than ${STOP_COVERAGE_RADIUS}m from a bus stop. Add stops near them.`);
  if (a.stopsNotOnRoute) tips.push(`${a.stopsNotOnRoute} bus stop(s) are not served by any route. Connect them into a route.`);
  if (!a.counts.school && a.residentialTotal) tips.push('There is no school. Place one near the residential area.');
  if (!a.counts.hospital && a.residentialTotal) tips.push('There is no hospital. Add one with good road access.');
  if (!a.counts.park && a.residentialTotal) tips.push('There are no parks. Add green space near homes.');
  if ((a.avgDistanceToPark ?? 0) > 60) tips.push(`Homes are on average ${a.avgDistanceToPark}m from the nearest park. Consider a smaller park closer to housing.`);
  if (!a.routes) tips.push('No transport routes exist yet.');
  return tips.length ? tips.map((t) => '• ' + t).join('\n') : 'No obvious gaps found by the rule checks. The facility distribution looks balanced.';
}

function commandSystemPrompt(room: CityRoom, origin: XZ, analysis: CityAnalysis) {
  const stops = [...room.objects.values()].filter((o) => o.type === 'bus_stop').slice(0, 40)
    .map((o) => ({ id: o.id, name: o.props.name ?? 'stop', x: o.position.x, z: o.position.z }));
  return `You convert a user's request about a 3D city into ONE JSON command. Output JSON only.
Schema (TypeScript):
type Obj = { type: ${PLACEABLE_TYPES.map((t) => `"${t}"`).join('|')}; floors?: 1-40 (buildings only); style?: "modern"|"classic"|"industrial"; color?: "#rrggbb"; name?: string; position?: {x:number,z:number}; near?: <same type enum>; rotationY?: radians; scale?: 0.25-4 }
type Command =
 | { action: "create_objects"; objects: Obj[] /* 1-10 */ }
 | { action: "create_route"; name: string; stopIds: string[] /* ids from the stop list, in travel order */; stopCount?: number }
 | { action: "advice"; text: string /* concise suggestions; plain text */ }
 | { action: "unsupported"; reason: string }
Rules: Prefer "near" over inventing coordinates. World coordinates range ±${room.meta.worldSize / 2}. The user stands at x=${Math.round(origin.x)}, z=${Math.round(origin.z)}.
City metrics (verified): ${JSON.stringify(analysis)}
Bus stops: ${JSON.stringify(stops)}`;
}

/** LLM path for city commands: Groq first (fast, free), Gemini text second. Throws when neither works. */
async function callModel(prompt: string, room: CityRoom, origin: XZ, analysis: CityAnalysis): Promise<{ command: AiCommand; provider: 'groq' | 'gemini' }> {
  const system = commandSystemPrompt(room, origin, analysis);
  const attempts: Array<['groq' | 'gemini', () => Promise<string>]> = [];
  if (config.groq) attempts.push(['groq', () => groqChat({ system, user: prompt, json: true, temperature: 0.2 })]);
  if (config.gemini) attempts.push(['gemini', () => geminiText(system, prompt)]);
  let lastError: unknown = new Error('no AI provider configured');
  for (const [provider, run] of attempts) {
    try {
      const text = await run();
      const parsed = aiCommandSchema.safeParse(JSON.parse(text || 'null'));
      if (!parsed.success) throw new Error(`${provider} returned an invalid command`);
      return { command: parsed.data, provider };
    } catch (e) {
      lastError = e;
      console.warn(`[ai] ${provider} failed:`, (e as Error).message);
    }
  }
  throw lastError;
}

const footprintRadius = (t: ObjectType) => Math.max(...OBJECT_INFO[t].footprint) / 2;

/** Spiral search for a spot near `anchor` that does not overlap existing non-small objects. */
export function findFreeSpot(objects: CityObject[], type: ObjectType, anchor: XZ, worldSize: number): XZ {
  const r = footprintRadius(type);
  const half = worldSize / 2 - r;
  const solid = objects.filter((o) => o.type !== 'tree' && o.type !== 'streetlight' && o.type !== 'bench');
  const free = (x: number, z: number) =>
    Math.abs(x) <= half && Math.abs(z) <= half &&
    solid.every((o) => {
      const or = footprintRadius(o.type) * Math.max(o.scale.x, o.scale.z);
      return Math.abs(o.position.x - x) >= r + or + 1 || Math.abs(o.position.z - z) >= r + or + 1;
    });
  for (let ring = 0; ring < 40; ring++) {
    const d = ring * 2;
    for (let i = 0; i < Math.max(1, ring * 8); i++) {
      const a = (i / Math.max(1, ring * 8)) * Math.PI * 2;
      const x = Math.round(anchor.x + Math.cos(a) * d), z = Math.round(anchor.z + Math.sin(a) * d);
      if (free(x, z)) return { x, z };
    }
  }
  return { x: Math.round(anchor.x), z: Math.round(anchor.z) };
}

const d2 = (a: XZ, b: XZ) => Math.hypot(a.x - b.x, a.z - b.z);

export async function runAiCommand(room: CityRoom, prompt: string, origin: XZ, actor: { userId: string | null; name: string }): Promise<AiResponse> {
  const objects = () => [...room.objects.values()];
  const routes = () => [...room.routes.values()] as CityRoute[];
  const analysis = analyzeCity(objects(), routes());
  let provider: AiResponse['provider'] = 'offline';
  let note = '';
  let command: AiCommand;
  if (config.groq || config.gemini) {
    try {
      ({ command, provider } = await callModel(prompt, room, origin, analysis));
    } catch {
      note = ' (AI provider unavailable, used the built-in offline parser)';
      command = parseOffline(prompt);
    }
  } else command = parseOffline(prompt);

  const out: AiResponse = { provider, command, summary: '', createdObjectIds: [] };
  switch (command.action) {
    case 'unsupported':
      out.summary = command.reason;
      break;
    case 'advice':
      out.analysis = analysis;
      if (provider === 'offline' || !command.text) command.text = adviceFromAnalysis(analysis);
      out.summary = command.text;
      break;
    case 'create_objects': {
      for (const o of command.objects) {
        let anchor: XZ = origin;
        if (o.near) {
          const targets = objects().filter((x) => x.type === o.near);
          if (targets.length) anchor = targets.reduce((b, x) => (d2(x.position, origin) < d2(b.position, origin) ? x : b)).position;
        }
        const pos = o.position ?? findFreeSpot(objects(), o.type, anchor, room.meta.worldSize);
        const spec = defaultSpec(o.type, { x: pos.x, y: 0, z: pos.z });
        if (o.floors && BUILDING_TYPES.includes(o.type)) spec.props.floors = o.floors;
        if (o.color) spec.props.color = o.color;
        if (o.style) spec.props.style = o.style;
        if (o.name) spec.props.name = o.name;
        if (o.rotationY !== undefined) spec.rotationY = o.rotationY;
        if (o.scale) spec.scale = { x: o.scale, y: o.scale, z: o.scale };
        const created = await room.addObject(spec, actor);
        out.createdObjectIds.push(created.id);
      }
      const first = command.objects[0];
      out.summary = `Created ${command.objects.length} ${OBJECT_INFO[first.type].label.toLowerCase()}${command.objects.length > 1 ? ' objects' : ''}${first.floors ? ` with ${first.floors} floors` : ''}${first.near ? ` near the ${OBJECT_INFO[first.near].label.toLowerCase()}` : ''}.`;
      break;
    }
    case 'create_route': {
      const stops = objects().filter((o) => o.type === 'bus_stop');
      let ids = command.stopIds.filter((id) => stops.some((s) => s.id === id));
      if (ids.length < 2) {
        // Greedy nearest-neighbour ordering starting from the stop closest to the user.
        const want = Math.min(command.stopCount ?? 3, stops.length);
        const pool = [...stops];
        const chosen: CityObject[] = [];
        let cur: XZ = origin;
        while (chosen.length < want && pool.length) {
          pool.sort((a, b) => d2(a.position, cur) - d2(b.position, cur));
          const next = pool.shift()!;
          chosen.push(next);
          cur = next.position;
        }
        ids = chosen.map((s) => s.id);
      }
      if (ids.length < 2) {
        out.command = { action: 'unsupported', reason: 'A route needs at least two bus stops. Place bus stops first.' };
        out.summary = out.command.reason;
        break;
      }
      const name = `${command.name} ${routes().length + 1}`;
      const route = await room.addRoute(name, ids, '#e0663a', actor);
      out.createdRouteId = route.id;
      out.summary = `Created route "${route.name}" connecting ${ids.length} stops.`;
      break;
    }
  }
  out.summary += note;
  return out;
}
