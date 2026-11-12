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

// ---------- Gemini: text (fallback) ----------
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
 * Image output via Pollinations. With POLLINATIONS_API_KEY: true photo editing (OpenAI-style /v1/images/edits, the
 * photo is the reference). Without a key: the keyless classic endpoint, text-to-image only (1 image / 45 s per IP),
 * so the prompt carries the vision model's description of the photo instead.
 */
export async function pollinationsImage(
  instruction: string,
  image: { mime: string; base64: string },
  opts: { description?: string; portrait?: boolean } = {},
): Promise<{ mime: string; base64: string; note?: string }> {
  const p = config.pollinations;
  if (!p) throw new ProviderError('pollinations', null, 'Image generation is turned off on this server');
  if (p.key) {
    try {
      return await pollinationsRequest(instruction, image, opts, p.key, p.model);
    } catch (e) {
      // Key out of balance (402) or rejected (401/403): keep the studio working with the free text-to-image mode.
      if (!(e instanceof ProviderError) || ![401, 402, 403].includes(e.status ?? 0)) throw e;
      const out = await pollinationsRequest(instruction, image, opts, '', p.model);
      return { ...out, note: 'The photo-editing credit is used up, so this image was made with the free generator (new image from the description). Top up the Pollinations key for exact edits again.' };
    }
  }
  return pollinationsRequest(instruction, image, opts, '', p.model);
}

async function pollinationsRequest(
  instruction: string,
  image: { mime: string; base64: string },
  opts: { description?: string; portrait?: boolean },
  key: string,
  model: string,
): Promise<{ mime: string; base64: string }> {
  let res: Response;
  const p = { key, model };
  if (p.key) {
    const form = new FormData();
    form.set('model', p.model);
    form.set('prompt', instruction);
    form.set('image', new Blob([Buffer.from(image.base64, 'base64')], { type: image.mime }), 'photo');
    res = await fetch('https://gen.pollinations.ai/v1/images/edits', { method: 'POST', headers: { authorization: `Bearer ${p.key}` }, body: form, signal: AbortSignal.timeout(120_000) });
  } else {
    const prompt = `Photorealistic photograph. ${opts.description ? `Scene: ${opts.description} ` : ''}${instruction}`.slice(0, 1500);
    const [w, h] = opts.portrait ? [768, 1024] : [1024, 768];
    res = await fetch(`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${w}&height=${h}&nologo=true&enhance=false`, { signal: AbortSignal.timeout(120_000) });
    if (res.status === 402 || res.status === 429) {
      throw new ProviderError('pollinations', 429, 'The free image generator allows 1 image every 45 seconds for this server. Try again shortly, or set POLLINATIONS_API_KEY.');
    }
  }
  const type = res.headers.get('content-type') || '';
  if (res.ok && type.startsWith('image/')) return { mime: type.split(';')[0], base64: Buffer.from(await res.arrayBuffer()).toString('base64') };
  const data = await read(res, 'pollinations');
  const item = data?.data?.[0];
  if (typeof item?.b64_json === 'string') return { mime: 'image/png', base64: item.b64_json };
  if (typeof item?.url === 'string') {
    const img = await fetch(item.url, { signal: AbortSignal.timeout(60_000) });
    if (img.ok) return { mime: (img.headers.get('content-type') || 'image/jpeg').split(';')[0], base64: Buffer.from(await img.arrayBuffer()).toString('base64') };
  }
  throw new ProviderError('pollinations', null, 'The image generator returned no image');
}

export const providers = () => ({
  text: config.groq ? 'groq' : config.gemini ? 'gemini' : 'offline',
  vision: config.groq ? 'groq' : 'none',
  image: !config.pollinations ? 'none' : config.pollinations.key ? 'pollinations-edit' : 'pollinations-free',
});
