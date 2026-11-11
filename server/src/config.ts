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
  // Text + vision (city commands, photo analysis, prompt writing). Groq is OpenAI-compatible and fast.
  groq: env.GROQ_API_KEY ? { key: env.GROQ_API_KEY, model: env.GROQ_MODEL || 'openai/gpt-oss-120b', vision: env.GROQ_VISION_MODEL || 'qwen/qwen3.8-27b' } : null,
  // Gemini: optional text fallback for city commands.
  gemini: env.GEMINI_API_KEY ? { key: env.GEMINI_API_KEY, model: env.GEMINI_MODEL || 'gemini-2.5-flash' } : null,
  // Pollinations: image output. With a (free) key it edits the photo itself; without one it generates from text only.
  pollinations: env.POLLINATIONS === 'off' ? null : { key: env.POLLINATIONS_API_KEY || '', model: env.POLLINATIONS_EDIT_MODEL || 'black-forest-labs/flux.1-kontext-pro' },
  uploadDir: new URL('../uploads/', import.meta.url),
  clientDist: new URL('../../client/dist/', import.meta.url),
};
