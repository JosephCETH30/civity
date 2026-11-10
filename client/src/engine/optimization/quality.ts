// Adaptive rendering profiles. Device type alone never decides quality: we start conservative and adapt from measured FPS.
export type QualityLevel = 'low' | 'balanced' | 'high';

export interface QualityProfile {
  dpr: number; // max device pixel ratio
  antialias: boolean;
  shadows: boolean;
  shadowMapSize: number;
  viewDistance: number; // chunk cull + camera far
  details: boolean; // benches, streetlights, ...
  rainParticles: number;
  standardMaterial: boolean; // PBR vs cheaper Lambert
  chunk: number; // culling chunk size; one big chunk on low keeps draw calls < 50
  sky: boolean; // physical sky shader vs flat colour
}

export const PROFILES: Record<QualityLevel, QualityProfile> = {
  low: { dpr: 0.75, antialias: false, shadows: false, shadowMapSize: 0, viewDistance: 150, details: false, rainParticles: 0, standardMaterial: false, chunk: 10_000, sky: false },
  balanced: { dpr: 1, antialias: false, shadows: true, shadowMapSize: 1024, viewDistance: 260, details: true, rainParticles: 400, standardMaterial: false, chunk: 80, sky: true },
  high: { dpr: 2, antialias: true, shadows: true, shadowMapSize: 2048, viewDistance: 520, details: true, rainParticles: 1200, standardMaterial: true, chunk: 80, sky: true },
};

export function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

/** Conservative first guess. Only hints, never a verdict; FPS monitoring adjusts it at runtime. */
export function initialQuality(): QualityLevel {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const lowMem = (nav.deviceMemory ?? 8) <= 4;
  const fewCores = (navigator.hardwareConcurrency ?? 8) <= 4;
  const coarse = matchMedia('(pointer: coarse)').matches;
  return lowMem || fewCores || coarse ? 'low' : 'balanced';
}

export const isTouchDevice = () => matchMedia('(pointer: coarse)').matches;
