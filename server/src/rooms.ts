// Room data access + access control shared by HTTP routes and the realtime server.
import { randomInt } from 'node:crypto';
import type { CreateRoomInput, Role, RoomSummary } from '@civitas/shared';
import type { Identity } from './auth.ts';
import { pool, q } from './db.ts';
import { generateTemplate } from './templates.ts';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const newRoomCode = () => Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');

export const ROOM_SELECT = `
  select r.id, r.code, r.name, r.description, r.visibility, r.environment_template as template,
         r.world_size as "worldSize", r.max_participants as "maxParticipants", r.default_role as "defaultRole",
         r.owner_id as "ownerId", p.display_name as "ownerName", r.updated_at as "updatedAt"
  from rooms r join profiles p on p.id = r.owner_id`;

export async function getRoom(idOrCode: string): Promise<RoomSummary | null> {
  const isUuid = /^[0-9a-f-]{36}$/i.test(idOrCode);
  const rows = await q<RoomSummary>(`${ROOM_SELECT} where ${isUuid ? 'r.id = $1' : 'r.code = upper($1)'}`, [idOrCode]);
  return rows[0] ?? null;
}

export type Access = { ok: true; role: Role } | { ok: false; status: number; error: string };

/**
 * Decide the caller's role in a room. Knowing the room id/code is the invitation for private rooms.
 * First-time visitors get a membership row with the room's default role.
 */
export async function resolveAccess(room: RoomSummary, id: Identity | undefined, persist = true): Promise<Access> {
  if (!id) return { ok: false, status: 401, error: 'Enter a username to join' };
  if (id.sub === room.ownerId) return { ok: true, role: 'owner' };
  const [m] = await q<{ role: Role }>('select role from room_members where room_id = $1 and user_id = $2', [room.id, id.sub]);
  if (m) {
    if (persist) await q('update room_members set last_seen_at = now() where room_id = $1 and user_id = $2', [room.id, id.sub]);
    return { ok: true, role: m.role };
  }
  if (persist) {
    await q('insert into room_members (room_id, user_id, role) values ($1, $2, $3) on conflict do nothing', [room.id, id.sub, room.defaultRole]);
  }
  return { ok: true, role: room.defaultRole };
}

export const logActivity = (roomId: string, userId: string | null, actorName: string, type: string, metadata: object = {}) =>
  q('insert into room_activity (room_id, user_id, actor_name, activity_type, metadata) values ($1, $2, $3, $4, $5)', [
    roomId, userId, actorName, type, JSON.stringify(metadata),
  ]).catch((e) => console.error('[activity]', e.message));

/** Create a room, its owner membership, scene row and template objects/routes in one transaction. */
export async function createRoomWithTemplate(ownerId: string, body: CreateRoomInput): Promise<string> {
  const { objects, routes } = generateTemplate(body.template, body.worldSize);
  const client = await pool.connect();
  try {
    await client.query('begin');
    const { rows: [r] } = await client.query(
      `insert into rooms (code, owner_id, name, description, visibility, environment_template, world_size, max_participants, default_role)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [newRoomCode(), ownerId, body.name, body.description, body.visibility, body.template, body.worldSize, body.maxParticipants, body.defaultRole],
    );
    await client.query('insert into room_members (room_id, user_id, role) values ($1, $2, $3)', [r.id, ownerId, 'owner']);
    await client.query(`insert into city_scenes (room_id, scene_data, version) values ($1, '{}', 0)`, [r.id]);
    if (objects.length) {
      // One multi-row insert keeps template creation to a single round trip.
      await client.query(
        `insert into city_objects (id, room_id, object_type, asset_id, position, rotation, scale, properties, created_by)
         select (o->>'id')::uuid, $1, o->>'type', o->>'type', o->'position', jsonb_build_object('y', (o->>'rotationY')::float), o->'scale', o->'props', null
         from jsonb_array_elements($2::jsonb) o`,
        [r.id, JSON.stringify(objects)],
      );
    }
    for (const rt of routes) {
      await client.query('insert into city_routes (id, room_id, name, transport_type, route_data) values ($1,$2,$3,$4,$5)', [
        rt.id, r.id, rt.name, 'bus', { stopIds: rt.stopIds, color: rt.color },
      ]);
    }
    await client.query('commit');
    return r.id;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

/** Public demo environments owned by a system account that cannot log in. Idempotent. */
export async function seedDemos() {
  const [u] = await q(
    `insert into users (email) values ('demo@civitas.local') on conflict (email) do update set email = excluded.email returning id`,
  );
  await q(`insert into profiles (id, username, display_name, avatar_color) values ($1, 'civitas', 'CIVITAS', '#2f6fe4') on conflict do nothing`, [u.id]);
  const [{ n }] = await q('select count(*)::int as n from rooms where owner_id = $1', [u.id]);
  if (n) return;
  const demos: CreateRoomInput[] = [
    { name: 'Demo: Modern City', description: 'Explore and edit a mid-size city with a bus line.', template: 'modern_city' },
    { name: 'Demo: University Campus', description: 'Faculties, dorms and green quads.', template: 'university_campus' },
    { name: 'Demo: Transportation Hub', description: 'Two bus lines to play with in the simulation.', template: 'transport_hub' },
  ].map((d) => ({ ...d, template: d.template as CreateRoomInput['template'], visibility: 'public', maxParticipants: 20, worldSize: 160, defaultRole: 'editor' }));
  for (const d of demos) await createRoomWithTemplate(u.id, d);
}
