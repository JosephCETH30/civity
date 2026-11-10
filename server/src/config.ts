const env = process.env;

const authSecret = env.AUTH_SECRET || (env.NODE_ENV === 'production' ? '' : 'dev-only-insecure-auth-secret');
if (!authSecret) throw new Error('AUTH_SECRET is required when NODE_ENV=production');

export const config = {
  port: Number(env.PORT || 3001),
  databaseUrl: env.DATABASE_URL || 'postgres://localhost:5432/civitas',
  authSecret,
  livekit:
    env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET
      ? { url: env.LIVEKIT_URL, key: env.LIVEKIT_API_KEY, secret: env.LIVEKIT_API_SECRET }
      : null,
  gemini: env.GEMINI_API_KEY ? { key: env.GEMINI_API_KEY, model: env.GEMINI_MODEL || 'gemini-2.5-flash' } : null,
  uploadDir: new URL('../uploads/', import.meta.url),
  clientDist: new URL('../../client/dist/', import.meta.url),
};
