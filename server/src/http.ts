import express, { type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomInt } from 'node:crypto';
import { AccessToken } from 'livekit-server-sdk';
import {
  aiRequestSchema, canTalk, createRoomSchema, loginSchema, nameSchema, profileUpdateSchema, registerSchema, ROLES,
  type Profile, type Role, type RoomSummary,
} from '@civitas/shared';
import { z } from 'zod';
import { checkPassword, hashPassword, issueToken, rateLimiter, readIdentity, requireUser } from './auth.ts';
import { config } from './config.ts';
import { pool, q } from './db.ts';
import { createRoomWithTemplate, getRoom, logActivity, resolveAccess, ROOM_SELECT } from './rooms.ts';
import type { RoomManager } from './realtime.ts';
import { WorldError } from './realtime.ts';
import { runAiCommand } from './ai.ts';
import { providers, ProviderError } from './providers.ts';
import { analysePhoto, renderEdit } from './studio.ts';

const authLimit = rateLimiter(20, 60_000);
const aiLimit = rateLimiter(10, 60_000);
const uploadLimit = rateLimiter(10, 60_000);

const bad = (res: Response, status: number, error: string) => void res.status(status).json({ error });
const parse = <T>(schema: z.ZodType<T>, body: unknown, res: Response): T | null => {
  const r = schema.safeParse(body);
  if (!r.success) {
    const i = r.error.issues[0];
    bad(res, 400, `${i?.path.join('.') || 'input'}: ${i?.message}`);
    return null;
  }
  return r.data;
};

async function profileFor(req: Request): Promise<Profile | null> {
  const id = req.identity!;
  const [p] = await q(
    `select p.id, p.username, p.display_name as "displayName", p.avatar_url as "avatarUrl", p.avatar_color as "avatarColor", u.email
     from profiles p join users u on u.id = p.id where p.id = $1`,
    [id.sub],
  );
  return p ?? null;
}

export function createApp(manager: RoomManager) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1.5mb' }));
  app.use(readIdentity);
  const api = express.Router();

  // Liveness for the host's health checks: must not touch the database, or a scale-to-zero Postgres
  // (Neon free tier) would never sleep and burn its compute quota. Use ?db=1 to check the database too.
  api.get('/health', async (req, res) => {
    if (req.query.db) await q('select 1');
    res.json({ ok: true, livekit: !!config.livekit, ai: providers() });
  });

  // ---------- Identity ----------
  // Creates a user + profile. Usernames are made unique automatically. Without email the token is the only key.
  async function createUser(name: string, email: string | null = null, passwordHash: string | null = null) {
    const base = name.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 18) || 'user';
    const palette = ['#2f7de1', '#e0663a', '#3aa76d', '#9b6fd0', '#d9a520', '#d6457a'];
    const client = await pool.connect();
    try {
      await client.query('begin');
      const { rows: [u] } = await client.query('insert into users (email, password_hash) values ($1, $2) returning id', [email, passwordHash]);
      let username = base.length >= 3 ? base : `${base}_user`;
      for (let i = 0; (await client.query('select 1 from profiles where lower(username) = $1', [username])).rowCount; i++) {
        username = `${base}_${randomInt(1000, 9999)}`;
        if (i > 20) throw new Error('could not allocate username');
      }
      await client.query('insert into profiles (id, username, display_name, avatar_color) values ($1, $2, $3, $4)', [
        u.id, username, name, palette[randomInt(palette.length)],
      ]);
      await client.query('commit');
      return u.id as string;
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  }
  const session = async (req: Request, res: Response, userId: string, status = 200) => {
    req.identity = { sub: userId, exp: 0 };
    res.status(status).json({ token: issueToken(userId), profile: await profileFor(req) });
  };
  const isUniqueViolation = (e: unknown) => (e as { code?: string }).code === '23505';

  // Name-only device account (kept for scripts and tests; the UI signs up with email).
  api.post('/auth/name', async (req, res) => {
    if (!authLimit(req.ip ?? '')) return bad(res, 429, 'Too many attempts. Try again in a minute.');
    const body = parse(nameSchema, req.body, res);
    if (!body) return;
    await session(req, res, await createUser(body.name), 201);
  });

  // Email + password. A signed-in name-only account adds the email to itself, so it keeps its rooms.
  api.post('/auth/register', async (req, res) => {
    if (!authLimit(req.ip ?? '')) return bad(res, 429, 'Too many attempts. Try again in a minute.');
    const body = parse(registerSchema, req.body, res);
    if (!body) return;
    const [taken] = await q('select 1 from users where email = $1', [body.email]);
    if (taken) return bad(res, 409, 'This email already has an account. Sign in instead.');
    const hash = await hashPassword(body.password);
    try {
      if (req.identity) {
        const [me] = await q('select email from users where id = $1', [req.identity.sub]);
        if (me && !me.email) {
          await q('update users set email = $2, password_hash = $3 where id = $1 and email is null', [req.identity.sub, body.email, hash]);
          return void await session(req, res, req.identity.sub);
        }
      }
      if (!body.name) return bad(res, 400, 'name: Enter your name');
      await session(req, res, await createUser(body.name, body.email, hash), 201);
    } catch (e) {
      if (isUniqueViolation(e)) return bad(res, 409, 'This email already has an account. Sign in instead.');
      throw e;
    }
  });

  api.post('/auth/login', async (req, res) => {
    if (!authLimit(req.ip ?? '')) return bad(res, 429, 'Too many attempts. Try again in a minute.');
    const body = parse(loginSchema, req.body, res);
    if (!body) return;
    const [u] = await q('select id, password_hash from users where email = $1', [body.email]);
    if (!u || !(await checkPassword(body.password, u.password_hash))) return bad(res, 401, 'Wrong email or password');
    await session(req, res, u.id);
  });

  api.get('/me', requireUser, async (req, res) => {
    const p = await profileFor(req);
    if (!p) return bad(res, 401, 'Account no longer exists');
    res.json(p);
  });

  api.patch('/me', requireUser, async (req, res) => {
    const body = parse(profileUpdateSchema, req.body, res);
    if (!body) return;
    if (body.username) {
      const [taken] = await q('select 1 from profiles where lower(username) = lower($1) and id <> $2', [body.username, req.identity!.sub]);
      if (taken) return bad(res, 409, 'Username is already taken');
    }
    await q(
      `update profiles set username = coalesce($2, username), display_name = coalesce($3, display_name),
       avatar_color = coalesce($4, avatar_color), updated_at = now() where id = $1`,
      [req.identity!.sub, body.username ?? null, body.displayName ?? null, body.avatarColor ?? null],
    );
    res.json(await profileFor(req));
  });

  // Avatar upload as a data URL. Type is checked by magic bytes, not by the declared mime type.
  api.post('/me/avatar', requireUser, async (req, res) => {
    if (!uploadLimit(req.identity!.sub)) return bad(res, 429, 'Too many uploads');
    const m = typeof req.body?.dataUrl === 'string' && req.body.dataUrl.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return bad(res, 400, 'Upload a PNG, JPEG or WebP image');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 1024 * 1024) return bad(res, 413, 'Image must be under 1 MB');
    const magic = buf.subarray(0, 12).toString('hex');
    const ext = magic.startsWith('89504e47') ? 'png' : magic.startsWith('ffd8ff') ? 'jpg' : magic.startsWith('52494646') && magic.endsWith('57454250') ? 'webp' : null;
    if (!ext) return bad(res, 400, 'File is not a valid image');
    // Stored in Postgres: hosting disks (e.g. Render free) are wiped on every restart.
    const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    const [img] = await q('insert into avatar_images (user_id, mime, data) values ($1, $2, $3) returning id', [req.identity!.sub, mime, buf]);
    await q('delete from avatar_images where user_id = $1 and id <> $2', [req.identity!.sub, img.id]);
    await q('update profiles set avatar_url = $2, updated_at = now() where id = $1', [req.identity!.sub, `/api/avatars/${img.id}`]);
    res.json(await profileFor(req));
  });

  // ---------- Photo sculptures (photo -> AI depth map -> 3D relief) ----------
  // The depth model runs in the browser; the server only validates and stores the two images.
  const imageOf = (dataUrl: unknown, maxBytes: number, types: string[]) => {
    const m = typeof dataUrl === 'string' && dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return null;
    const buf = Buffer.from(m[2], 'base64');
    const magic = buf.subarray(0, 12).toString('hex');
    const mime = magic.startsWith('89504e47') ? 'image/png' : magic.startsWith('ffd8ff') ? 'image/jpeg' : magic.startsWith('52494646') && magic.endsWith('57454250') ? 'image/webp' : null;
    if (!mime || !types.includes(mime) || buf.length > maxBytes) return null;
    return { buf, mime };
  };
  api.post('/rooms/:id/artworks', requireUser, async (req, res) => {
    if (!uploadLimit(req.identity!.sub)) return bad(res, 429, 'Too many uploads. Try again in a minute.');
    const room = await getRoom(String(req.params.id));
    if (!room) return bad(res, 404, 'Room not found');
    const access = await resolveAccess(room, req.identity, false);
    if (!access.ok) return bad(res, access.status, access.error);
    if (access.role !== 'owner' && access.role !== 'editor') return bad(res, 403, 'You need edit permission to add sculptures');
    const image = imageOf(req.body?.image, 1_200_000, ['image/jpeg', 'image/png', 'image/webp']);
    if (!image) return bad(res, 400, 'Photo must be a JPEG, PNG or WebP under 1.2 MB');
    const depth = imageOf(req.body?.depth, 400_000, ['image/png']);
    if (!depth) return bad(res, 400, 'Depth map must be a PNG under 400 KB');
    const [row] = await q('insert into artworks (room_id, user_id, image, image_mime, depth) values ($1, $2, $3, $4, $5) returning id', [
      room.id, req.identity!.sub, image.buf, image.mime, depth.buf,
    ]);
    res.status(201).json({ id: row.id });
  });
  api.get('/artworks/:id/:kind', async (req, res) => {
    const { id, kind } = req.params;
    if (!/^[0-9a-f-]{36}$/i.test(id) || (kind !== 'image' && kind !== 'depth')) return bad(res, 404, 'Not found');
    const [a] = await q(`select ${kind === 'image' ? 'image as data, image_mime as mime' : "depth as data, 'image/png' as mime"} from artworks where id = $1`, [id]);
    if (!a) return bad(res, 404, 'Not found');
    res.set({ 'content-type': a.mime, 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' });
    res.send(a.data);
  });

  // ---------- Fountain studio: realistic AI photo transformations ----------
  const studioLimit = rateLimiter(6, 60_000);
  const studioAccess = async (req: Request, res: Response, edit = false) => {
    const room = await getRoom(String(req.params.id));
    if (!room) return bad(res, 404, 'Room not found'), null;
    const access = await resolveAccess(room, req.identity, false);
    if (!access.ok) return bad(res, access.status, access.error), null;
    // Creating spends paid AI calls, so only owners and editors may; everyone in the room can see the gallery.
    if (edit && access.role !== 'owner' && access.role !== 'editor') return bad(res, 403, 'You need edit permission to use the studio'), null;
    return room;
  };
  const studioBody = z.object({
    image: z.string().max(2_000_000),
    kind: z.enum(['age', 'era', 'restyle', 'custom']),
    params: z.object({ age: z.number().int().min(1).max(100).optional(), year: z.number().int().min(1800).max(2200).optional(), style: z.string().trim().min(3).max(200).optional() }).default({}),
  });
  const paramsOk = (kind: string, p: { age?: number; year?: number; style?: string }) =>
    (kind === 'age' && p.age !== undefined) || (kind === 'era' && p.year !== undefined) || ((kind === 'restyle' || kind === 'custom') && !!p.style);

  api.get('/studio/capabilities', (_req, res) => res.json(providers()));

  // Stage 1: a vision model describes the photo and writes the edit instruction (shown to the user, editable).
  api.post('/rooms/:id/studio/analyse', requireUser, async (req, res) => {
    if (!(await studioAccess(req, res, true))) return;
    if (!studioLimit(req.identity!.sub)) return bad(res, 429, 'Studio limit reached (6 per minute). Try again shortly.');
    const body = parse(studioBody, req.body, res);
    if (!body) return;
    if (!paramsOk(body.kind, body.params)) return bad(res, 400, 'Missing parameter for this transformation');
    const image = imageOf(body.image, 1_500_000, ['image/jpeg', 'image/png', 'image/webp']);
    if (!image) return bad(res, 400, 'Photo must be a JPEG, PNG or WebP under 1.5 MB');
    try {
      res.json(await analysePhoto(body.kind, body.params, { mime: image.mime, base64: image.buf.toString('base64') }));
    } catch (e) {
      if (e instanceof ProviderError) return bad(res, 502, e.message);
      throw e;
    }
  });

  // Stage 2: the image model applies the instruction; the result is stored for the room gallery.
  api.post('/rooms/:id/studio/render', requireUser, async (req, res) => {
    const room = await studioAccess(req, res, true);
    if (!room) return;
    if (!studioLimit(req.identity!.sub)) return bad(res, 429, 'Studio limit reached (6 per minute). Try again shortly.');
    const body = parse(studioBody.extend({ instruction: z.string().trim().min(10).max(1500), description: z.string().max(400).optional(), parentId: z.uuid().optional() }), req.body, res);
    if (!body) return;
    const image = imageOf(body.image, 1_500_000, ['image/jpeg', 'image/png', 'image/webp']);
    if (!image) return bad(res, 400, 'Photo must be a JPEG, PNG or WebP under 1.5 MB');
    try {
      const out = await renderEdit(body.kind, body.instruction, { mime: image.mime, base64: image.buf.toString('base64') }, body.description);
      const result = Buffer.from(out.base64, 'base64');
      // Re-edit of an earlier result: keep the link only when that image belongs to this room.
      const [parent] = body.parentId ? await q('select id from studio_images where id = $1 and room_id = $2', [body.parentId, room.id]) : [];
      const [row] = await q(
        'insert into studio_images (room_id, user_id, kind, params, instruction, source, source_mime, result, result_mime, parent_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id, created_at',
        [room.id, req.identity!.sub, body.kind, body.params, body.instruction, image.buf, image.mime, result, out.mime, parent?.id ?? null],
      );
      res.status(201).json({ id: row.id, kind: body.kind, params: body.params, instruction: body.instruction, createdAt: row.created_at, parentId: parent?.id ?? null, note: out.note, shared: false, mine: true });
    } catch (e) {
      if (e instanceof ProviderError) return bad(res, e.status === 429 ? 429 : 502, e.message);
      throw e;
    }
  });

  api.get('/rooms/:id/studio', requireUser, async (req, res) => {
    const room = await studioAccess(req, res);
    if (!room) return;
    res.json(await q(
      `select s.id, s.kind, s.params, s.instruction, s.created_at as "createdAt", s.parent_id as "parentId", p.display_name as "author",
              s.shared, (s.user_id = $2) as mine
       from studio_images s left join profiles p on p.id = s.user_id
       where s.room_id = $1 and (s.shared or s.user_id = $2) order by s.created_at desc limit 120`, [room.id, req.identity!.sub]));
  });
  // Share a result with the room, or make it private again. Only its creator can.
  api.patch('/studio/:id', requireUser, async (req, res) => {
    if (!/^[0-9a-f-]{36}$/i.test(String(req.params.id))) return bad(res, 404, 'Not found');
    const body = parse(z.object({ shared: z.boolean() }), req.body, res);
    if (!body) return;
    const [row] = await q('update studio_images set shared = $3 where id = $1 and user_id = $2 returning id, shared', [req.params.id, req.identity!.sub, body.shared]);
    if (!row) return bad(res, 404, 'Only the person who made this image can change its sharing');
    res.json(row);
  });
  // shortcut: image bytes are served by unguessable id (img tags send no auth header); private images are hidden
  // from other users' gallery lists but not access-controlled per request. Add signed URLs if that matters.
  api.get('/studio/:id/:which', async (req, res) => {
    const { id, which } = req.params;
    if (!/^[0-9a-f-]{36}$/i.test(id) || (which !== 'source' && which !== 'result')) return bad(res, 404, 'Not found');
    const [row] = await q(`select ${which} as data, ${which}_mime as mime from studio_images where id = $1`, [id]);
    if (!row) return bad(res, 404, 'Not found');
    res.set({ 'content-type': row.mime, 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' });
    if (req.query.download !== undefined) {
      const ext = String(row.mime).split('/')[1]?.replace('jpeg', 'jpg') || 'img';
      res.set('content-disposition', `attachment; filename="civitas-${which}-${id.slice(0, 8)}.${ext}"`);
    }
    res.send(row.data);
  });

  api.get('/avatars/:id', async (req, res) => {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return bad(res, 404, 'Not found');
    const [img] = await q('select mime, data from avatar_images where id = $1', [req.params.id]);
    if (!img) return bad(res, 404, 'Not found');
    res.set({ 'content-type': img.mime, 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' });
    res.send(img.data);
  });

  // ---------- Rooms ----------
  const withOnline = async (rooms: RoomSummary[]) =>
    Promise.all(rooms.map(async (r) => ({ ...r, online: await manager.onlineCount(r.id) })));

  api.post('/rooms', requireUser, async (req, res) => {
    const body = parse(createRoomSchema, req.body, res);
    if (!body) return;
    const [{ n }] = await q('select count(*)::int as n from rooms where owner_id = $1', [req.identity!.sub]);
    if (n >= 50) return bad(res, 429, 'Room limit reached (50). Delete a room first.');
    const roomId = await createRoomWithTemplate(req.identity!.sub, body);
    logActivity(roomId, req.identity!.sub, '', 'room_created', { name: body.name });
    res.status(201).json(await getRoom(roomId));
  });

  api.get('/rooms/mine', requireUser, async (req, res) => {
    const rooms = await q<RoomSummary>(
      `${ROOM_SELECT} join room_members m on m.room_id = r.id and m.user_id = $1
       order by m.last_seen_at desc limit 50`,
      [req.identity!.sub],
    );
    const roles = await q('select room_id, role from room_members where user_id = $1', [req.identity!.sub]);
    const roleOf = new Map(roles.map((x) => [x.room_id, x.role]));
    res.json(await withOnline(rooms.map((r) => ({ ...r, myRole: roleOf.get(r.id) }))));
  });

  api.get('/rooms/public', async (_req, res) => {
    res.json(await withOnline(await q<RoomSummary>(`${ROOM_SELECT} where r.visibility = 'public' order by r.updated_at desc limit 30`)));
  });

  // Room preview for the join screen. Does not create membership.
  api.get('/rooms/:idOrCode', async (req, res) => {
    const room = await getRoom(req.params.idOrCode);
    if (!room) return bad(res, 404, 'Room not found. Check the code or link.');
    const access = await resolveAccess(room, req.identity, false);
    res.json({ room: { ...room, online: await manager.onlineCount(room.id) }, access });
  });

  const ownerOnly = async (req: Request, res: Response) => {
    const room = await getRoom(String(req.params.id));
    if (!room) return bad(res, 404, 'Room not found'), null;
    if (room.ownerId !== req.identity!.sub) return bad(res, 403, 'Only the owner can do this'), null;
    return room;
  };

  api.patch('/rooms/:id', requireUser, async (req, res) => {
    const room = await ownerOnly(req, res);
    if (!room) return;
    const body = parse(createRoomSchema.pick({ name: true, description: true, visibility: true, maxParticipants: true, defaultRole: true }).partial(), req.body, res);
    if (!body) return;
    await q(
      `update rooms set name = coalesce($2,name), description = coalesce($3,description), visibility = coalesce($4,visibility),
       max_participants = coalesce($5,max_participants), default_role = coalesce($6,default_role), updated_at = now() where id = $1`,
      [room.id, body.name ?? null, body.description ?? null, body.visibility ?? null, body.maxParticipants ?? null, body.defaultRole ?? null],
    );
    const updated = (await getRoom(room.id))!;
    const live = await manager.live(room.id);
    if (live) Object.assign((await live).meta, updated);
    res.json(updated);
  });

  api.delete('/rooms/:id', requireUser, async (req, res) => {
    const room = await ownerOnly(req, res);
    if (!room) return;
    const live = await manager.live(room.id);
    if (live) for (const s of (await live).sessions.values()) (await live).kick(s.player.userId);
    await q('delete from rooms where id = $1', [room.id]);
    res.status(204).end();
  });

  api.get('/rooms/:id/members', requireUser, async (req, res) => {
    const room = await getRoom(String(req.params.id));
    if (!room) return bad(res, 404, 'Room not found');
    const access = await resolveAccess(room, req.identity, false);
    if (!access.ok) return bad(res, access.status, access.error);
    res.json(await q(
      `select m.user_id as "userId", m.role, p.display_name as "displayName", p.username, p.avatar_url as "avatarUrl", m.last_seen_at as "lastSeenAt"
       from room_members m join profiles p on p.id = m.user_id where m.room_id = $1 order by m.joined_at`, [room.id]));
  });

  api.patch('/rooms/:id/members/:userId', requireUser, async (req, res) => {
    const room = await ownerOnly(req, res);
    if (!room) return;
    const body = parse(z.object({ role: z.enum(ROLES).exclude(['owner']) }), req.body, res);
    if (!body) return;
    if (req.params.userId === room.ownerId) return bad(res, 400, 'The owner role cannot be changed');
    const rows = await q('update room_members set role = $3 where room_id = $1 and user_id = $2 returning user_id', [room.id, req.params.userId, body.role]);
    if (!rows.length) return bad(res, 404, 'Member not found');
    const live = await manager.live(room.id);
    if (live) (await live).setRole(String(req.params.userId), body.role as Role);
    res.json({ ok: true });
  });

  api.delete('/rooms/:id/members/:userId', requireUser, async (req, res) => {
    const room = await ownerOnly(req, res);
    if (!room) return;
    if (req.params.userId === room.ownerId) return bad(res, 400, 'The owner cannot be removed');
    await q('delete from room_members where room_id = $1 and user_id = $2', [room.id, req.params.userId]);
    const live = await manager.live(room.id);
    if (live) (await live).kick(String(req.params.userId));
    res.status(204).end();
  });

  api.get('/activity', requireUser, async (req, res) => {
    res.json(await q(
      `select a.id, a.activity_type as type, a.actor_name as "actorName", a.metadata, a.created_at as "createdAt", r.name as "roomName", r.id as "roomId"
       from room_activity a join rooms r on r.id = a.room_id
       where a.room_id in (select room_id from room_members where user_id = $1)
       order by a.created_at desc limit 20`, [req.identity!.sub]));
  });

  // ---------- LiveKit media token ----------
  api.post('/rooms/:id/media-token', requireUser, async (req, res) => {
    if (!config.livekit) return bad(res, 503, 'Voice and video are not configured on this server (LIVEKIT_* env vars missing).');
    const room = await getRoom(String(req.params.id));
    if (!room) return bad(res, 404, 'Room not found');
    const access = await resolveAccess(room, req.identity, false);
    if (!access.ok) return bad(res, access.status, access.error);
    const profile = await profileFor(req);
    const at = new AccessToken(config.livekit.key, config.livekit.secret, {
      identity: req.identity!.sub, name: profile?.displayName ?? 'Someone', ttl: '6h',
    });
    const talk = canTalk(access.role);
    at.addGrant({ room: `civitas-${room.id}`, roomJoin: true, canSubscribe: true, canPublish: talk, canPublishData: false });
    res.json({ url: config.livekit.url, token: await at.toJwt(), canPublish: talk });
  });

  // ---------- AI ----------
  api.post('/rooms/:id/ai', requireUser, async (req, res) => {
    const room = await getRoom(String(req.params.id));
    if (!room) return bad(res, 404, 'Room not found');
    const access = await resolveAccess(room, req.identity, false);
    if (!access.ok) return bad(res, access.status, access.error);
    if (!aiLimit(req.identity!.sub)) return bad(res, 429, 'AI limit reached (10 requests per minute). Try again shortly.');
    const body = parse(aiRequestSchema, req.body, res);
    if (!body) return;
    const live = await manager.live(room.id);
    if (!live) return bad(res, 409, 'Join the room before using the assistant');
    const city = await live;
    const userId = req.identity!.sub;
    const profile = await profileFor(req);
    try {
      const isEdit = !/(suggest|analy|improv|recommend|gap|distribution|evaluate|saran|analisis)/i.test(body.prompt);
      if (isEdit && access.role !== 'owner' && access.role !== 'editor') {
        await q('insert into ai_requests (user_id, room_id, prompt, status) values ($1,$2,$3,$4)', [userId, room.id, body.prompt, 'denied']);
        return bad(res, 403, 'You need edit permission to change the city. You can still ask for analysis.');
      }
      const result = await runAiCommand(city, body.prompt, body.origin ?? { x: 0, z: 0 }, { userId, name: profile?.displayName ?? 'Someone' });
      await q('insert into ai_requests (user_id, room_id, prompt, result, status) values ($1,$2,$3,$4,$5)', [userId, room.id, body.prompt, result, 'ok']);
      if (result.createdObjectIds.length || result.createdRouteId) await city.chat(null, 'AI Assistant', `${profile?.displayName}: "${body.prompt}" → ${result.summary}`, 'ai');
      res.json(result);
    } catch (e) {
      const status = e instanceof WorldError ? 'invalid' : 'error';
      await q('insert into ai_requests (user_id, room_id, prompt, result, status) values ($1,$2,$3,$4,$5)', [userId, room.id, body.prompt, { error: String(e) }, status]);
      if (e instanceof WorldError) return bad(res, 422, e.message);
      throw e;
    }
  });

  // Unknown API routes: explicit JSON instead of Express's HTML 404 (e.g. a new client talking to an old server).
  api.use((req, res) => bad(res, 404, `This server does not have ${req.method} /api${req.path}. Restart the server so it runs the latest code.`));
  app.use('/api', api);
  app.use('/uploads', express.static(fileURLToPath(config.uploadDir), { maxAge: '7d', immutable: true }));

  // Serve the built client in production (single-process deploy). In dev, Vite serves it.
  const dist = fileURLToPath(config.clientDist);
  if (existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api|\/uploads|\/ws).*/, (_req, res) => res.sendFile('index.html', { root: dist }));
  }

  app.use((err: any, _req: Request, res: Response, _next: express.NextFunction) => {
    if (err?.type === 'entity.too.large') return bad(res, 413, 'Request too large');
    if (err instanceof SyntaxError) return bad(res, 400, 'Malformed JSON');
    console.error('[http]', err);
    bad(res, 500, 'Server error');
  });
  return app;
}
