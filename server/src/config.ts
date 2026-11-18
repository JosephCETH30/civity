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
  // Cloudflare Workers AI: image editing for the fountain studio (FLUX.2 Klein edits the uploaded photo).
  // Either through our own Worker (cloudflare-worker/, no API token needed) or the REST API with a token.
  cloudflare: env.CF_WORKER_URL && env.CF_WORKER_SECRET
    ? { url: env.CF_WORKER_URL, headers: { 'x-civitas-secret': env.CF_WORKER_SECRET } as Record<string, string> }
    : env.CF_ACCOUNT_ID && env.CF_AI_TOKEN
      ? { url: `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/run/${env.CF_IMAGE_MODEL || '@cf/black-forest-labs/flux-2-klein-4b'}`, headers: { authorization: `Bearer ${env.CF_AI_TOKEN}` } as Record<string, string> }
      : null,
  // Gemini: image editing when Cloudflare is not configured (needs billing), and a text fallback for city commands.
  gemini: env.GEMINI_API_KEY ? { key: env.GEMINI_API_KEY, model: env.GEMINI_MODEL || 'gemini-2.5-flash', image: env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image' } : null,
  uploadDir: new URL('../uploads/', import.meta.url),
  clientDist: new URL('../../client/dist/', import.meta.url),
};
