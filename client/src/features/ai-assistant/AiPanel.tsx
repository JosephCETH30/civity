import { useState, type FormEvent } from 'react';
import { OBJECT_INFO, type AiResponse, type ObjectType } from '@civitas/shared';
import { useWorld } from '../../stores/world';
import { api } from '../../services/api';
import { localPlayer } from '../../engine/core/transient';
import { Alert, Button } from '../../components/ui';

const EXAMPLES = [
  'Create a modern office building with ten floors',
  'Add a park near the residential area',
  'Create a bus route connecting three stops',
  'Analyze the distribution of public facilities',
];

interface Entry { prompt: string; result?: AiResponse; error?: string }

/** Natural language -> validated scene operation. The core editor never depends on this working. */
export function AiPanel() {
  const roomId = useWorld((s) => s.room?.id);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<Entry[]>([]);

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    const p = prompt.trim();
    if (!p || !roomId || busy) return;
    setBusy(true);
    try {
      const result = await api<AiResponse>(`/rooms/${roomId}/ai`, { body: { prompt: p, origin: { x: localPlayer.x, z: localPlayer.z } } });
      setHistory((h) => [{ prompt: p, result }, ...h].slice(0, 10));
      setPrompt('');
    } catch (err) {
      // Failure is contained here; the city and manual editing keep working.
      setHistory((h) => [{ prompt: p, error: (err as Error).message }, ...h].slice(0, 10));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 text-sm text-foreground">
      <form onSubmit={submit} className="space-y-2">
        <textarea
          value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={500} rows={3}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
          placeholder="Describe what to build or ask for advice…" aria-label="AI request"
          className="w-full resize-none rounded-md border bg-card p-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-brand focus:outline-none"
        />
        <Button type="submit" size="sm" className="w-full" loading={busy} disabled={!prompt.trim()}>Ask assistant</Button>
      </form>
      {!history.length && (
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((x) => (
            <button key={x} onClick={() => setPrompt(x)} className="rounded-full border border-border px-2.5 py-1 text-left text-xs text-foreground/80 hover:bg-muted">{x}</button>
          ))}
        </div>
      )}
      <ul className="space-y-2">
        {history.map((h, i) => (
          <li key={i} className="rounded-md border p-2.5">
            <p className="text-xs text-muted-foreground">“{h.prompt}”</p>
            {h.error ? <div className="mt-1.5"><Alert>{h.error}</Alert></div> : h.result && <Result r={h.result} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Result({ r }: { r: AiResponse }) {
  const a = r.analysis;
  return (
    <div className="mt-1.5 space-y-2">
      {a && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-2">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-green-800">Verified city metrics</p>
          <ul className="space-y-0.5 text-xs text-foreground/80">
            <li>Facilities: {Object.entries(a.counts).filter(([t]) => !['road', 'tree', 'streetlight', 'bench'].includes(t)).map(([t, n]) => `${n} ${OBJECT_INFO[t as ObjectType].label.toLowerCase()}`).join(', ') || 'none'}</li>
            <li>Homes beyond 40 m of a bus stop: {a.residentialWithoutStop}/{a.residentialTotal}</li>
            <li>Avg. distance home → school {a.avgDistanceToSchool ?? 'n/a'} m, hospital {a.avgDistanceToHospital ?? 'n/a'} m, park {a.avgDistanceToPark ?? 'n/a'} m</li>
            <li>Routes: {a.routes} · stops not on a route: {a.stopsNotOnRoute}</li>
          </ul>
        </div>
      )}
      <div>
        {r.command.action === 'advice' && (
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700">{r.provider === 'gemini' ? 'AI suggestion (not verified)' : 'Rule-based suggestions'}</p>
        )}
        <p className="whitespace-pre-line text-sm">{r.summary}</p>
      </div>
      <p className="text-[11px] text-muted-foreground">{r.provider === 'gemini' ? 'Gemini' : 'Offline parser'}</p>
    </div>
  );
}
