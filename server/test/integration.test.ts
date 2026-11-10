// End-to-end server test against a real Postgres (DATABASE_URL, default civitas_test) and real WebSockets.
process.env.DATABASE_URL ??= 'postgres://localhost:5432/civitas_test';
process.env.GEMINI_API_KEY = ''; // always exercise the offline parser here

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import type { ServerMessage } from '@civitas/shared';

const { start } = await import('../src/index.ts');
const { pool } = await import('../src/db.ts');
const { parseOffline } = await import('../src/ai.ts');

let base = '';
let stop: () => Promise<void>;
let manager: any;

before(async () => {
  const s = await start(0);
  stop = s.stop;
  manager = s.manager;
  const addr = s.server.address();
  base = `http://localhost:${typeof addr === 'object' && addr ? addr.port : 0}`;
  await pool.query('truncate users, rooms cascade');
});
after(async () => { await stop(); });

async function api(path: string, opts: { method?: string; token?: string; body?: unknown } = {}) {
  const res = await fetch(base + '/api' + path, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, json: (res.status === 204 ? null : await res.json()) as any };
}

class Client {
  ws: WebSocket;
  msgs: ServerMessage[] = [];
  constructor(token: string, room: string) {
    this.ws = new WebSocket(`${base.replace('http', 'ws')}/ws?room=${room}&token=${encodeURIComponent(token)}`);
    this.ws.on('message', (d) => this.msgs.push(JSON.parse(d.toString())));
  }
  send(m: object) { this.ws.send(JSON.stringify(m)); }
  async wait<T extends ServerMessage['t']>(t: T, pred: (m: Extract<ServerMessage, { t: T }>) => boolean = () => true, ms = 3000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const m = this.msgs.find((x) => x.t === t && pred(x as any));
      if (m) return m as Extract<ServerMessage, { t: T }>;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`timeout waiting for ${t}`);
  }
  close() { this.ws.close(); }
}

const users: { token: string; id: string }[] = [];
let roomId = '';
let roomCode = '';

test('name-only identity and profile', async () => {
  for (let i = 0; i < 5; i++) {
    const r = await api('/auth/name', { body: { name: i === 0 ? 'Alice' : `User ${i}` } });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    users.push({ token: r.json.token, id: r.json.profile.id });
  }
  // Same name twice is fine: usernames are made unique, display names may repeat.
  const dup = await api('/auth/name', { body: { name: 'Alice' } });
  assert.equal(dup.status, 201);
  assert.equal(dup.json.profile.displayName, 'Alice');
  assert.notEqual(dup.json.profile.username, 'alice');
  assert.equal((await api('/auth/name', { body: { name: 'x' } })).status, 400);
  assert.equal((await api('/auth/name', { body: { name: '<script>' } })).status, 400);
  const me = await api('/me', { method: 'PATCH', token: users[0].token, body: { displayName: 'Alice B', avatarColor: '#112233' } });
  assert.equal(me.json.displayName, 'Alice B');
  assert.equal((await api('/me', { token: 'forged.token' })).status, 401);
  assert.equal((await api('/rooms', { body: {} })).status, 401);
});

test('email + password accounts', async () => {
  const email = `ana${Date.now()}@Example.com`;
  const reg = await api('/auth/register', { body: { name: 'Ana', email, password: 'secret-pass' } });
  assert.equal(reg.status, 201, JSON.stringify(reg.json));
  assert.equal(reg.json.profile.email, email.toLowerCase());
  assert.equal((await api('/auth/register', { body: { name: 'Ana', email, password: 'secret-pass' } })).status, 409);
  assert.equal((await api('/auth/register', { body: { name: 'Ana', email: 'x@y.co', password: 'short' } })).status, 400);
  assert.equal((await api('/auth/login', { body: { email, password: 'wrong-pass' } })).status, 401);
  const login = await api('/auth/login', { body: { email: ` ${email.toUpperCase()} `, password: 'secret-pass' } });
  assert.equal(login.status, 200);
  assert.equal(login.json.profile.id, reg.json.profile.id);
  // A name-only account adds an email and keeps its identity (and so its rooms).
  const guest = await api('/auth/name', { body: { name: 'Guest' } });
  const email2 = `guest${Date.now()}@example.com`;
  const up = await api('/auth/register', { token: guest.json.token, body: { email: email2, password: 'secret-pass' } });
  assert.equal(up.status, 200);
  assert.equal(up.json.profile.id, guest.json.profile.id);
  assert.equal((await api('/auth/login', { body: { email: email2, password: 'secret-pass' } })).json.profile.id, guest.json.profile.id);
});

test('avatar upload validates content', async () => {
  const png = 'data:image/png;base64,' + Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64');
  const up = await api('/me/avatar', { token: users[0].token, body: { dataUrl: png } });
  assert.equal(up.status, 200);
  assert.match(up.json.avatarUrl, /^\/api\/avatars\//);
  const img = await fetch(base + up.json.avatarUrl);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal(Buffer.from(await img.arrayBuffer()).toString('hex'), '89504e470d0a1a0a0000000d49484452', 'served from the database byte-for-byte');
  const fake = 'data:image/png;base64,' + Buffer.from('<script>alert(1)</script>').toString('base64');
  assert.equal((await api('/me/avatar', { token: users[0].token, body: { dataUrl: fake } })).status, 400);
});

test('create room from template', async () => {
  const r = await api('/rooms', {
    token: users[0].token,
    body: { name: 'Test City', description: 'x', visibility: 'private', maxParticipants: 6, template: 'modern_city', worldSize: 160, defaultRole: 'editor' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  roomId = r.json.id;
  roomCode = r.json.code;
  assert.match(roomCode, /^[A-Z2-9]{8}$/);
  assert.equal((await api('/rooms', { token: users[0].token, body: { name: '' } })).status, 400);
  const preview = await api(`/rooms/${roomCode.toLowerCase()}`, { token: users[1].token });
  assert.equal(preview.json.room.id, roomId);
  assert.equal(preview.json.access.role, 'editor');
});

test('five users share a room: presence, movement, edits, chat', async () => {
  // Owner joins first so it observes the other four joining.
  const clients = [new Client(users[0].token, roomId)];
  await clients[0].wait('init');
  clients.push(...users.slice(1).map((u) => new Client(u.token, roomId)));
  const inits = await Promise.all(clients.map((c) => c.wait('init')));
  assert.ok(inits[0].objects.length > 50, 'template objects loaded');
  assert.ok(inits[0].routes.length >= 1);
  assert.equal(inits[0].self.role, 'owner');
  await clients[0].wait('player_join', () => clients[0].msgs.filter((m) => m.t === 'player_join').length >= 4);

  // movement -> snapshot to others
  clients[1].send({ t: 'move', p: [10, 0, 12], r: 1.5, a: 'walk' });
  const snap = await clients[3].wait('snap', (m) => m.players.some((p) => p[0] === inits[1].self.sessionId && p[1] === 10));
  assert.ok(snap);
  // out-of-world positions are clamped by the server
  clients[2].send({ t: 'move', p: [99999, 0, 0], r: 0, a: 'idle' });
  await clients[4].wait('snap', (m) => m.players.some((p) => p[0] === inits[2].self.sessionId && p[1] === 82));

  // object placement is validated, snapped and broadcast
  clients[1].send({ t: 'obj_add', spec: { type: 'office', position: { x: 10.4, y: 5, z: -3.6 }, rotationY: 0.1, scale: { x: 1, y: 1, z: 1 }, props: { floors: 10 } } });
  const added = await clients[4].wait('obj_added', (m) => m.object.props.floors === 10);
  assert.deepEqual(added.object.position, { x: 10, y: 0, z: -4 });
  assert.equal(added.object.rotationY, 0);

  clients[2].send({ t: 'obj_update', id: added.object.id, patch: { rotationY: Math.PI / 2, props: { color: '#ff0000' } } });
  const upd = await clients[0].wait('obj_updated', (m) => m.object.id === added.object.id);
  assert.equal(upd.object.props.color, '#ff0000');
  assert.equal(upd.object.props.floors, 10);

  // invalid ops are rejected
  clients[1].send({ t: 'obj_add', spec: { type: 'rocket', position: { x: 0, y: 0, z: 0 } } });
  await clients[1].wait('error');

  clients[3].send({ t: 'chat', text: '  hello city  ' });
  const chat = await clients[0].wait('chat', (m) => m.message.type === 'user');
  assert.equal(chat.message.content, 'hello city');

  // simulation is shared
  clients[0].send({ t: 'sim', patch: { running: true, speed: 2, weather: 'rain' } });
  const sim = await clients[4].wait('sim');
  assert.equal(sim.sim.running, true);
  assert.equal(sim.sim.weather, 'rain');

  // demote user 4 to viewer -> edits refused live
  assert.equal((await api(`/rooms/${roomId}/members/${users[4].id}`, { method: 'PATCH', token: users[0].token, body: { role: 'viewer' } })).status, 200);
  await clients[4].wait('role', (m) => m.role === 'viewer');
  clients[4].send({ t: 'obj_delete', id: added.object.id });
  const err = await clients[4].wait('error', (m) => /permission/.test(m.message));
  assert.ok(err);
  assert.equal((await api(`/rooms/${roomId}/members/${users[0].id}`, { method: 'PATCH', token: users[1].token, body: { role: 'viewer' } })).status, 403);

  // delete by editor
  clients[1].send({ t: 'obj_delete', id: added.object.id });
  await clients[2].wait('obj_deleted', (m) => m.id === added.object.id);

  // AI: create object + route + analysis through the same validated path
  const ai = await api(`/rooms/${roomId}/ai`, { token: users[1].token, body: { prompt: 'Create a modern office building with ten floors near the park', origin: { x: 0, z: 0 } } });
  assert.equal(ai.status, 200, JSON.stringify(ai.json));
  assert.equal(ai.json.createdObjectIds.length, 1);
  const aiObj = await clients[3].wait('obj_added', (m) => m.object.id === ai.json.createdObjectIds[0]);
  assert.equal(aiObj.object.props.floors, 10);
  const route = await api(`/rooms/${roomId}/ai`, { token: users[1].token, body: { prompt: 'Create a bus route connecting three stops' } });
  assert.ok(route.json.createdRouteId, JSON.stringify(route.json));
  await clients[0].wait('route_added', (m) => m.route.id === route.json.createdRouteId && m.route.stopIds.length === 3);
  const adv = await api(`/rooms/${roomId}/ai`, { token: users[4].token, body: { prompt: 'Analyze the distribution of public facilities' } });
  assert.equal(adv.status, 200);
  assert.ok(adv.json.analysis.residentialTotal >= 0);
  assert.equal((await api(`/rooms/${roomId}/ai`, { token: users[4].token, body: { prompt: 'add a tree' } })).status, 403);

  // reconnect: a new socket gets full state including the AI-built object
  clients[2].close();
  await clients[0].wait('player_leave', (m) => m.id === inits[2].self.sessionId);
  const again = new Client(users[2].token, roomId);
  const init2 = await again.wait('init');
  assert.ok(init2.objects.some((o) => o.id === aiObj.object.id));
  assert.ok(init2.messages.some((m) => m.content === 'hello city'));
  for (const c of [...clients, again]) c.close();
});

test('state is persisted in the database', async () => {
  const { rows } = await pool.query('select count(*)::int n from city_objects where room_id = $1', [roomId]);
  assert.ok(rows[0].n > 50);
  const { rows: [scene] } = await pool.query('select version, scene_data from city_scenes where room_id = $1', [roomId]);
  assert.ok(scene.version > 0);
  assert.equal(scene.scene_data.sim.weather, 'rain');
});

test('viewer room: new joiners cannot edit; bad tokens rejected', async () => {
  const r = await api('/rooms', { token: users[0].token, body: { name: 'Lecture', description: '', visibility: 'public', maxParticipants: 2, template: 'empty_sandbox', worldSize: 96, defaultRole: 'viewer' } });
  assert.equal(r.status, 201);
  const fresh = await api('/auth/name', { body: { name: 'Student' } });
  const c = new Client(fresh.json.token, r.json.id);
  const init = await c.wait('init');
  assert.equal(init.self.role, 'viewer');
  c.send({ t: 'obj_add', spec: { type: 'tree', position: { x: 0, y: 0, z: 0 }, rotationY: 0, scale: { x: 1, y: 1, z: 1 }, props: {} } });
  await c.wait('error', (m) => /permission/.test(m.message));
  c.send({ t: 'chat', text: 'hi' });
  await c.wait('error', (m) => /Viewers cannot chat/.test(m.message));
  // capacity 2: owner + student fill it, a third user is refused
  const owner = new Client(users[0].token, r.json.id);
  await owner.wait('init');
  const third = new Client(users[1].token, r.json.id);
  const full = await third.wait('error');
  assert.match(full.message, /full/);
  for (const x of [c, owner, third]) x.close();

  const bad = new Client('nope', roomId);
  const e = await bad.wait('error');
  assert.equal(e.fatal, true);
});

test('a paused room comes back running after everyone left and it was unloaded', async () => {
  const c = new Client(users[0].token, roomId);
  await c.wait('init');
  c.send({ t: 'sim', patch: { running: false } });
  await c.wait('sim', (m) => m.sim.running === false);
  c.close();
  await new Promise((r) => setTimeout(r, 100));
  // what the idle sweep does after 60 s with nobody inside
  const room = await manager.rooms.get(roomId);
  room.dispose();
  manager.rooms.delete(roomId);
  const back = new Client(users[0].token, roomId);
  const init = await back.wait('init');
  assert.equal(init.sim.running, true);
  assert.equal(init.sim.weather, 'rain', 'other saved settings are kept');
  back.close();
});

test('offline AI parser', () => {
  const a = parseOffline('Create a modern office building with ten floors.');
  assert.equal(a.action, 'create_objects');
  if (a.action === 'create_objects') {
    assert.equal(a.objects[0].type, 'office');
    assert.equal(a.objects[0].floors, 10);
    assert.equal(a.objects[0].style, 'modern');
  }
  const b = parseOffline('Create a five-floor office building near the central park.');
  assert.ok(b.action === 'create_objects' && b.objects[0].floors === 5 && b.objects[0].near === 'park');
  const c = parseOffline('Add three trees near the school');
  assert.ok(c.action === 'create_objects' && c.objects.length === 3 && c.objects[0].type === 'tree');
  assert.equal(parseOffline('Suggest a better transportation layout.').action, 'advice');
  assert.equal(parseOffline('Create a bus route connecting these three stops.').action, 'create_route');
  assert.equal(parseOffline('what is the weather').action, 'unsupported');
  const d = parseOffline('Tambah rumah sakit dekat taman');
  assert.ok(d.action === 'create_objects' && d.objects[0].type === 'hospital' && d.objects[0].near === 'park');
});
