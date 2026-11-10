// Dashboard: fixed-height app shell. The page never scrolls; each list scrolls inside its own panel.
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { TEMPLATE_LABELS, type RoomSummary } from '@civitas/shared';
import { AppHeader } from '../../components/layout/AppHeader';
import { Spinner } from '../../components/ui';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { api } from '../../services/api';
import { useAuth } from '../../stores/auth';
import { cn } from '@/lib/utils';

interface Activity { id: string; type: string; actorName: string; metadata: any; createdAt: string; roomName: string; roomId: string }

type Load<T> = { state: 'loading' } | { state: 'error'; error: string } | { state: 'ok'; data: T };
function useLoad<T>(path: string): Load<T> {
  const [s, set] = useState<Load<T>>({ state: 'loading' });
  useEffect(() => {
    const ac = new AbortController();
    api<T>(path, { signal: ac.signal }).then((data) => set({ state: 'ok', data }), (e) => e.name !== 'AbortError' && set({ state: 'error', error: e.message }));
    return () => ac.abort();
  }, [path]);
  return s;
}

const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
};

export default function Dashboard() {
  const profile = useAuth((s) => s.profile)!;
  const mine = useLoad<RoomSummary[]>('/rooms/mine');
  const pub = useLoad<RoomSummary[]>('/rooms/public');
  const activity = useLoad<Activity[]>('/activity');
  const nav = useNavigate();
  const [tab, setTab] = useState<'mine' | 'public'>('mine');
  const [code, setCode] = useState('');
  const list = tab === 'mine' ? mine : pub;

  // First visit: nothing joined yet, so show public rooms instead of an empty list.
  useEffect(() => {
    if (mine.state === 'ok' && !mine.data.length) setTab('public');
  }, [mine]);

  const join = (e: FormEvent) => {
    e.preventDefault();
    const c = code.trim().replace(/.*\/join\//, '');
    if (c) nav(`/join/${encodeURIComponent(c)}`);
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <AppHeader />
      {!profile.email && (
        <p className="mx-auto mt-4 w-full max-w-6xl px-4 text-sm text-muted-foreground sm:px-6">
          This account only lives in this browser. <Link to="/profile" className="font-medium text-foreground underline underline-offset-4">Add an email</Link> to keep your rooms on any device.
        </p>
      )}
      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-4 p-4 sm:px-6 lg:flex-row lg:gap-5 lg:py-6">
        <section className="flex min-h-0 flex-1 flex-col rounded-[10px] border bg-card" aria-label="Rooms">
          <div className="flex flex-col gap-3 border-b p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex rounded-md bg-muted p-0.5" role="tablist" aria-label="Room list">
              {([['mine', 'Your rooms', mine], ['public', 'Public', pub]] as const).map(([k, label, l]) => (
                <button
                  key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                  className={cn('rounded-[5px] px-3 py-1.5 text-sm font-medium transition-colors', tab === k ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
                >
                  {label}{l.state === 'ok' && <span className="ml-1.5 text-muted-foreground">{l.data.length}</span>}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <form onSubmit={join} className="flex min-w-0 flex-1 gap-2">
                <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Room code or link" aria-label="Room code or link" className="min-w-0 sm:w-48" />
                <Button type="submit" variant="outline" disabled={!code.trim()}>Join</Button>
              </form>
              <Button asChild><Link to="/rooms/new">New room</Link></Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {list.state === 'loading' && <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Spinner className="h-4 w-4" /> Loading rooms</p>}
            {list.state === 'error' && <p className="p-4 text-sm text-destructive">Could not load rooms: {list.error}</p>}
            {list.state === 'ok' && !list.data.length && (
              <div className="p-8 text-center text-sm text-muted-foreground">
                {tab === 'mine' ? <>You have not joined a room yet. Create one, or open a public room.</> : <>No public rooms right now.</>}
              </div>
            )}
            {list.state === 'ok' && !!list.data.length && (
              <ul className="divide-y">
                {list.data.map((r) => <RoomRow key={r.id} room={r} showRole={tab === 'mine'} />)}
              </ul>
            )}
          </div>
        </section>

        <aside className="flex max-h-[38%] min-h-0 flex-col rounded-[10px] border bg-card lg:max-h-none lg:w-80" aria-label="Recent activity">
          <h2 className="border-b px-4 py-3 text-sm font-medium">Recent activity</h2>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ActivityList load={activity} me={profile.displayName} />
          </div>
        </aside>
      </div>
    </div>
  );
}

function RoomRow({ room: r, showRole }: { room: RoomSummary; showRole: boolean }) {
  const online = r.online ?? 0;
  return (
    <li>
      <Link to={`/room/${r.id}`} className="flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-muted/60">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-medium">{r.name}</p>
            {showRole && r.myRole === 'owner' && <span className="shrink-0 text-xs text-primary">Owner</span>}
          </div>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            {[TEMPLATE_LABELS[r.template], r.visibility === 'private' ? 'Private' : 'Public', r.ownerName !== 'CIVITAS' && `by ${r.ownerName}`, r.description].filter(Boolean).join(' · ')}
          </p>
        </div>
        <span className={cn('shrink-0 text-sm tabular-nums', online ? 'text-green-700' : 'text-muted-foreground')}>
          {online ? `${online} inside` : 'Empty'}
        </span>
      </Link>
    </li>
  );
}

function ActivityList({ load, me }: { load: Load<Activity[]>; me: string }) {
  // Your own joins and leaves are noise; keep what other people did and real changes.
  const items = useMemo(
    () => (load.state === 'ok' ? load.data.filter((a) => !((a.type === 'join' || a.type === 'leave') && a.actorName === me)) : []),
    [load, me],
  );
  if (load.state === 'loading') return <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Spinner className="h-4 w-4" /> Loading</p>;
  if (load.state === 'error') return <p className="p-4 text-sm text-destructive">{load.error}</p>;
  if (!items.length) return <p className="p-4 text-sm text-muted-foreground">When people join your rooms or change them, it shows up here.</p>;
  const text = (a: Activity) =>
    ({
      join: `${a.actorName} joined`,
      leave: `${a.actorName} left`,
      room_created: 'Room created',
      route_created: `${a.actorName} added route ${a.metadata?.name ?? ''}`,
      object_deleted: `${a.actorName} removed a ${String(a.metadata?.type ?? 'object').replace('_', ' ')}`,
    })[a.type] ?? a.type;
  return (
    <ul className="divide-y">
      {items.map((a) => (
        <li key={a.id}>
          <Link to={`/room/${a.roomId}`} className="block px-4 py-2.5 hover:bg-muted/60">
            <p className="text-sm">{text(a)}</p>
            <p className="text-xs text-muted-foreground">{a.roomName} · {ago(a.createdAt)}</p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
