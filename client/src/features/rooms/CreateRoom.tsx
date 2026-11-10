import { useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { createRoomSchema, TEMPLATE_LABELS, TEMPLATES, type RoomSummary, type Template } from '@civitas/shared';
import { AppHeader } from '../../components/layout/AppHeader';
import { Alert, Button, Field, Input, Select } from '../../components/ui';
import { api } from '../../services/api';
import { useEnter } from '../../animations/useEnter';

const TEMPLATE_HINT: Record<Template, string> = {
  modern_city: 'Offices, shops, housing, a bus line',
  small_town: 'Low-rise homes and a main street',
  university_campus: 'Faculties, dorms and green quads',
  transport_hub: 'Dense stops and two bus lines',
  empty_sandbox: 'A blank grid to build from scratch',
};

export default function CreateRoom() {
  const nav = useNavigate();
  const [template, setTemplate] = useState<Template>('modern_city');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEnter(ref);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const parsed = createRoomSchema.safeParse({
      name: f.get('name'),
      description: f.get('description'),
      visibility: f.get('visibility'),
      maxParticipants: Number(f.get('maxParticipants')),
      template,
      worldSize: Number(f.get('worldSize')),
      defaultRole: f.get('defaultRole'),
    });
    if (!parsed.success) return setError(`${parsed.error.issues[0].path.join('.')}: ${parsed.error.issues[0].message}`);
    setBusy(true); setError('');
    try {
      const room = await api<RoomSummary>('/rooms', { body: parsed.data });
      nav(`/room/${room.id}`);
    } catch (err) { setError((err as Error).message); setBusy(false); }
  }

  return (
    <div className="min-h-full">
      <AppHeader />
      <main ref={ref} className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <h1 data-enter className="text-2xl font-semibold tracking-tight">Create a city room</h1>
        <form data-enter onSubmit={submit} className="mt-6 space-y-6 rounded-[10px] border border-line bg-surface p-5 sm:p-6">
          {error && <Alert>{error}</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Room name"><Input name="name" required minLength={2} maxLength={60} placeholder="Urban Planning Studio" /></Field>
            <Field label="Visibility" hint="Public rooms appear in the directory">
              <Select name="visibility" defaultValue="private"><option value="private">Private (invite only)</option><option value="public">Public</option></Select>
            </Field>
          </div>
          <Field label="Description"><Input name="description" maxLength={300} placeholder="What will you work on?" /></Field>

          <fieldset>
            <legend className="mb-2 text-sm font-medium">Environment template</legend>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {TEMPLATES.map((t) => (
                <button
                  type="button" key={t} onClick={() => setTemplate(t)} aria-pressed={template === t}
                  className={`rounded-md border p-3 text-left transition-colors ${template === t ? 'border-brand bg-brand-soft' : 'border-line hover:bg-canvas'}`}
                >
                  <span className="block text-sm font-semibold">{TEMPLATE_LABELS[t]}</span>
                  <span className="mt-0.5 block text-xs text-ink-muted">{TEMPLATE_HINT[t]}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="World size">
              <Select name="worldSize" defaultValue="160"><option value="96">Small (96 m)</option><option value="160">Medium (160 m)</option><option value="240">Large (240 m)</option></Select>
            </Field>
            <Field label="Max participants"><Input name="maxParticipants" type="number" min={2} max={20} defaultValue={10} /></Field>
            <Field label="New members join as" hint="You can change roles later">
              <Select name="defaultRole" defaultValue="editor"><option value="editor">Editor</option><option value="participant">Participant</option><option value="viewer">Viewer</option></Select>
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => nav(-1)}>Cancel</Button>
            <Button type="submit" loading={busy}>Create city</Button>
          </div>
        </form>
      </main>
    </div>
  );
}
