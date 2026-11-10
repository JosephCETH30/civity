import { useEffect, useState } from 'react';
import { simHour, WEATHER } from '@civitas/shared';
import { useWorld } from '../../stores/world';
import { realtime, serverNow } from '../../services/realtime';
import { Button, Select } from '../../components/ui';

const fmt = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;

/** Shared simulation controls. Changes apply for everyone in the room. Simulation output is never saved as city objects. */
export function SimPanel() {
  const sim = useWorld((s) => s.sim);
  const role = useWorld((s) => s.self?.role);
  const routes = useWorld((s) => Object.keys(s.routes).length);
  const [hour, setHour] = useState(() => simHour(sim, serverNow()));
  useEffect(() => {
    const t = setInterval(() => setHour(simHour(useWorld.getState().sim, serverNow())), 500);
    return () => clearInterval(t);
  }, []);
  const disabled = role === 'viewer';
  const send = (patch: Record<string, unknown>) => realtime.send({ t: 'sim', patch });

  return (
    <div className="space-y-3 text-sm text-foreground">
      <div className="flex items-center justify-between">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${sim.running ? 'bg-green-100 text-green-800' : 'bg-muted text-muted-foreground'}`}>
          {sim.running ? `Running ×${sim.speed}` : 'Paused'}
        </span>
        <span className="font-mono text-lg tabular-nums" aria-label="Simulation time">{fmt(hour)}</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" disabled={disabled} onClick={() => send({ running: !sim.running })}>{sim.running ? 'Pause' : 'Start'}</Button>
        <Button size="sm" variant="secondary" disabled={disabled} onClick={() => send({ reset: true })}>Reset</Button>
      </div>
      <label className="block">
        <span className="mb-1 block text-xs text-muted-foreground">Speed</span>
        <Select disabled={disabled} value={sim.speed} onChange={(e) => send({ speed: +e.target.value })} className="h-9">
          {[0.5, 1, 2, 4, 8].map((s) => <option key={s} value={s}>×{s}</option>)}
        </Select>
      </label>
      <label className="block">
        <span className="mb-1 block text-xs text-muted-foreground">Time of day</span>
        <input type="range" min={0} max={23.5} step={0.5} value={Math.floor(hour * 2) / 2} disabled={disabled} className="w-full accent-[var(--color-brand)]"
          onChange={(e) => send({ timeOfDay: +e.target.value })} aria-label="Time of day" />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs text-muted-foreground">Weather</span>
        <Select disabled={disabled} value={sim.weather} onChange={(e) => send({ weather: e.target.value })} className="h-9 capitalize">
          {WEATHER.map((w) => <option key={w} value={w}>{w}</option>)}
        </Select>
      </label>
      <p className="text-xs text-muted-foreground">
        {routes ? `${routes} bus route(s).` : 'Add a bus route to run buses.'} One simulated hour passes per real minute at ×1. Cars and buses are simulation output, separate from the editable city. They follow traffic lights and never collide.
      </p>
    </div>
  );
}
