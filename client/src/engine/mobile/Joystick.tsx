import { useRef, useState, type PointerEvent } from 'react';
import { input } from '../core/transient';

const R = 48; // knob travel radius in px

/** Floating virtual joystick for touch devices. Writes into the shared input vector. */
export function Joystick() {
  const base = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const active = useRef<number | null>(null);

  const update = (e: PointerEvent) => {
    const r = base.current!.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy);
    if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
    setKnob({ x: dx, y: dy });
    input.joyX = dx / R;
    input.joyZ = dy / R;
  };
  const end = () => {
    active.current = null;
    setKnob({ x: 0, y: 0 });
    input.joyX = 0;
    input.joyZ = 0;
  };

  return (
    <div
      ref={base}
      role="application"
      aria-label="Movement joystick"
      className="pointer-events-auto relative h-32 w-32 touch-none select-none rounded-full border border-white/25 bg-black/25 backdrop-blur-sm"
      onPointerDown={(e) => { active.current = e.pointerId; e.currentTarget.setPointerCapture(e.pointerId); update(e); }}
      onPointerMove={(e) => active.current === e.pointerId && update(e)}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div className="absolute left-1/2 top-1/2 h-14 w-14 rounded-full bg-white/85 shadow" style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }} />
    </div>
  );
}
