// Battle sounds synthesised with Web Audio (no audio files to download). Quieter with distance from the listener.
let ctx: AudioContext | null = null;

function audio() {
  if (!ctx) {
    try { ctx = new AudioContext(); } catch { return null; }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** 1 near, fading to 0 at ~70 m. */
export const falloff = (dist: number) => Math.max(0, 1 - dist / 70) ** 1.5;

function noiseBuffer(a: AudioContext) {
  const b = a.createBuffer(1, a.sampleRate * 0.25, a.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  return b;
}
let noise: AudioBuffer | null = null;

/** Blaster shot: a short downward zap plus a noise crack. */
export function playShot(volume: number) {
  const a = audio();
  if (!a || volume <= 0.01) return;
  const t = a.currentTime;
  const out = a.createGain();
  out.gain.setValueAtTime(0.22 * volume, t);
  out.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
  out.connect(a.destination);
  const osc = a.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(1300, t);
  osc.frequency.exponentialRampToValueAtTime(180, t + 0.15);
  osc.connect(out);
  osc.start(t);
  osc.stop(t + 0.18);
  noise ??= noiseBuffer(a);
  const n = a.createBufferSource();
  n.buffer = noise;
  const ng = a.createGain();
  ng.gain.setValueAtTime(0.18 * volume, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
  const hp = a.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1500;
  n.connect(hp).connect(ng).connect(a.destination);
  n.start(t);
}

/** Hit confirm (for the shooter) or getting hit (for the victim). */
export function playHit(mine: boolean) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  const g = a.createGain();
  g.gain.setValueAtTime(mine ? 0.12 : 0.3, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + (mine ? 0.09 : 0.25));
  g.connect(a.destination);
  const o = a.createOscillator();
  o.type = mine ? 'triangle' : 'sawtooth';
  o.frequency.setValueAtTime(mine ? 1800 : 160, t);
  o.frequency.exponentialRampToValueAtTime(mine ? 2400 : 60, t + 0.2);
  o.connect(g);
  o.start(t);
  o.stop(t + 0.26);
}

/** Elimination: a falling two-tone chime. */
export function playKill(volume: number) {
  const a = audio();
  if (!a || volume <= 0.01) return;
  const t = a.currentTime;
  [660, 440, 262].forEach((f, i) => {
    const g = a.createGain();
    const s = t + i * 0.09;
    g.gain.setValueAtTime(0.16 * volume, s);
    g.gain.exponentialRampToValueAtTime(0.001, s + 0.22);
    g.connect(a.destination);
    const o = a.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f;
    o.connect(g);
    o.start(s);
    o.stop(s + 0.24);
  });
}
