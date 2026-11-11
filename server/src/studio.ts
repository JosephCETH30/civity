// Fountain photo studio: realistic AI transformations of a photo (the "Realisme Grafik Komputer berbasis AI" brief).
// Two stages, both server-side so the keys never reach the browser:
//   1. analyse: a vision model describes the photo and writes an edit instruction for the chosen transformation.
//   2. render:  an image model applies that instruction and returns the new photo.
import { geminiEditImage, groqChat, ProviderError } from './providers.ts';
import { config } from './config.ts';

export const TRANSFORMS = {
  age: {
    label: 'Age change',
    needs: 'portrait',
    brief: (p: { age: number }) => `Show the same person at about ${p.age} years old. Keep identity, pose, framing, lighting and background. Change only what age changes: face shape and skin, hair colour and hairline, posture, and clothing style typical for that age.`,
  },
  era: {
    label: 'Era change',
    needs: 'scene',
    brief: (p: { year: number }) => `Show the same place and camera angle as it would look in the year ${p.year}. Keep the layout of the scene. Change architecture, vehicles, signage, road surface, vegetation, clothing of people, and photo quality to match that time (for ${p.year < 1970 ? 'older years use period-accurate film grain and limited colour' : p.year > new Date().getFullYear() ? 'future years, plausible near-future technology, not fantasy' : 'that decade'}).`,
  },
  restyle: {
    label: 'Realistic restyle',
    needs: 'any',
    brief: (p: { style: string }) => `Re-render the photo with this change while keeping it photorealistic and the subject recognisable: ${p.style}.`,
  },
} as const;
export type TransformKind = keyof typeof TRANSFORMS;

export interface StudioParams { age?: number; year?: number; style?: string }

const PROMPT_SYSTEM = `You write instructions for a photo-editing AI. You receive a photo and a transformation brief.
Respond with JSON only: { "description": string, "instruction": string, "warnings": string[] }.
- description: 1-2 sentences, what is in the photo (subject, setting, lighting, camera angle, era clues).
- instruction: a precise, concrete editing instruction (60-120 words) for the image model. Describe exactly what to change
  and what must stay the same (identity, composition, lighting). Be specific about details for the target age or era
  (hairstyle, clothing cut, materials, vehicle models, signage, street furniture). Photorealistic, no text overlays, no cartoon.
- warnings: anything that makes the edit hard (no face visible, blurry, group photo), or [].`;

export async function analysePhoto(kind: TransformKind, params: StudioParams, image: { mime: string; base64: string }) {
  const t = TRANSFORMS[kind];
  const brief = (t.brief as (p: any) => string)(params);
  if (!config.groq) {
    // No vision model: use the brief directly.
    return { description: '', instruction: brief, warnings: ['No vision model configured; using the generic instruction.'], provider: 'none' as const };
  }
  const text = await groqChat({
    system: PROMPT_SYSTEM,
    user: [
      { type: 'text', text: `Transformation: ${t.label}. Brief: ${brief}` },
      { type: 'image_url', image_url: { url: `data:${image.mime};base64,${image.base64}` } },
    ],
    vision: true,
    json: true,
    maxTokens: 700,
  });
  let parsed: any = {};
  try { parsed = JSON.parse(text); } catch { /* fall through to defaults */ }
  return {
    description: String(parsed.description ?? '').slice(0, 400),
    instruction: String(parsed.instruction ?? brief).slice(0, 1200),
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String).slice(0, 4) : [],
    provider: 'groq' as const,
  };
}

export async function renderEdit(instruction: string, image: { mime: string; base64: string }) {
  if (!config.gemini) throw new ProviderError('gemini', null, 'Image editing needs GEMINI_API_KEY (Google AI Studio). Set it in .env and restart.');
  return geminiEditImage(instruction, image);
}
