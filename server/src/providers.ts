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

// ---------- Gemini: text (fallback) and image output ----------
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
 * Edit a photo with a text instruction; returns the new image. Uses the Interactions API (the documented path for
 * Gemini image models). Response: steps[].content[] blocks of type "image" with base64 data.
 */
export async function geminiEditImage(instruction: string, image: { mime: string; base64: string }): Promise<{ mime: string; base64: string }> {
  const g = config.gemini;
  if (!g) throw new ProviderError('gemini', null, 'GEMINI_API_KEY is not set');
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': g.key, 'Api-Revision': '2026-05-20' },
    body: JSON.stringify({
      model: g.image,
      input: [
        { type: 'text', text: instruction },
        { type: 'image', mime_type: image.mime, data: image.base64 },
      ],
      response_format: { type: 'image', mime_type: 'image/jpeg', image_size: '1K' },
    }),
    signal: AbortSignal.timeout(90_000),
  });
  const data = await read(res, 'gemini');
  const steps: any[] = Array.isArray(data?.steps) ? data.steps : [];
  for (const step of steps) {
    for (const block of step?.content ?? []) {
      if (block?.type === 'image' && typeof block.data === 'string') return { mime: block.mime_type || block.mimeType || 'image/jpeg', base64: block.data };
    }
  }
  // Older shape used by some examples.
  if (typeof data?.output_image?.data === 'string') return { mime: data.output_image.mime_type || 'image/jpeg', base64: data.output_image.data };
  throw new ProviderError('gemini', null, 'Gemini returned no image');
}

export const providers = () => ({
  text: config.groq ? 'groq' : config.gemini ? 'gemini' : 'offline',
  vision: config.groq ? 'groq' : 'none',
  image: config.gemini ? 'gemini' : 'none',
});
