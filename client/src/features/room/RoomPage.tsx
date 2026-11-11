import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import gsap from 'gsap';
import { OBJECT_INFO, TEMPLATE_LABELS, type RoomSummary } from '@civitas/shared';
import { loadPref, savePref, useWorld } from '../../stores/world';
import { api, ApiError, tokenStore } from '../../services/api';
import { realtime } from '../../services/realtime';
import { media } from '../../services/livekit/media';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { Alert, Button, Spinner } from '../../components/ui';
import { Joystick } from '../../engine/mobile/Joystick';
import { isTouchDevice } from '../../engine/optimization/quality';
import Map2D from '../../engine/fallback/Map2D';
import { AssetLibrary, Hierarchy, PropertiesPanel, RoutesPanel } from '../city-editor/EditorPanels';
import { SimPanel } from '../simulation/SimPanel';
import { AiPanel } from '../ai-assistant/AiPanel';
import { ChatPanel, MediaButtons, MediaStatusPill, ParticipantsPanel, PresentationPanel, ToolButton, VideoPanel } from '../communication/CommPanels';
import { CameraSwitch, SettingsPanel } from './SettingsPanel';
import { useMedia } from '../communication/mediaStore';
import { InteractionPrompt, TouchActions } from './InteractionControls';
import { PhotoStudio } from '../art/PhotoStudio';
import { Minimap } from './Minimap';
import { AssetRail } from '../city-editor/EditorPanels';
import { LudoPanel } from '../games/LudoPanel';

const loadCanvas = () => import('../../engine/scenes/CityCanvas');
const CityCanvas = lazy(loadCanvas);

const STEPS = ['Validating access', 'Loading 3D engine', 'Connecting and loading the city'];

export default function RoomPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const status = useWorld((s) => s.status);
  const error = useWorld((s) => s.error);
  const [step, setStep] = useState(0);
  const [fatal, setFatal] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!tokenStore.get()) return nav(`/join/${id}`, { replace: true });
        const { access } = await api<{ room: RoomSummary; access: { ok: boolean; error?: string; status?: number } }>(`/rooms/${id}`);
        if (cancelled) return;
        if (!access.ok) return access.status === 401 ? nav(`/join/${id}`, { replace: true }) : setFatal(access.error ?? 'Access denied');
        setStep(1);
        const renderMode = useWorld.getState().renderMode;
        if (renderMode === '3d') await loadCanvas().catch(() => useWorld.getState().set({ renderMode: '2d' }));
        if (cancelled) return;
        setStep(2);
        realtime.connect(id);
      } catch (e) {
        if (!cancelled) setFatal(e instanceof ApiError && e.status === 404 ? 'This room does not exist or was deleted.' : (e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
      realtime.stop();
      media.disconnect();
      useWorld.getState().reset();
    };
  }, [id, nav]);

  useEffect(() => {
    if (status === 'connected') {
      setStep(STEPS.length);
      if (useMedia.getState().status === 'off') media.connect(id);
    }
  }, [status, id]);

  const failed = fatal ?? (status === 'failed' ? error ?? 'Could not join the room' : null);
  if (failed) {
    return (
      <div className="grid h-full place-items-center bg-stone-950 p-6">
        <div className="w-full max-w-sm space-y-4 text-center text-white">
          <h1 className="text-xl font-semibold">Can't enter this city</h1>
          <Alert>{failed}</Alert>
          <Link to="/dashboard"><Button className="w-full">Back to dashboard</Button></Link>
        </div>
      </div>
    );
  }
  if (step < STEPS.length) return <LoadingScreen step={step} />;
  return <RoomShell />;
}

function LoadingScreen({ step }: { step: number }) {
  return (
    <div className="grid h-full place-items-center bg-stone-950 p-6 text-white">
      <div className="w-full max-w-xs">
        <p className="mb-4 text-center text-lg font-semibold">Entering city…</p>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={STEPS.length} aria-valuenow={step}>
          <div className="h-full bg-brand transition-all duration-500" style={{ width: `${((step + 0.5) / STEPS.length) * 100}%` }} />
        </div>
        <ul className="mt-4 space-y-1.5 text-sm">
          {STEPS.map((s, i) => (
            <li key={s} className={`flex items-center gap-2 ${i < step ? 'text-white/60' : i === step ? 'text-white' : 'text-white/30'}`}>
              {i < step ? '✓' : i === step ? <Spinner className="h-3.5 w-3.5" /> : '·'} {s}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

type Sheet = null | 'chat' | 'people' | 'build' | 'more' | 'settings';

function RoomShell() {
  const room = useWorld((s) => s.room)!;
  const status = useWorld((s) => s.status);
  const renderMode = useWorld((s) => s.renderMode);
  const selectedId = useWorld((s) => s.selectedId);
  const tool = useWorld((s) => s.tool);
  const unread = useWorld((s) => s.unread);
  const playersCount = useWorld((s) => new Set(Object.values(s.players).map((p) => p.userId)).size);
  const self = useWorld((s) => s.self);
  const mobile = useIsMobile();
  const nav = useNavigate();
  const [panel, setPanel] = useState<Sheet>(null);
  // Sidebars: 'open' is the full panel, 'mini' is a narrow icon rail (more room for the city), 'hidden' is gone.
  const [left, setLeft] = useState<'open' | 'mini' | 'hidden'>(() => loadPref<'open' | 'mini' | 'hidden'>('sidebar.left', 'open'));
  const [rightMini, setRightMini] = useState<boolean>(() => loadPref('sidebar.rightMini', false));
  const setLeftMode = (m: 'open' | 'mini' | 'hidden') => { setLeft(m); savePref('sidebar.left', m); };
  const setRightMiniMode = (v: boolean) => { setRightMini(v); savePref('sidebar.rightMini', v); };
  const [rightTab, setRightTab] = useState<'inspect' | 'ai' | 'sim' | 'routes'>('inspect');

  // Presence: tell others what we're doing.
  const activity = tool.kind === 'place' ? 'Building' : tool.kind === 'route' ? 'Planning routes' : selectedId ? 'Inspecting' : 'Exploring';
  useEffect(() => { if (status === 'connected') realtime.send({ t: 'status', activity }); }, [activity, status]);
  // Selecting an object opens the inspector (on desktop that replaces an open chat/people side panel).
  useEffect(() => { if (selectedId) { setRightTab('inspect'); setPanel(mobile ? 'build' : (cur) => (cur === 'chat' || cur === 'people' ? null : cur)); } }, [selectedId, mobile]);
  useEffect(() => { if (panel === 'chat') useWorld.getState().set({ unread: 0 }); }, [panel, unread]);

  const leave = () => nav('/dashboard');
  const toggle = (p: Sheet) => setPanel((cur) => (cur === p ? null : p));
  const inviteUrl = `${location.origin}/join/${room.code}`;
  const copyInvite = () => navigator.clipboard?.writeText(inviteUrl).then(() => useWorld.getState().notify('Invitation link copied'), () => useWorld.getState().notify(inviteUrl));

  const viewport = (
    <div className="absolute inset-0">
      {renderMode === '3d' ? (
        <ErrorBoundary
          onError={() => { useWorld.getState().set({ renderMode: '2d' }); useWorld.getState().notify('3D rendering failed. Switched to the 2D map.', 'error'); }}
          fallback={() => null}
        >
          <Suspense fallback={<div className="grid h-full place-items-center text-white"><Spinner /></div>}><CityCanvas /></Suspense>
        </ErrorBoundary>
      ) : <Map2D />}
    </div>
  );

  const statusPill = status !== 'connected' && (
    <span className="rounded-full bg-amber-500 px-3 py-1 text-xs font-medium text-white" role="status">Reconnecting… your edits are kept</span>
  );

  if (mobile) {
    return (
      <div className="fixed inset-0 overflow-hidden bg-stone-900">
        {viewport}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-black/60 to-transparent px-3 pb-6 pt-[max(env(safe-area-inset-top),8px)]">
          <div className="pointer-events-auto min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">{room.name}</p>
            <button className="text-xs text-white/70" onClick={copyInvite}>Code {room.code} · {playersCount} online</button>
          </div>
          <div className="pointer-events-auto flex items-center gap-1.5">{statusPill}<MediaStatusPill /></div>
          <button className="pointer-events-auto rounded-md bg-red-600 px-3 py-2 text-xs font-medium text-white" onClick={leave}>Leave</button>
        </div>
        <div className="pointer-events-none absolute right-2 top-16"><VideoPanel /></div>
        {renderMode === '3d' && <div className="pointer-events-none absolute left-2 top-16 z-10 origin-top-left scale-[0.72]"><Minimap /></div>}
        <PresentationPanel />
        {!panel && <div className="pointer-events-none absolute bottom-[calc(76px+env(safe-area-inset-bottom))] left-4"><Joystick /></div>}
        {!panel && renderMode === '3d' && <TouchActions />}
        <PhotoStudio />
        <LudoPanel />
        <Toast bottom />
        {panel && (
          <MobileSheet title={{ chat: 'Chat', people: 'People', build: selectedId ? 'Selected object' : 'Build', more: 'More', settings: 'Settings' }[panel]} onClose={() => setPanel(null)}>
            {panel === 'chat' && <div className="h-[45vh]"><ChatPanel /></div>}
            {panel === 'people' && <ParticipantsPanel />}
            {panel === 'build' && (selectedId ? <PropertiesPanel /> : <AssetLibrary compact />)}
            {panel === 'more' && <MoreTabs />}
          </MobileSheet>
        )}
        <nav className="absolute inset-x-0 bottom-0 flex items-center justify-around bg-panel px-1 pb-[env(safe-area-inset-bottom)] pt-1" aria-label="Room controls">
          <MediaButtons compact />
          <ToolButton name="chat" label="Chat" showLabel active={panel === 'chat'} badge={panel === 'chat' ? 0 : unread} onClick={() => toggle('chat')} />
          <ToolButton name="people" label="People" showLabel active={panel === 'people'} onClick={() => toggle('people')} />
          <ToolButton name="build" label="Build" showLabel active={panel === 'build'} onClick={() => toggle('build')} />
          <ToolButton name="more" label="More" showLabel active={panel === 'more'} onClick={() => toggle('more')} />
        </nav>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-background text-foreground">
      <header className="z-10 flex h-14 shrink-0 items-center gap-3 border-b bg-card px-3">
        <button onClick={leave} className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Back to my rooms">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-medium leading-tight">{room.name}</h1>
          <p className="truncate text-xs text-muted-foreground">{TEMPLATE_LABELS[room.template]} · {room.visibility === 'private' ? 'Private' : 'Public'}{self ? ` · you are ${self.role}` : ''}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {statusPill}
          <MediaStatusPill />
          <button onClick={() => toggle('people')} aria-pressed={panel === 'people'} className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-muted" aria-label={`${playersCount} online, show participants`}>
            <PeopleStack />
            <span className="text-sm tabular-nums text-muted-foreground">{playersCount} online</span>
          </button>
          <Button variant="secondary" size="sm" onClick={copyInvite} title={inviteUrl}>
            Invite · <span className="font-mono">{room.code}</span>
          </Button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {left === 'open' && (
          <aside className="z-10 flex w-[264px] shrink-0 flex-col border-r bg-card" aria-label="City editor">
            <section className="border-b p-3">
              <SidebarTitle title="Asset library" action={
                <span className="flex gap-1">
                  <button onClick={() => setLeftMode('mini')} className="rounded px-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Minimise editor sidebar" title="Minimise">⟨</button>
                  <button onClick={() => setLeftMode('hidden')} className="rounded px-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Hide editor sidebar">Hide</button>
                </span>
              } />
              <AssetLibrary />
            </section>
            <section className="flex min-h-0 flex-1 flex-col p-3 pb-0">
              <SidebarTitle title="City hierarchy" />
              <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-3"><Hierarchy /></div>
            </section>
          </aside>
        )}
        {left === 'mini' && (
          <aside className="z-10 flex w-14 shrink-0 flex-col items-center gap-1 border-r bg-card py-2" aria-label="City editor (minimised)">
            <button onClick={() => setLeftMode('open')} className="mb-1 grid h-9 w-9 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Expand editor sidebar" title="Expand">⟩</button>
            <AssetRail />
          </aside>
        )}
        <main className="relative min-w-0 flex-1 bg-stone-200">
          {viewport}
          {left === 'hidden' && (
            <button onClick={() => setLeftMode('open')} className="absolute left-3 top-3 z-10 rounded-md border bg-card px-3 py-1.5 text-xs font-medium shadow-sm hover:bg-muted" aria-label="Show editor sidebar">Build</button>
          )}
          <div className="pointer-events-none absolute bottom-24 right-3 z-10"><Minimap /></div>
          {tool.kind === 'place' && (
            <div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-3 rounded-md border bg-card py-1.5 pl-3 pr-1.5 text-xs shadow-sm">
              <span>Placing <b className="font-medium">{OBJECT_INFO[tool.type].label.toLowerCase()}</b>. Click the ground.</span>
              <button className="rounded bg-foreground px-2 py-1 font-medium text-background" onClick={() => useWorld.getState().set({ tool: { kind: 'select' } })}>Done</button>
            </div>
          )}
          <div className="pointer-events-none absolute right-3 top-3 z-10"><VideoPanel /></div>
          <PresentationPanel />
          {panel === 'settings' && <Floating title="Settings" onClose={() => setPanel(null)} className="bottom-20 right-3 max-h-[75%] w-80"><SettingsPanel /></Floating>}
          {isTouchDevice() && <div className="pointer-events-none absolute bottom-24 left-4 z-10"><Joystick /></div>}
          {renderMode === '3d' && <InteractionPrompt />}
          <PhotoStudio />
          <LudoPanel />
          <Toast />
          <div className="absolute inset-x-0 bottom-4 z-10 flex justify-center px-3">
            <div className="flex max-w-full items-center gap-1 overflow-x-auto rounded-full bg-panel p-1.5 shadow-lg backdrop-blur no-scrollbar" role="toolbar" aria-label="Meeting and city controls">
              <MediaButtons />
              <span className="mx-1.5 h-5 w-px shrink-0 bg-white/15" />
              <ToolButton name="chat" label="Chat" active={panel === 'chat'} badge={panel === 'chat' ? 0 : unread} onClick={() => toggle('chat')} />
              <ToolButton name="people" label="People" active={panel === 'people'} onClick={() => toggle('people')} />
              <ToolButton name="settings" label="Settings" active={panel === 'settings'} onClick={() => toggle('settings')} />
              <span className="mx-1.5 h-5 w-px shrink-0 bg-white/15" />
              <CameraSwitch />
              <span className="mx-1.5 h-5 w-px shrink-0 bg-white/15" />
              <ToolButton name="leave" label="Leave" danger onClick={leave} />
            </div>
          </div>
        </main>
        {panel === 'chat' || panel === 'people' ? (
          // Meet-style side panel: chat / people take over the right column while open.
          <aside className="z-10 flex w-80 shrink-0 flex-col border-l bg-card" role="dialog" aria-label={panel === 'chat' ? 'Chat' : 'Participants'}>
            <div className="flex h-14 shrink-0 items-center justify-between border-b px-4">
              <h2 className="font-medium">{panel === 'chat' ? 'Chat' : 'People'}</h2>
              <button onClick={() => setPanel(null)} className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Close ${panel === 'chat' ? 'Chat' : 'Participants'}`}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
            {/* chat scrolls its own message list so the input stays pinned at the bottom */}
            <div className={`min-h-0 flex-1 px-4 py-4 ${panel === 'people' ? 'overflow-y-auto' : ''}`}>{panel === 'chat' ? <ChatPanel /> : <ParticipantsPanel />}</div>
          </aside>
        ) : (
        rightMini ? (
          <aside className="z-10 flex w-14 shrink-0 flex-col items-center gap-1 border-l bg-card py-2" aria-label="Properties and assistant (minimised)">
            {([['inspect', 'Inspect', 'i'], ['ai', 'AI', 'AI'], ['sim', 'Simulation', '▶'], ['routes', 'Routes', '⟲']] as const).map(([k, label, glyph]) => (
              <button key={k} onClick={() => { setRightTab(k); setRightMiniMode(false); }} title={label} aria-label={label}
                className={`grid h-9 w-9 place-items-center rounded-md text-xs font-medium ${rightTab === k ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>{glyph}</button>
            ))}
          </aside>
        ) : (
        <aside className="z-10 flex w-80 shrink-0 flex-col border-l bg-card" aria-label="Properties and assistant">
          <div className="flex items-center gap-2 p-3 pb-0">
            <div className="min-w-0 flex-1"><Segmented value={rightTab} onChange={setRightTab} items={[['inspect', 'Inspect'], ['ai', 'AI'], ['sim', 'Simulation'], ['routes', 'Routes']]} /></div>
            <button onClick={() => setRightMiniMode(true)} className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Minimise side panel" title="Minimise">⟩</button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {rightTab === 'inspect' && <PropertiesPanel />}
            {rightTab === 'ai' && <AiPanel />}
            {rightTab === 'sim' && <SimPanel />}
            {rightTab === 'routes' && <RoutesPanel />}
          </div>
        </aside>
        ))}
      </div>
    </div>
  );
}

function Segmented<K extends string>({ value, onChange, items }: { value: K; onChange: (k: K) => void; items: readonly (readonly [K, string])[] }) {
  return (
    <div className="flex rounded-md bg-muted p-0.5" role="tablist">
      {items.map(([k, label]) => (
        <button key={k} role="tab" aria-selected={value === k} onClick={() => onChange(k)}
          className={`flex-1 rounded-[5px] px-2 py-1.5 text-xs font-medium transition-colors ${value === k ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>{label}</button>
      ))}
    </div>
  );
}

/** Up to four coloured initials of the people in the room. */
function PeopleStack() {
  const players = useWorld((s) => s.players);
  const people = [...new Map(Object.values(players).map((p) => [p.userId, p])).values()].slice(0, 4);
  return (
    <span className="flex -space-x-1.5" aria-hidden>
      {people.map((p) => (
        <span key={p.userId} className="grid h-6 w-6 place-items-center rounded-full border-2 border-card text-[10px] font-semibold text-white" style={{ background: p.color }}>
          {p.name.slice(0, 1).toUpperCase()}
        </span>
      ))}
    </span>
  );
}

function SidebarTitle({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mb-2.5 flex items-center justify-between">
      <h2 className="text-xs font-medium text-muted-foreground">{title}</h2>
      {action}
    </div>
  );
}

function MoreTabs() {
  const [tab, setTab] = useState<'ai' | 'sim' | 'routes' | 'settings'>('ai');
  return (
    <div>
      <div className="mb-4"><Segmented value={tab} onChange={setTab} items={[['ai', 'AI'], ['sim', 'Simulation'], ['routes', 'Routes'], ['settings', 'Settings']]} /></div>
      {tab === 'ai' && <AiPanel />}
      {tab === 'sim' && <SimPanel />}
      {tab === 'routes' && <RoutesPanel />}
      {tab === 'settings' && <><div className="mb-4"><CameraSwitch light /></div><SettingsPanel /></>}
    </div>
  );
}

function Floating({ title, onClose, className, children }: { title: string; onClose: () => void; className: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ctx = gsap.context(() => gsap.from(ref.current, { opacity: 0, y: 8, duration: 0.18, ease: 'power2.out' }));
    return () => ctx.revert();
  }, []);
  return (
    <div ref={ref} role="dialog" aria-label={title} className={`absolute z-20 flex flex-col rounded-[10px] border bg-card p-3 text-foreground shadow-lg ${className}`}>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-medium">{title}</h2>
        <button onClick={onClose} className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Close ${title}`}>✕</button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

function MobileSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ctx = gsap.context(() => gsap.from(ref.current, { yPercent: 100, duration: 0.26, ease: 'power3.out' }));
    return () => ctx.revert();
  }, []);
  return (
    <div ref={ref} role="dialog" aria-label={title}
      className="absolute inset-x-0 bottom-[calc(56px+env(safe-area-inset-bottom))] z-20 max-h-[62vh] overflow-y-auto rounded-t-[14px] border-t bg-card p-4 text-foreground shadow-lg">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-medium">{title}</h2>
        <button onClick={onClose} className="grid h-10 w-10 place-items-center rounded-md text-muted-foreground hover:bg-muted" aria-label={`Close ${title}`}>✕</button>
      </div>
      {children}
    </div>
  );
}

function Toast({ bottom = false }: { bottom?: boolean }) {
  const toast = useWorld((s) => s.toast);
  if (!toast) return null;
  return (
    <div role="status" className={`pointer-events-none absolute inset-x-0 z-30 flex justify-center px-4 ${bottom ? 'bottom-[calc(140px+env(safe-area-inset-bottom))]' : 'bottom-24'}`}>
      <span className={`max-w-md rounded-md px-4 py-2 text-sm text-white shadow-lg ${toast.kind === 'error' ? 'bg-red-600' : 'bg-stone-900'}`}>{toast.text}</span>
    </div>
  );
}
