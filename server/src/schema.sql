-- CIVITAS schema. Idempotent: safe to run on every boot.
create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text unique, -- reserved for system accounts / future recovery; normal users are name-only
  password_hash text,
  created_at timestamptz not null default now()
);

-- Upgrade older databases created with email/password auth.
alter table users alter column email drop not null;
alter table users alter column password_hash drop not null;

create table if not exists profiles (
  id uuid primary key references users(id) on delete cascade,
  username text not null unique,
  display_name text not null,
  avatar_url text,
  avatar_color text not null default '#2f7de1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  owner_id uuid not null references users(id) on delete cascade,
  name text not null,
  description text not null default '',
  visibility text not null check (visibility in ('private', 'public')),
  environment_template text not null,
  world_size int not null check (world_size between 32 and 512),
  max_participants int not null check (max_participants between 2 and 50),
  default_role text not null default 'participant' check (default_role in ('editor', 'participant', 'viewer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists rooms_owner_idx on rooms(owner_id);
create index if not exists rooms_public_idx on rooms(visibility, updated_at desc);

create table if not exists room_members (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('owner', 'editor', 'participant', 'viewer')),
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (room_id, user_id)
);
create index if not exists room_members_user_idx on room_members(user_id, last_seen_at desc);

-- Room-level scene settings (simulation config, version counter). Objects live in city_objects.
create table if not exists city_scenes (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null unique references rooms(id) on delete cascade,
  scene_data jsonb not null default '{}',
  version int not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists city_objects (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  object_type text not null,
  asset_id text not null,
  position jsonb not null,
  rotation jsonb not null,
  scale jsonb not null,
  properties jsonb not null default '{}',
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists city_objects_room_idx on city_objects(room_id);

create table if not exists city_routes (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  name text not null,
  transport_type text not null default 'bus',
  route_data jsonb not null,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists city_routes_room_idx on city_routes(room_id);

create table if not exists room_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  sender_id uuid references users(id) on delete set null,
  sender_name text not null,
  content text not null,
  message_type text not null check (message_type in ('user', 'system', 'ai')),
  created_at timestamptz not null default now()
);
create index if not exists room_messages_room_idx on room_messages(room_id, created_at desc);

create table if not exists room_activity (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  actor_name text not null default '',
  activity_type text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists room_activity_room_idx on room_activity(room_id, created_at desc);

create table if not exists ai_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  room_id uuid references rooms(id) on delete cascade,
  prompt text not null,
  result jsonb,
  status text not null check (status in ('ok', 'invalid', 'error', 'denied')),
  created_at timestamptz not null default now()
);

-- Avatar images live in the database so they survive restarts on hosts with ephemeral disks.
create table if not exists avatar_images (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  mime text not null check (mime in ('image/png', 'image/jpeg', 'image/webp')),
  data bytea not null,
  created_at timestamptz not null default now()
);
create index if not exists avatar_images_user_idx on avatar_images(user_id);
