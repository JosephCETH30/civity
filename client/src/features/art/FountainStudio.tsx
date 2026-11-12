// Fountain studio: realistic AI transformations of a photo (M7 brief: "Realisme Grafik Komputer berbasis AI").
// Options: Age change (same person at another age), Era change (same place in another year), Realistic restyle
// (free instruction), plus the earlier 3D relief. A vision model reads the photo and writes the edit instruction,
// an image model renders it; both run on the server. Results are kept in the room gallery for the report.
// Any result (yours or someone else's in the room) can be edited again with your own prompt, as many times as you like;
// each new result remembers the image it came from.
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useWorld } from '../../stores/world';
import { api } from '../../services/api';
import { preparePhoto } from '../../engine/ai/depth';
import { Button } from '../../components/ui';
import { cn } from '@/lib/utils';

type Kind = 'age' | 'era' | 'restyle' | 'custom';
interface Caps { text: string; vision: string; image: string }
interface Analysis { description: string; instruction: string; warnings: string[]; provider: string }
interface Item { id: string; kind: Kind; params: { age?: number; year?: number; style?: string }; instruction: string; createdAt: string; author?: string; parentId?: string | null; note?: string }

const AGES = [5, 17, 30, 50, 70];
const YEARS = [1945, 1960, 1980, 1990, 2040];
const STYLES = ['golden hour sunlight, warm cinematic colour grading', 'heavy monsoon rain at night, wet reflective streets', 'fresh snow covering everything, overcast winter light', 'festive night market with string lights and lanterns'];

export function FountainStudio({ onBack }: { onBack: () => void }) {
  const roomId = useWorld((s) => s.room?.id)!;
  const canEdit = useWorld((s) => s.self?.role === 'owner' || s.self?.role === 'editor');
  const [caps, setCaps] = useState<Caps | null>(null);
  const [kind, setKind] = useState<Kind>('age');
  const [age, setAge] = useState(30);
  const [year, setYear] = useState(1980);
  const [style, setStyle] = useState(STYLES[0]);
  const [photo, setPhoto] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState<'analyse' | 'render' | null>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Item | null>(null);
  const [gallery, setGallery] = useState<Item[]>([]);
  const [parentId, setParentId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api<Caps>('/studio/capabilities').then(setCaps, () => setCaps({ text: 'offline', vision: 'none', image: 'none' }));
    api<Item[]>(`/rooms/${roomId}/studio`).then(setGallery, () => {});
  }, [roomId]);

  const params = kind === 'age' ? { age } : kind === 'era' ? { year } : kind === 'restyle' ? { style } : { style: instruction.trim().slice(0, 200) || 'custom edit' };

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(''); setAnalysis(null); setResult(null); setInstruction(''); setParentId(null);
    try { setPhoto((await preparePhoto(file)).dataUrl); } catch (err) { setError((err as Error).message); }
  }

  /** Reuse a finished image as the new starting photo, then describe the next change yourself. */
  async function editResult(it: Item) {
    setError('');
    try {
      const blob = await fetch(`/api/studio/${it.id}/result`).then((r) => { if (!r.ok) throw new Error('Could not load that image'); return r.blob(); });
      const { dataUrl } = await preparePhoto(new File([blob], 'result', { type: blob.type || 'image/jpeg' }));
      setPhoto(dataUrl);
      setParentId(it.id);
      setKind('custom');
      setAnalysis(null);
      setResult(null);
      setInstruction('');
      setTimeout(() => promptRef.current?.focus(), 0);
    } catch (err) { setError((err as Error).message); }
  }

  async function analyse() {
    if (!photo) return;
    setBusy('analyse'); setError(''); setResult(null);
    try {
      const a = await api<Analysis>(`/rooms/${roomId}/studio/analyse`, { body: { image: photo, kind, params } });
      setAnalysis(a);
      setInstruction(a.instruction);
    } catch (err) { setError((err as Error).message); } finally { setBusy(null); }
  }

  async function render() {
    if (!photo || !instruction.trim()) return;
    setBusy('render'); setError('');
    try {
      const item = await api<Item>(`/rooms/${roomId}/studio/render`, { body: { image: photo, kind, params, instruction, description: analysis?.description || undefined, parentId: parentId ?? undefined } });
      setResult(item);
      setGallery((g) => [item, ...g]);
    } catch (err) { setError((err as Error).message); } finally { setBusy(null); }
  }

  const imageReady = caps?.image !== 'none';
  const describe = (it: Item) => it.kind === 'age' ? `Age ${it.params.age}` : it.kind === 'era' ? `Year ${it.params.year}` : it.kind === 'custom' ? `“${it.instruction.slice(0, 60)}”` : it.params.style ?? 'Restyle';
  const promptOk = instruction.trim().length >= 10;

  return (
    <div className="grid gap-4 md:grid-cols-[1fr_260px]">
      <div className="space-y-4">
        {/* transformation picker */}
        <div className="flex rounded-md bg-muted p-0.5" role="tablist" aria-label="Transformation">
          {([['age', 'Age change'], ['era', 'Era change'], ['restyle', 'Realistic restyle'], ['custom', 'Custom prompt']] as const).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={kind === k} onClick={() => { setKind(k); setAnalysis(null); setResult(null); setInstruction(''); }}
              className={cn('flex-1 rounded-[5px] px-2 py-1.5 text-xs font-medium', kind === k ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground')}>{label}</button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {kind === 'age' && 'A portrait of a person. The same person is shown at another age; identity, pose and background stay.'}
          {kind === 'era' && 'A photo of a street or place. The same spot is shown as it would look in another year.'}
          {kind === 'restyle' && 'Any photo. Describe a realistic change (weather, time of day, season, lighting).'}
          {kind === 'custom' && 'Write your own prompt: anything you want changed. Results can be edited again and again.'}
        </p>
        <div className="flex flex-wrap gap-1.5" aria-label="Preset">
          {kind === 'age' && AGES.map((a) => <Chip key={a} active={age === a} onClick={() => setAge(a)}>{a} years</Chip>)}
          {kind === 'era' && YEARS.map((y) => <Chip key={y} active={year === y} onClick={() => setYear(y)}>{y}</Chip>)}
          {kind === 'restyle' && STYLES.map((s) => <Chip key={s} active={style === s} onClick={() => setStyle(s)}>{s.split(',')[0]}</Chip>)}
          {kind === 'age' && <input type="number" min={1} max={100} value={age} onChange={(e) => setAge(+e.target.value)} aria-label="Age" className="h-7 w-20 rounded-md border bg-card px-2 text-xs" />}
          {kind === 'era' && <input type="number" min={1800} max={2200} value={year} onChange={(e) => setYear(+e.target.value)} aria-label="Year" className="h-7 w-24 rounded-md border bg-card px-2 text-xs" />}
        </div>
        {kind === 'restyle' && <input value={style} onChange={(e) => setStyle(e.target.value)} maxLength={200} aria-label="Style instruction" className="h-9 w-full rounded-md border bg-card px-3 text-sm" />}

        {/* photo + result */}
        <div className="grid grid-cols-2 gap-3">
          <figure className="min-h-40 overflow-hidden rounded-md border bg-muted">
            {photo || result ? <img src={photo ?? `/api/studio/${result!.id}/source`} alt="Original photo" className="aspect-[4/3] w-full object-cover" /> : (
              <button onClick={() => fileRef.current?.click()} className="grid aspect-[4/3] w-full place-items-center text-sm text-muted-foreground hover:bg-muted/70">Choose a photo</button>
            )}
            <figcaption className="flex items-center justify-between px-2 py-1 text-xs text-muted-foreground">
              <span className="truncate">{parentId ? 'From an earlier result' : 'Original'}</span>
              {photo && <button onClick={() => fileRef.current?.click()} className="font-medium text-foreground">Change</button>}
            </figcaption>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={onFile} aria-label="Photo file" />
          </figure>
          <figure className="min-h-40 overflow-hidden rounded-md border bg-muted">
            {result ? <img src={`/api/studio/${result.id}/result`} alt={`AI result: ${describe(result)}`} className="aspect-[4/3] w-full object-cover" />
              : <div className="grid aspect-[4/3] w-full place-items-center px-4 text-center text-xs text-muted-foreground">{busy === 'render' ? 'Rendering, usually 10 to 30 seconds' : 'The AI result appears here'}</div>}
            <figcaption className="flex items-center justify-between gap-2 px-2 py-1 text-xs text-muted-foreground">
              <span className="truncate">{result ? describe(result) : 'Result'}</span>
              {result && (
                <span className="flex shrink-0 gap-2.5">
                  {canEdit && <button onClick={() => editResult(result)} className="font-medium text-foreground hover:underline">Edit this result</button>}
                  <a href={`/api/studio/${result.id}/result?download`} download className="font-medium text-foreground hover:underline">Download</a>
                </span>
              )}
            </figcaption>
          </figure>
        </div>

        {/* prompt: written by you, or by the AI after Analyse (and still editable) */}
        <div className="space-y-2 rounded-md border p-3 text-sm">
          {analysis?.description && <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">The AI sees:</span> {analysis.description}</p>}
          {analysis?.warnings.map((w) => <p key={w} className="text-xs text-amber-700">{w}</p>)}
          <label className="block">
            <span className="mb-1 block text-xs text-muted-foreground">
              {kind === 'custom' ? 'Your prompt (what should change in the photo)' : 'Prompt sent to the image model: write your own, or press Analyse to let the AI write it'}
            </span>
            <textarea ref={promptRef} value={instruction} onChange={(e) => setInstruction(e.target.value)} rows={4} maxLength={1500}
              placeholder={kind === 'custom' ? 'e.g. make it night with neon signs, keep the people the same' : 'e.g. show this person at 70, grey hair and wrinkles, same pose and background'}
              className="w-full resize-y rounded-md border bg-card p-2 text-xs" />
          </label>
          {instruction.length > 0 && !promptOk && <p className="text-xs text-muted-foreground">Write at least 10 characters.</p>}
        </div>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        {result?.note && <p className="text-xs text-amber-700" role="status">{result.note}</p>}
        {!canEdit && <p className="text-xs text-muted-foreground">Viewers can browse the gallery; ask the owner for edit access to create.</p>}
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={!photo || !!busy || (kind === 'custom' && instruction.trim().length < 3)} loading={busy === 'analyse'} onClick={analyse}>
              {kind === 'custom' ? 'Improve my prompt with AI' : analysis ? 'Analyse again' : 'Analyse photo (optional)'}
            </Button>
            <Button disabled={!photo || !promptOk || !!busy || !imageReady} loading={busy === 'render'} onClick={render} title={imageReady ? '' : 'Image generation is turned off on this server'}>Generate</Button>
            <Button variant="ghost" onClick={onBack}>Back</Button>
          </div>
        )}
        {caps && !imageReady && <p className="text-xs text-amber-700">Image generation is turned off on this server. Analysis and the 3D relief still work.</p>}
        {caps?.image === 'pollinations-free' && (
          <p className="text-xs text-muted-foreground">Free generator: makes a new realistic image from the AI's description (one image every 45 seconds for the whole server), so faces will not match exactly.</p>
        )}
      </div>

      <aside className="space-y-2">
        <h3 className="text-xs font-medium text-muted-foreground">Room gallery · {gallery.length}</h3>
        {gallery.length === 0 && <p className="text-xs text-muted-foreground">Results made at this fountain appear here for everyone in the room.</p>}
        <ul className="grid max-h-[52vh] grid-cols-2 gap-2 overflow-y-auto pr-1 md:grid-cols-1">
          {gallery.map((it) => (
            <li key={it.id} className="overflow-hidden rounded-md border">
              <button onClick={() => setResult(it)} className="block w-full text-left" aria-label={`Show ${describe(it)}`}>
                <div className="grid grid-cols-2">
                  <img src={`/api/studio/${it.id}/source`} alt="" className="aspect-square w-full object-cover" loading="lazy" />
                  <img src={`/api/studio/${it.id}/result`} alt="" className="aspect-square w-full object-cover" loading="lazy" />
                </div>
              </button>
              <div className="flex items-center gap-2 px-2 py-1 text-[11px] text-muted-foreground">
                <span className="min-w-0 flex-1 truncate" title={it.instruction}>{it.parentId ? '↳ ' : ''}{describe(it)}{it.author ? ` · ${it.author}` : ''}</span>
                {canEdit && <button onClick={() => editResult(it)} className="shrink-0 font-medium text-foreground hover:underline" aria-label={`Edit ${describe(it)} again`}>Edit</button>}
                <a href={`/api/studio/${it.id}/result?download`} download className="shrink-0 font-medium text-foreground hover:underline" aria-label={`Download ${describe(it)}`}>Download</a>
              </div>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-pressed={active} className={cn('h-7 rounded-full border px-2.5 text-xs', active ? 'border-foreground bg-foreground text-background' : 'hover:bg-muted')}>{children}</button>
  );
}
