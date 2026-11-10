import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.ts';
import { migrate, pool } from './db.ts';
import { createApp } from './http.ts';
import { RoomManager } from './realtime.ts';
import { seedDemos } from './rooms.ts';

export async function start(port = config.port) {
  await migrate();
  if (process.env.SEED_DEMOS !== 'false') await seedDemos();
  const manager = new RoomManager();
  const server = createServer(createApp(manager));
  manager.attach(server);
  await new Promise<void>((resolve) => server.listen(port, resolve));
  const stop = async () => {
    manager.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await pool.end();
  };
  return { server, manager, stop };
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '')) {
  const { stop } = await start();
  console.log(`[civitas] server on http://localhost:${config.port}  livekit=${config.livekit ? 'on' : 'off'}  ai=${config.gemini ? 'gemini' : 'offline'}`);
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => stop().finally(() => process.exit(0)));
}
