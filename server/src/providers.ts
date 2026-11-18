// Thin clients for the AI providers. Everything that talks to a vendor API lives here, so swapping a provider
// (or its model id) is a config change, not a feature change.
import { config } from './config.ts';

export class ProviderError extends Error {
  constructor(public provider: string, public status: number | null, message: string) { super(message); }
}

const read = async (res: Response, provider: string) => {
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const detail = body.slice(0, 300).replace(/\s+/g, ' ');
    throw new ProviderError(provider, res.status, `${provider} HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  return res.json() as Promise<any>;
};

// ---------- Groq (OpenAI-compatible): text and vision ----------
type GroqPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

export async function groqChat(opts: { system: string; user: string | GroqPart[]; json?: boolean; vision?: boolean; maxTokens?: number; temperature?: number }) {
  const g = config.groq;
  if (!g) throw new ProviderError('groq', null, 'GROQ_API_KEY is not set');
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${g.key}` },
    body: JSON.stringify({
      model: opts.vision ? g.vision : g.model,
      messages: [{ role: 'system', content: opts.system }, { role: 'user', content: opts.user }],
      temperature: opts.temperature ?? 0.3,
      max_completion_tokens: opts.maxTokens ?? 1024,
      ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
    }),
    signal: AbortSignal.timeout(40_000),
  });
  const data = await read(res, 'groq');
  const text: string = data?.choices?.[0]?.message?.content ?? '';
  return text.trim();
}

// ---------- Gemini: text (fallback) and image editing ----------
export async function geminiText(system: string, user: string) {
  const g = config.gemini;
  if (!g) throw new ProviderError('gemini', null, 'GEMINI_API_KEY is not set');
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${g.model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': g.key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await read(res, 'gemini');
  return String(data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
}

/**
 * Edit a photo with a text instruction using Cloudflare Workers AI (FLUX.2 Klein). The photo goes in as the
 * reference image (input_image_0), so the result keeps its composition. Multipart form data, base64 image back.
 */
export async function cloudflareEditImage(instruction: string, image: { mime: string; base64: string; width?: number; height?: number }): Promise<{ mime: string; base64: string }> {
  const cf = config.cloudflare;
  if (!cf) throw new ProviderError('cloudflare', null, 'Cloudflare Workers AI is not configured (CF_WORKER_URL + CF_WORKER_SECRET, or CF_ACCOUNT_ID + CF_AI_TOKEN)');
  const form = new FormData();
  form.set('prompt', instruction);
  form.set('input_image_0', new Blob([Buffer.from(image.base64, 'base64')], { type: image.mime }), 'photo');
  if (image.width && image.height) {
    // Keep the photo's aspect ratio at about 1 megapixel, in multiples of 16.
    const k = Math.sqrt((1024 * 1024) / (image.width * image.height));
    form.set('width', String(Math.max(256, Math.round((image.width * k) / 16) * 16)));
    form.set('height', String(Math.max(256, Math.round((image.height * k) / 16) * 16)));
  }
  const res = await fetch(cf.url, {
    method: 'POST',
    headers: cf.headers,
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  if (res.status === 429) throw new ProviderError('cloudflare', 429, 'Daily free Workers AI quota reached. Try again tomorrow, or upgrade the Cloudflare plan.');
  const data = await read(res, 'cloudflare');
  const b64 = data?.result?.image ?? data?.image;
  if (typeof b64 !== 'string') throw new ProviderError('cloudflare', null, 'Cloudflare returned no image');
  const mime = b64.startsWith('/9j/') ? 'image/jpeg' : b64.startsWith('UklGR') ? 'image/webp' : 'image/png';
  return { mime, base64: b64 };
}

/**
 * Edit a photo with a text instruction using a Gemini image model (generateContent with image output).
 * Free-tier keys have no image quota: Google answers 429 until billing is enabled on the key's project.
 */
export async function geminiEditImage(instruction: string, image: { mime: string; base64: string }): Promise<{ mime: string; base64: string }> {
  const g = config.gemini;
  if (!g) throw new ProviderError('gemini', null, 'Image editing needs GEMINI_API_KEY (Google AI Studio). Set it in .env and restart.');
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${g.image}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': g.key },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: instruction }, { inline_data: { mime_type: image.mime, data: image.base64 } }] }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (res.status === 429) {
    throw new ProviderError('gemini', 429, 'Gemini image quota reached. Free-tier keys have no image quota: enable billing for this key in Google AI Studio, or try again later.');
  }
  const data = await read(res, 'gemini');
  for (const part of data?.candidates?.[0]?.content?.parts ?? []) {
    const d = part.inlineData ?? part.inline_data;
    if (typeof d?.data === 'string') return { mime: d.mimeType ?? d.mime_type ?? 'image/png', base64: d.data };
  }
  const why = data?.candidates?.[0]?.finishReason ?? data?.promptFeedback?.blockReason;
  throw new ProviderError('gemini', null, `Gemini returned no image${why ? ` (${why})` : ''}. Try rewording the prompt.`);
}

export const providers = () => ({
  text: config.groq ? 'groq' : config.gemini ? 'gemini' : 'offline',
  vision: config.groq ? 'groq' : 'none',
  image: config.cloudflare ? 'cloudflare' : config.gemini ? 'gemini' : 'none',
});
