// Authoritative realtime room server over WebSocket.
// Transient state (avatar positions, presence) lives in memory only; world edits are validated then persisted.
import { randomInt, randomUUID } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  canEdit, canTalk, clientMessageSchema, INTERIOR_DEPTH, OBJECT_INFO,
  applyMove, applyRoll, legalTokens, newLudo, removePlayer, startGame, type LudoState, normalizeSpec, objectSpecSchema, simElapsed, simHour,
  type ChatMessage, type ClientMessage, type CityObject, type CityRoute, type ObjectSpec, type PlayerState, type Role,
  type RoomSummary, type ServerMessage, type SimState,
} from '@civitas/shared';
import { verifyToken, type Identity } from './auth.ts';
import { q, pool } from './db.ts';
import { getRoom, logActivity, resolveAccess } from './rooms.ts';
import { QuizTable } from './quiz.ts';
import { Battle } from './battle.ts';

const TICK_MS = 100; // 10 Hz position broadcast
const MAX_OBJECTS = 3000;
const MAX_MSGS_PER_SEC = 40;

interface Session {
  id: string;
  ws: WebSocket;
  identity: Identity;
  player: PlayerState;
  dirty: boolean;
  alive: boolean;
  budget: { n: number; reset: number };
  chatBudget: { n: number; reset: number };
}

export class WorldError extends Error {}

// Cities start alive (traffic, buses, residents moving); owners can pause.
const defaultSim = (): SimState => ({ running: true, speed: 1, timeOfDay: 10, weather: 'clear', elapsed: 0, updatedAt: Date.now() });

const rowToObject = (r: any): CityObject => ({
  id: r.id,
  type: r.object_type,
  position: r.position,
  rotationY: r.rotation?.y ?? 0,
  scale: r.scale,
  props: r.properties ?? {},
  createdBy: r.created_by,
});
const rowToRoute = (r: any): CityRoute => ({
  id: r.id, name: r.name, transportType: 'bus', stopIds: r.route_data.stopIds, color: r.route_data.color,
});
const rowToMessage = (r: any): ChatMessage => ({
  id: r.id, senderId: r.sender_id, senderName: r.sender_name, content: r.content, type: r.message_type, createdAt: new Date(r.created_at).toISOString(),
});

/** Strip control characters; React escapes HTML at render time. */
export const sanitizeText = (s: string) => s.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim();

/**
 * A spawn point near the centre that is not on a road (traffic) and not inside any object footprint.
 * Spirals outwards from the middle; falls back to the centre if the whole city is full.
 */
export function safeSpawn(objects: CityObject[], worldSize: number): [number, number, number] {
  const blocked = (x: number, z: number) =>
    objects.some((o) => {
      if (o.type === 'park') return false; // grass is fine to stand on
      const [w, d] = OBJECT_INFO[o.type].footprint;
      const pad = o.type === 'road' ? 1.5 : 1; // keep clear of the kerb
      const c = Math.cos(o.rotationY), s = Math.sin(o.rotationY);
      const dx = x - o.position.x, dz = z - o.position.z;
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      return Math.abs(lx) < (w * o.scale.x) / 2 + pad && Math.abs(lz) < (d * o.scale.z) / 2 + pad;
    });
  const half = worldSize / 2 - 2;
  for (let ring = 0; ring < 60; ring++) {
    const n = Math.max(1, ring * 8);
    const start = Math.random() * Math.PI * 2; // different people land in different spots
    for (let i = 0; i < n; i++) {
      const a = start + (i / n) * Math.PI * 2;
      const x = Math.round(Math.cos(a) * ring * 1.5), z = Math.round(Math.sin(a) * ring * 1.5);
      if (Math.abs(x) < half && Math.abs(z) < half && !blocked(x, z)) return [x, 0, z];
    }
  }
  return [0, 0, 0];
}

export class CityRoom {
  sessions = new Map<string, Session>();
  objects = new Map<string, CityObject>();
  routes = new Map<string, CityRoute>();
  messages: ChatMessage[] = [];
  sim: SimState = defaultSim();
  /** One Ludo table per tree (tree object id -> game). Transient: not saved. */
  ludo = new Map<string, { state: LudoState; watchers: Set<string>; timer?: NodeJS.Timeout }>();
  /** One quiz per tree (tree object id -> table). Transient. */
  quiz = new Map<string, QuizTable>();
  /** PvP battle: whoever opted in. Transient. */
  battle = new Battle((m) => this.broadcast(m), () => safeSpawn([...this.objects.values()], this.meta.worldSize));
  private tick?: NodeJS.Timeout;
  emptySince = Date.now();

  constructor(public meta: RoomSummary) {}

  async load() {
    const [objs, routes, msgs, scenes] = await Promise.all([
      q('select * from city_objects where room_id = $1', [this.meta.id]),
      q('select * from city_routes where room_id = $1 order by created_at', [this.meta.id]),
      q('select * from room_messages where room_id = $1 order by created_at desc limit 50', [this.meta.id]),
      q('select scene_data from city_scenes where room_id = $1', [this.meta.id]),
    ]);
    for (const r of objs) this.objects.set(r.id, rowToObject(r));
    for (const r of routes) this.routes.set(r.id, rowToRoute(r));
    this.messages = msgs.map(rowToMessage).reverse();
    const saved = scenes[0]?.scene_data?.sim;
    // Keep the saved clock, weather and speed, but a room that was unloaded (everyone left) always comes back
    // running: a pause belongs to the session that set it, not to the next visit.
    if (saved) this.sim = { ...defaultSim(), ...saved, running: true, updatedAt: Date.now() };
    this.tick = setInterval(() => this.broadcastSnapshot(), TICK_MS);
  }

  dispose() {
    clearInterval(this.tick);
    for (const g of this.ludo.values()) clearTimeout(g.timer);
    for (const t of this.quiz.values()) t.dispose();
    this.battle.dispose();
  }

  get online() {
    return new Set([...this.sessions.values()].map((s) => s.player.userId)).size;
  }

  send(s: Session, msg: ServerMessage) {
    if (s.ws.readyState === s.ws.OPEN) s.ws.send(JSON.stringify(msg));
  }
  broadcast(msg: ServerMessage, except?: string) {
    const data = JSON.stringify(msg);
    for (const s of this.sessions.values()) if (s.id !== except && s.ws.readyState === s.ws.OPEN) s.ws.send(data);
  }

  private broadcastSnapshot() {
    const moved = [...this.sessions.values()].filter((s) => s.dirty);
    if (!moved.length) return;
    for (const s of moved) s.dirty = false;
    const r2 = (n: number) => Math.round(n * 100) / 100;
    this.broadcast({ t: 'snap', players: moved.map((s) => [s.id, r2(s.player.p[0]), r2(s.player.p[1]), r2(s.player.p[2]), r2(s.player.r), s.player.a]) });
  }

  async join(ws: WebSocket, identity: Identity, role: Role, profile: { name: string; color: string; avatarUrl: string | null }) {
    if (ws.readyState !== ws.OPEN) return; // closed while we were loading
    const id = randomUUID();
    const spawn = safeSpawn([...this.objects.values()], this.meta.worldSize);
    const session: Session = {
      id, ws, identity, dirty: false, alive: true,
      budget: { n: 0, reset: 0 }, chatBudget: { n: 0, reset: 0 },
      player: { id, userId: identity.sub, name: profile.name, color: profile.color, avatarUrl: profile.avatarUrl, role, p: spawn, r: 0, a: 'idle', activity: 'Exploring' },
    };
    const firstForUser = ![...this.sessions.values()].some((s) => s.player.userId === identity.sub);
    this.sessions.set(id, session);
    this.send(session, {
      t: 'init',
      self: { sessionId: id, userId: identity.sub, role },
      room: { ...this.meta, myRole: role, online: this.online },
      players: [...this.sessions.values()].map((s) => s.player),
      objects: [...this.objects.values()],
      routes: [...this.routes.values()],
      messages: this.messages,
      sim: this.sim,
      serverNow: Date.now(),
    });
    this.broadcast({ t: 'player_join', player: session.player }, id);
    if (firstForUser) {
      await this.system(`${profile.name} joined`);
      logActivity(this.meta.id, identity.sub, profile.name, 'join');
    }

    ws.on('message', (raw) => this.onMessage(session, raw.toString()).catch((e) => this.fail(session, e)));
    ws.on('pong', () => (session.alive = true));
    ws.on('close', () => this.leave(session));
  }

  private async leave(s: Session) {
    if (!this.sessions.delete(s.id)) return;
    for (const [treeId, g] of this.ludo) {
      g.watchers.delete(s.id);
      const seat = g.state.seats.findIndex((p) => p?.sessionId === s.id);
      if (seat >= 0) { removePlayer(g.state, seat, Date.now()); this.sendLudo(g); this.scheduleLudo(g); }
      if (!g.watchers.size && g.state.seats.every((p) => !p)) { clearTimeout(g.timer); this.ludo.delete(treeId); }
    }
    for (const [treeId, t] of this.quiz) {
      t.watchers.delete(s.id);
      if (t.leave(s.id)) this.sendQuiz(t);
      if (t.empty) { t.dispose(); this.quiz.delete(treeId); }
    }
    this.battle.leave(s.id);
    this.broadcast({ t: 'player_leave', id: s.id });
    if (!this.sessions.size) this.emptySince = Date.now();
    if (![...this.sessions.values()].some((x) => x.player.userId === s.player.userId)) {
      await this.system(`${s.player.name} left`).catch(() => {});
      logActivity(this.meta.id, s.identity.sub, s.player.name, 'leave');
    }
  }

  private fail(s: Session, e: unknown) {
    const message = e instanceof WorldError ? e.message : 'Server error';
    if (!(e instanceof WorldError)) console.error('[room]', e);
    this.send(s, { t: 'error', message });
  }

  heartbeat() {
    for (const s of this.sessions.values()) {
      if (!s.alive) { s.ws.terminate(); continue; }
      s.alive = false;
      s.ws.ping();
    }
  }

  private allow(b: { n: number; reset: number }, limit: number, windowMs: number) {
    const now = Date.now();
    if (b.reset < now) { b.n = 0; b.reset = now + windowMs; }
    return ++b.n <= limit;
  }

  private async onMessage(s: Session, raw: string) {
    if (raw.length > 16_000) throw new WorldError('Message too large');
    if (!this.allow(s.budget, MAX_MSGS_PER_SEC, 1000)) return; // silently drop floods
    let json: unknown;
    try { json = JSON.parse(raw); } catch { throw new WorldError('Malformed message'); }
    const parsed = clientMessageSchema.safeParse(json);
    if (!parsed.success) throw new WorldError('Invalid message: ' + parsed.error.issues[0]?.message);
    const m = parsed.data;
    const role = s.player.role;
    const actor = { userId: s.identity.sub, name: s.player.name };

    switch (m.t) {
      case 'ping':
        return this.send(s, { t: 'pong', n: m.n, serverNow: Date.now() });
      case 'move': {
        const half = this.meta.worldSize / 2 + 2;
        const [x, y, z] = m.p;
        // y range covers jumping (up) and building interiors (below the street, see INTERIOR_DEPTH).
        s.player.p = [Math.max(-half, Math.min(half, x)), Math.max(INTERIOR_DEPTH - 5, Math.min(50, y)), Math.max(-half, Math.min(half, z))];
        s.player.r = m.r;
        s.player.a = m.a;
        s.dirty = true;
        return;
      }
      case 'status':
        s.player.activity = sanitizeText(m.activity);
        return this.broadcast({ t: 'presence', id: s.id, activity: s.player.activity });
      case 'chat': {
        if (!canTalk(role)) throw new WorldError('Viewers cannot chat in this room');
        if (!this.allow(s.chatBudget, 5, 5000)) throw new WorldError('Slow down: too many messages');
        const text = sanitizeText(m.text);
        if (text) await this.chat(actor.userId, s.player.name, text, 'user');
        return;
      }
      case 'obj_add':
        if (!canEdit(role)) throw new WorldError('You do not have edit permission');
        await this.addObject(m.spec, actor);
        return;
      case 'obj_update':
        if (!canEdit(role)) throw new WorldError('You do not have edit permission');
        await this.updateObject(m.id, m.patch, actor);
        return;
      case 'obj_delete':
        if (!canEdit(role)) throw new WorldError('You do not have edit permission');
        await this.deleteObject(m.id, actor);
        return;
      case 'route_add':
        if (!canEdit(role)) throw new WorldError('You do not have edit permission');
        await this.addRoute(m.route.name, m.route.stopIds, m.route.color, actor);
        return;
      case 'route_delete': {
        if (!canEdit(role)) throw new WorldError('You do not have edit permission');
        if (!this.routes.has(m.id)) throw new WorldError('Route not found');
        await q('delete from city_routes where id = $1 and room_id = $2', [m.id, this.meta.id]);
        this.routes.delete(m.id);
        this.broadcast({ t: 'route_deleted', id: m.id });
        return;
      }
      case 'ludo':
        return this.onLudo(s, m.treeId, m.action, m.seat, m.token);
      case 'quiz':
        return this.onQuiz(s, m);
      case 'battle':
        if (m.action === 'join') {
          this.battle.join(s.id);
          this.send(s, this.battle.roster());
        } else this.battle.leave(s.id);
        return;
      case 'shoot': {
        const players = [...this.sessions.values()].map((x) => ({ id: x.id, name: x.player.name, p: x.player.p }));
        this.battle.shoot({ id: s.id, name: s.player.name, p: s.player.p }, m.o, m.d, players, this.objects.values(), Date.now());
        return;
      }
      case 'sim':
        if (role === 'viewer') throw new WorldError('Viewers cannot control the simulation');
        await this.updateSim(m.patch);
        return;
    }
  }

  // ---------- Quiz ----------
  private sendQuiz(t: QuizTable) {
    const data = JSON.stringify({ t: 'quiz', state: t.view() } satisfies ServerMessage);
    const to = new Set(t.watchers);
    for (const p of t.players) to.add(p.sessionId);
    for (const id of to) {
      const x = this.sessions.get(id);
      if (x && x.ws.readyState === x.ws.OPEN) x.ws.send(data);
    }
  }

  private onQuiz(s: Session, m: Extract<ClientMessage, { t: 'quiz' }>) {
    const tree = this.objects.get(m.treeId);
    if (!tree || tree.type !== 'tree') throw new WorldError('Quiz tables are at trees');
    let t = this.quiz.get(m.treeId);
    if (!t) {
      const table: QuizTable = new QuizTable(m.treeId, () => this.sendQuiz(table), (msg) => { throw new WorldError(msg); });
      this.quiz.set(m.treeId, (t = table));
    }
    const now = Date.now();
    switch (m.action) {
      case 'watch': t.watchers.add(s.id); break;
      case 'unwatch':
        t.watchers.delete(s.id);
        if (t.empty) { t.dispose(); this.quiz.delete(m.treeId); }
        return;
      case 'join': t.join({ id: s.id, userId: s.player.userId, name: s.player.name }); break;
      case 'leave': if (!t.leave(s.id)) return; break;
      case 'config': t.config(s.id, { count: m.count, seconds: m.seconds, category: m.category }); break;
      case 'start': t.start(s.id, now); break;
      case 'answer':
        if (m.choice === undefined) throw new WorldError('Pick an answer');
        t.answer(s.id, m.choice, now);
        break;
    }
    this.sendQuiz(t);
  }

  // ---------- Ludo ----------
  private sendLudo(g: { state: LudoState; watchers: Set<string> }, dice?: number) {
    const to = new Set(g.watchers);
    for (const p of g.state.seats) if (p) to.add(p.sessionId);
    const data = JSON.stringify({ t: 'ludo', state: g.state, dice } satisfies ServerMessage);
    for (const id of to) {
      const s = this.sessions.get(id);
      if (s && s.ws.readyState === s.ws.OPEN) s.ws.send(data);
    }
  }

  /** Idle turn: after the deadline the server rolls and/or moves for the player so the table never stalls. */
  private scheduleLudo(g: { state: LudoState; watchers: Set<string>; timer?: NodeJS.Timeout }) {
    clearTimeout(g.timer);
    if (g.state.phase !== 'playing') return;
    g.timer = setTimeout(() => {
      const st = g.state, now = Date.now();
      if (st.phase !== 'playing') return;
      let dice: number | undefined;
      if (st.roll === null) { dice = randomInt(1, 7); applyRoll(st, dice, now); }
      if (st.phase === 'playing' && st.roll !== null) applyMove(st, legalTokens(st, st.roll)[0], now);
      st.event += ' (auto, player idle)';
      this.sendLudo(g, dice);
      this.scheduleLudo(g);
    }, Math.max(0, g.state.turnDeadline - Date.now()) + 50);
  }

  private onLudo(s: Session, treeId: string, action: string, seat?: number, token?: number) {
    const tree = this.objects.get(treeId);
    if (!tree || tree.type !== 'tree') throw new WorldError('Ludo tables are at trees');
    let g = this.ludo.get(treeId);
    if (!g) this.ludo.set(treeId, (g = { state: newLudo(treeId), watchers: new Set() }));
    const st = g.state, now = Date.now();
    const mySeat = st.seats.findIndex((p) => p?.sessionId === s.id);
    let dice: number | undefined;
    switch (action) {
      case 'watch':
        g.watchers.add(s.id);
        break;
      case 'unwatch':
        g.watchers.delete(s.id);
        if (!g.watchers.size && st.seats.every((p) => !p)) { clearTimeout(g.timer); this.ludo.delete(treeId); }
        return;
      case 'join': {
        if (st.phase === 'playing') throw new WorldError('A game is running at this tree. Watch, or try another tree.');
        if (mySeat >= 0) throw new WorldError('You are already at this table');
        if (st.seats.some((p) => p?.userId === s.player.userId)) throw new WorldError('You are already playing here in another tab');
        const target = seat ?? st.seats.findIndex((p) => !p);
        if (target < 0 || st.seats[target]) throw new WorldError('That seat is taken');
        if (st.phase === 'finished') Object.assign(st, newLudo(treeId), { seats: st.seats });
        st.seats[target] = { userId: s.player.userId, name: s.player.name, sessionId: s.id };
        st.event = `${s.player.name} sat down`;
        g.watchers.add(s.id);
        break;
      }
      case 'leave':
        if (mySeat < 0) return;
        removePlayer(st, mySeat, now);
        break;
      case 'start':
        if (mySeat < 0) throw new WorldError('Take a seat first');
        if (st.phase === 'playing') return;
        if (st.seats.filter(Boolean).length < 2) throw new WorldError('Ludo needs at least 2 players');
        startGame(st, now);
        break;
      case 'roll':
        if (st.phase !== 'playing' || mySeat !== st.turn) throw new WorldError('Not your turn');
        if (st.roll !== null) throw new WorldError('Move a token first');
        dice = randomInt(1, 7);
        applyRoll(st, dice, now);
        break;
      case 'move':
        if (st.phase !== 'playing' || mySeat !== st.turn) throw new WorldError('Not your turn');
        if (token === undefined || !applyMove(st, token, now)) throw new WorldError('That token cannot move');
        break;
    }
    this.sendLudo(g, dice);
    this.scheduleLudo(g);
  }

  /** Owner changed someone's role: update live sessions in place. */
  setRole(userId: string, role: Role) {
    for (const s of this.sessions.values()) {
      if (s.player.userId !== userId) continue;
      s.player.role = role;
      this.broadcast({ t: 'role', id: s.id, role });
    }
  }
  kick(userId: string) {
    for (const s of this.sessions.values()) {
      if (s.player.userId !== userId) continue;
      this.send(s, { t: 'error', message: 'You were removed from this room by the owner', fatal: true });
      s.ws.close(4003, 'Removed');
    }
  }

  async system(text: string) {
    await this.chat(null, 'CIVITAS', text, 'system');
  }

  async chat(senderId: string | null, senderName: string, content: string, type: ChatMessage['type']) {
    const [row] = await q(
      'insert into room_messages (room_id, sender_id, sender_name, content, message_type) values ($1,$2,$3,$4,$5) returning *',
      [this.meta.id, senderId, senderName, content, type],
    );
    const message = rowToMessage(row);
    this.messages.push(message);
    if (this.messages.length > 50) this.messages.shift();
    this.broadcast({ t: 'chat', message });
  }

  private bumpVersion() {
    return q(
      `insert into city_scenes (room_id, scene_data, version) values ($1, '{}', 1)
       on conflict (room_id) do update set version = city_scenes.version + 1, updated_at = now()`,
      [this.meta.id],
    );
  }

  /** Validate + persist + broadcast. Same path for manual edits and AI-generated edits. */
  async addObject(input: unknown, actor: { userId: string | null; name: string }): Promise<CityObject> {
    const parsed = objectSpecSchema.safeParse(input);
    if (!parsed.success) throw new WorldError('Invalid object: ' + parsed.error.issues[0]?.message);
    if (this.objects.size >= MAX_OBJECTS) throw new WorldError(`Object limit reached (${MAX_OBJECTS})`);
    const spec = normalizeSpec(parsed.data, this.meta.worldSize);
    if (spec.type === 'artwork') {
      // A photo sculpture must point at an image uploaded to this same room.
      const ok = spec.props.assetId && (await q('select 1 from artworks where id = $1 and room_id = $2', [spec.props.assetId, this.meta.id])).length;
      if (!ok) throw new WorldError('Make a photo sculpture with the photo-to-3D studio in a park');
    }
    const [row] = await q(
      `insert into city_objects (room_id, object_type, asset_id, position, rotation, scale, properties, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
      [this.meta.id, spec.type, spec.type, spec.position, { y: spec.rotationY }, spec.scale, spec.props, actor.userId],
    );
    const obj = rowToObject(row);
    this.objects.set(obj.id, obj);
    await this.bumpVersion();
    this.broadcast({ t: 'obj_added', object: obj });
    return obj;
  }

  async updateObject(id: string, patch: Partial<ObjectSpec>, _actor: { userId: string | null; name: string }) {
    const cur = this.objects.get(id);
    if (!cur) throw new WorldError('Object no longer exists');
    const merged = { ...cur, ...patch, props: patch.props ? { ...cur.props, ...patch.props } : cur.props };
    const parsed = objectSpecSchema.safeParse(merged);
    if (!parsed.success) throw new WorldError('Invalid change: ' + parsed.error.issues[0]?.message);
    const spec = normalizeSpec(parsed.data, this.meta.worldSize);
    await q(
      `update city_objects set position=$3, rotation=$4, scale=$5, properties=$6, updated_at=now() where id=$1 and room_id=$2`,
      [id, this.meta.id, spec.position, { y: spec.rotationY }, spec.scale, spec.props],
    );
    const obj: CityObject = { ...spec, id, createdBy: cur.createdBy };
    this.objects.set(id, obj);
    await this.bumpVersion();
    this.broadcast({ t: 'obj_updated', object: obj });
  }

  async deleteObject(id: string, actor: { userId: string | null; name: string }) {
    const cur = this.objects.get(id);
    if (!cur) throw new WorldError('Object no longer exists');
    const client = await pool.connect();
    const affected: CityRoute[] = [];
    try {
      await client.query('begin');
      await client.query('delete from city_objects where id = $1 and room_id = $2', [id, this.meta.id]);
      if (cur.type === 'artwork' && cur.props.assetId) {
        await client.query('delete from artworks where id = $1 and room_id = $2', [cur.props.assetId, this.meta.id]);
      }
      // Deleting a stop removes it from routes; routes with <2 stops are dropped.
      if (cur.type === 'bus_stop') {
        for (const r of this.routes.values()) {
          if (!r.stopIds.includes(id)) continue;
          const stopIds = r.stopIds.filter((s) => s !== id);
          if (stopIds.length < 2) await client.query('delete from city_routes where id = $1', [r.id]);
          else await client.query('update city_routes set route_data = $2 where id = $1', [r.id, { stopIds, color: r.color }]);
          affected.push({ ...r, stopIds });
        }
      }
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
    this.objects.delete(id);
    this.broadcast({ t: 'obj_deleted', id });
    const quiz = this.quiz.get(id);
    if (quiz) {
      quiz.dispose();
      quiz.phase = 'finished';
      quiz.event = 'The tree was removed, quiz over';
      this.sendQuiz(quiz);
      this.quiz.delete(id);
    }
    const game = this.ludo.get(id);
    if (game) {
      clearTimeout(game.timer);
      Object.assign(game.state, { phase: 'finished', roll: null, event: 'The tree was removed, game over' });
      this.sendLudo(game);
      this.ludo.delete(id);
    }
    for (const r of affected) {
      this.broadcast({ t: 'route_deleted', id: r.id });
      if (r.stopIds.length >= 2) { this.routes.set(r.id, r); this.broadcast({ t: 'route_added', route: r }); }
      else this.routes.delete(r.id);
    }
    await this.bumpVersion();
    logActivity(this.meta.id, actor.userId, actor.name, 'object_deleted', { type: cur.type });
  }

  async addRoute(name: string, stopIds: string[], color: string, actor: { userId: string | null; name: string }) {
    if (new Set(stopIds).size !== stopIds.length) throw new WorldError('A route cannot visit the same stop twice');
    for (const sid of stopIds) if (this.objects.get(sid)?.type !== 'bus_stop') throw new WorldError('Routes can only connect bus stops');
    const [row] = await q(
      'insert into city_routes (room_id, name, transport_type, route_data, created_by) values ($1,$2,$3,$4,$5) returning *',
      [this.meta.id, sanitizeText(name), 'bus', { stopIds, color }, actor.userId],
    );
    const route = rowToRoute(row);
    this.routes.set(route.id, route);
    this.broadcast({ t: 'route_added', route });
    logActivity(this.meta.id, actor.userId, actor.name, 'route_created', { name: route.name, stops: stopIds.length });
    return route;
  }

  async updateSim(p: { running?: boolean; speed?: number; timeOfDay?: number; weather?: SimState['weather']; reset?: true }) {
    const now = Date.now();
    const s = this.sim;
    const next: SimState = { ...s, elapsed: simElapsed(s, now), updatedAt: now };
    if (p.reset) { next.elapsed = 0; next.running = false; }
    if (p.running !== undefined) next.running = p.running;
    if (p.speed !== undefined) next.speed = p.speed;
    if (p.weather) next.weather = p.weather;
    // Shift base so the displayed hour equals the requested one.
    if (p.timeOfDay !== undefined) next.timeOfDay = (((p.timeOfDay - next.elapsed / 60) % 24) + 24) % 24;
    if (p.reset && p.timeOfDay === undefined) next.timeOfDay = simHour(s, now);
    this.sim = next;
    this.broadcast({ t: 'sim', sim: next, serverNow: now });
    await q(
      `insert into city_scenes (room_id, scene_data, version) values ($1, $2, 1)
       on conflict (room_id) do update set scene_data = city_scenes.scene_data || $2, updated_at = now()`,
      [this.meta.id, { sim: next }],
    );
  }
}

export class RoomManager {
  rooms = new Map<string, Promise<CityRoom>>();
  private timer = setInterval(() => this.sweep(), 15_000);

  get(roomId: string, meta: RoomSummary) {
    let p = this.rooms.get(roomId);
    if (!p) {
      p = (async () => { const r = new CityRoom(meta); await r.load(); return r; })();
      p.catch(() => this.rooms.delete(roomId));
      this.rooms.set(roomId, p);
    }
    return p;
  }
  /** Loaded room if any; for HTTP handlers that must route edits through the live room. */
  async live(roomId: string) {
    return this.rooms.get(roomId);
  }
  async onlineCount(roomId: string) {
    const p = this.rooms.get(roomId);
    return p ? (await p).online : 0;
  }

  private async sweep() {
    for (const [id, p] of this.rooms) {
      const room = await p.catch(() => null);
      if (!room) continue;
      room.heartbeat();
      if (!room.sessions.size && Date.now() - room.emptySince > 60_000) {
        room.dispose();
        this.rooms.delete(id);
      }
    }
  }

  close() {
    clearInterval(this.timer);
    for (const p of this.rooms.values()) p.then((r) => r.dispose(), () => {});
  }

  attach(server: Server) {
    const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
    server.on('upgrade', async (req: IncomingMessage, socket, head) => {
      const url = new URL(req.url ?? '/', 'http://x');
      if (url.pathname !== '/ws') return socket.destroy();
      wss.handleUpgrade(req, socket, head, (ws) => this.accept(ws, url).catch((e) => {
        console.error('[ws] accept failed', e);
        ws.close(1011, 'Server error');
      }));
    });
    return wss;
  }

  private async accept(ws: WebSocket, url: URL) {
    const reject = (message: string) => {
      ws.send(JSON.stringify({ t: 'error', message, fatal: true } satisfies ServerMessage));
      ws.close(4000, message.slice(0, 120));
    };
    const identity = verifyToken(url.searchParams.get('token'));
    if (!identity) return reject('Your session expired. Enter your username again.');
    const meta = await getRoom(url.searchParams.get('room') ?? '');
    if (!meta) return reject('Room not found');
    const access = await resolveAccess(meta, identity);
    if (!access.ok) return reject(access.error);
    const room = await this.get(meta.id, meta);
    const sameUser = [...room.sessions.values()].some((s) => s.player.userId === identity.sub);
    if (!sameUser && room.online >= meta.maxParticipants) return reject('Room is full');

    const [p] = await q('select display_name, avatar_color, avatar_url from profiles where id = $1', [identity.sub]);
    if (!p) return reject('Profile not found');
    await room.join(ws, identity, access.role, { name: p.display_name, color: p.avatar_color, avatarUrl: p.avatar_url });
  }
}
