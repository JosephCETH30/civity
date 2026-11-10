# CIVITAS — The City Is Your Meeting Room

Multiplayer 3D city where people meet (voice, video, chat, screen share), build together, run a simple transport simulation and use an AI assistant. No sign-up: pick a username and join.

## Run it locally

Requirements: Node 22+ (tested on 26), PostgreSQL (tested on 18). Optional: `livekit-server` for voice/video (`brew install livekit`).

```bash
npm install
createdb civitas
cp .env.example .env          # edit if needed; everything optional in dev

# terminal 1 (optional, enables voice/video/screen share)
livekit-server --dev          # ws://localhost:7880, key "devkey", secret "secret"
#   then in .env: LIVEKIT_URL=ws://localhost:7880 LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=secret

# terminal 2
npm run dev                   # server :3001 + Vite :5173 (open http://localhost:5173)
```

Phones on the same Wi-Fi can open `http://<your-LAN-IP>:5173`. Camera/mic/screen share in browsers need HTTPS on anything except `localhost`, so for phone media testing put the app behind an HTTPS tunnel or proxy.

Production-style single process: `npm run build && npm start` (server serves `client/dist` on :3001). Set `AUTH_SECRET` and `NODE_ENV=production`.

### Checks

```bash
npm run typecheck             # shared, server, client
npm test                      # server integration tests (real Postgres DB "civitas_test", real WebSockets) + client gameplay tests
node scripts/e2e.mjs http://localhost:3001   # browser E2E with installed Chrome; server must be running with a built client
```

`createdb civitas_test` once before `npm test`. The E2E script drives 3 browsers (2 desktop, 1 Pixel-7 emulation) through: create room → join by invite → presence → chat → place object → AI build + analysis → movement sync → mic + camera via LiveKit → shared simulation → reload persistence → mobile 2D mode. Set `SKIP_MEDIA=1` when LiveKit is not running. Screenshots land in `e2e-artifacts/`.

## Deploy for free (Render + Neon + LiveKit Cloud + your domain)

Everything runs as one Node process (API, WebSocket rooms, built client). `render.yaml` describes it.

1. **Database (Neon, free):** create a project in region *AWS Asia Pacific (Singapore)*. Copy the connection string (it ends in `?sslmode=require`). Tables and demo rooms are created on first boot.
2. **Voice/video (LiveKit Cloud, free Build plan):** create a project, then copy the WebSocket URL (`wss://...livekit.cloud`), API key and API secret.
3. **Code on GitHub:** push this folder to a GitHub repository (`.env`, `node_modules`, builds and uploads are git-ignored).
4. **Server (Render, free):** New → Blueprint → pick the repository. Render reads `render.yaml`, generates `AUTH_SECRET`, and asks for `DATABASE_URL`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (and optionally `GEMINI_API_KEY`). The first deploy gives you `https://civitas-xxxx.onrender.com`.
5. **Domain (Cloudflare DNS):** in Render → Settings → Custom Domains add e.g. `civitas.quesera.id`. In Cloudflare DNS add `CNAME civitas → civitas-xxxx.onrender.com` with proxy status **DNS only** (grey cloud) so Render can issue the HTTPS certificate. For the bare `quesera.id`, use a CNAME on `@` (Cloudflare flattens it).

Free-tier behaviour to expect: Render stops the service after 15 minutes with no visitors and the next visit takes about a minute to wake it (open rooms keep it awake). Neon sleeps after 5 minutes idle and wakes on the next query; the health check deliberately does not touch the database so it can sleep. LiveKit's Build plan hard-stops at its monthly minutes instead of billing. Avatar images are stored in Postgres because Render's disk is wiped on restart.

## Architecture

```
client/  React + Vite + TS + Tailwind v4 + shadcn/ui (Radix) + Three.js/R3F/drei + Zustand + GSAP + livekit-client
server/  Node + Express 5 + ws + pg + livekit-server-sdk (run with tsx)
shared/  zod schemas, domain types, wire protocol, deterministic city analysis (used by both sides)
```

| Concern | Where | Notes |
|---|---|---|
| Identity | `server/src/auth.ts`, `/api/auth/name` | Name only. Server creates a user + unique username and returns a signed token (HMAC) the browser keeps. |
| Rooms, roles, invites | `server/src/rooms.ts`, `http.ts` | owner / editor / participant / viewer. Knowing the 8-char code or link is the invitation. Owner can change roles or remove people (live). |
| Realtime | `server/src/realtime.ts`, `client/src/services/realtime.ts` | Authoritative WebSocket rooms. Clients send moves at 10 Hz; server clamps to world and broadcasts only changed players at 10 Hz. Edits are zod-validated, permission-checked, snapped, persisted, then broadcast. Auto-reconnect with backoff; edits made while disconnected are queued and flushed. |
| Persistence | Postgres, `server/src/schema.sql` | Objects, routes, chat, activity, AI requests, scene settings. Avatar positions are memory-only (never DB rows). |
| 3D engine | `client/src/engine/*` | Procedural low-poly assets (no downloads). Every (object type, part, 80 m chunk) is one `InstancedMesh` → few draw calls, per-chunk frustum + distance culling. Remote avatars interpolate; high-frequency data lives outside React (`engine/core/transient.ts`). |
| Adaptive quality | `engine/optimization/quality.ts`, `CityCanvas.tsx` | Low / balanced / high profiles (DPR, shadows, AA, view distance, details, particles, PBR vs Lambert). Starts conservative, drei `PerformanceMonitor` steps down on low FPS, then lowers resolution. Manual override in Settings. |
| Mobile | `RoomPage.tsx` | Separate layout: full-screen view, bottom nav, sheets, joystick, top-down camera by default, touch-friendly object controls. |
| 2D fallback | `engine/fallback/Map2D.tsx` | Canvas 2D map in the same room: move, see people, chat, talk, select, place, delete, build routes. Auto-used without WebGL or after a 3D crash. |
| Media | `client/src/services/livekit/media.ts` | LiveKit: mic, camera, screen share, device selection, speaking indicators, optional spatial (distance-based) audio. Fully independent of the city socket. |
| AI | `server/src/ai.ts` | Prompt → JSON command → zod validation → permission check → the same `addObject`/`addRoute` path as manual edits → broadcast. Gemini if `GEMINI_API_KEY` is set, otherwise (or on failure) a deterministic offline parser (English + basic Indonesian). Analysis shows verified metrics separately from suggestions. The model never runs code. |
| Simulation | `engine/simulation/Transit.tsx`, `SimState` | Shared clock (running, speed, time of day, weather). Buses and pedestrians are derived from routes + clock on every client, so nothing per-frame is networked or saved as city objects. |
| PWA | `client/public/sw.js`, manifest | Installable, cached hashed assets, offline page. API/WS never cached. |

### Database tables

`users`, `profiles`, `rooms`, `room_members`, `city_scenes` (sim settings + version), `city_objects`, `city_routes`, `room_messages`, `room_activity`, `ai_requests` — foreign keys with cascade, indexes on room lookups. Migration is idempotent and runs on boot. Public demo rooms are seeded on boot (`SEED_DEMOS=false` to skip).

## Playing in the city

| Desktop | Phone | What it does |
|---|---|---|
| WASD / arrows, Shift | joystick | walk, run (buildings are solid) |
| Space | Jump | jump (others see it) |
| Q | Wave | wave for ~2 s |
| E | action button | context action: sit on a bench, chair or sofa; stand up; enter a building through its front door; go outside |

Every residential, office, commercial, school and hospital building has a ground-floor interior (sofa and bookshelf, desks, café tables, classroom, ward and waiting room) with seats you can use. Interiors are rendered below the street so nobody outside sees them; the camera looks in like a dollhouse. In Follow mode the camera swings round behind you as you walk (drag to look around; it resumes after you let go).

**Traffic** (`client/src/engine/simulation/traffic.ts`): cars and buses drive on the left in lanes built from straight road runs, keep a safe gap, stop at two-phase traffic lights with an all-red clearance, and never enter a junction they cannot clear. Lanes are cut wherever an object stands on the road, so vehicles never drive through anything. Buses use the same lanes, dwell at their stops and turn back at the end of the line (a route gets a bus when all its stops sit beside one road). Vehicles are solid; a moving one knocks you over and out of its lane. `npm test -w client` simulates every template for 4 minutes and fails on any overlap. Traffic runs locally on each client (not bit-identical between players). The simulation pause applies to the current session; a room that empties and reloads comes back running. Players always spawn off the road.

Gameplay rules live in `client/src/engine/core/interactions.ts`. On desktop, Chat and Participants open in the right-hand side panel (like Google Meet). Everything is covered by `npm test -w client`. `node scripts/play.mjs` checks them in a real browser (walk into a house front, enter, sit on the sofa, leave, jump and wave while a second player watches).

## Visual design

- **UI kit:** shadcn/ui components live in `client/src/components/ui/*.tsx` (button, input, card, badge, alert, label, separator). `components/ui/index.tsx` wraps them with the app's variant names. Add more with `npx shadcn@latest add <name>` from `client/`.
- **Design read (anti-slop rules):** monochrome chrome: one warm off-white surface, stone ink as the only accent, hairline borders. Colour lives in the 3D city (terracotta roofs, sea), not in the UI. System font stack (no font download on low-end phones). Landing page shows real screenshots and live demo rooms, no invented numbers, no loop animations. Tokens are in `client/src/styles/index.css`.
- **3D look:** coastal harbour style: cream walls with shader-drawn windows (lit at night), terracotta roofs, palms, paved plazas, beach, animated sea, pier with boats, physical sky on balanced/high. Everything is procedural, so there are no textures or models to download.
- **Measured render cost** (headless Chrome, SwiftShader, Modern City demo, with traffic and signals): low 47 draw calls / 18k triangles, phone (low) 47, balanced and high 160-180 including the shadow pass / 22-23k triangles. The phone profile sits just under the 50 draw-call mobile target, so new per-type parts should be checked against it. Settings shows live fps, draw calls and triangles on any device. Re-capture with `node scripts/shots.mjs`, which also refreshes the landing background `client/public/landing/city.jpg`.

### Custom avatar model

The default character is an original procedural figure. To use your own GLB, place it at `client/public/models/avatar.glb`. It is scaled to about 1.9 m, plays clips named `walk`/`run` and `idle` if present, and is used on balanced/high quality only (low keeps the procedural figure for phone frame rates). Keep it small (under ~2 MB, Draco or meshopt compressed) or it will hurt load time on phones. Only use a model you have the rights to: fan-made models of licensed characters (for example Minions, owned by Illumination/Universal) do not grant you rights to the character.

## Decisions that differ from the PRD (and why)

- **No login/sign-up** (product owner request): a username is enough. Consequence: the identity is the token in that browser. Clearing site data or switching device means a new identity, and room ownership does not follow. Upgrade path: optional email/passkey recovery.
- **Own token auth instead of Supabase Auth/Storage**: no Supabase project credentials were available and name-only identity needs no auth provider. Avatar images are stored in `server/uploads/` (magic-byte validated, 1 MB max).
- **Plain `ws` instead of Colyseus**: the PRD allows "a suitable authoritative WebSocket server". For 5–10 users per room this is ~400 lines with full control over validation and payloads.
- **Procedural primitives instead of GLB assets**: zero asset downloads, so texture/mesh compression (Draco/KTX2) is not needed yet. LOD is chunk distance-culling plus hiding detail objects on Low; there are no multi-resolution meshes.
- **Name tags are canvas sprites, not DOM** (cheaper on phones, and avoids a React unmount bug seen with drei `Html`).

## What is verified vs. not

Verified here: typecheck (all packages), 7 server integration tests, the browser E2E above with a real local LiveKit server, on a MacBook with headless Chrome (SwiftShader software WebGL).

Not verified: real low-end Android / iPhone devices, Firefox, Safari, slow-network conditions, FPS numbers on real hardware, Gemini (no key here; the offline parser path is tested), more than 5 simultaneous users, production deployment.

Not built: Indonesian UI translation (code/UI is English; AI parser understands basic Indonesian), private messages, isolated meeting zones for spatial audio, meeting summaries, GLB export, MRT/LRT/rail, traffic density, collision between avatars and buildings, multi-server scaling (rate limits and rooms are per-process).
