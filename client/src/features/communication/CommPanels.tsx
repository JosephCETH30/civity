import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { MAX_CHAT, ROLES, type PlayerState } from '@civitas/shared';
import { useWorld } from '../../stores/world';
import { realtime } from '../../services/realtime';
import { api } from '../../services/api';
import { media, screenShareSupported } from '../../services/livekit/media';
import { useMedia, type MediaTile } from './mediaStore';
import { RoleBadge } from '../../components/ui';
import { remoteRendered } from '../../engine/core/transient';

export function ChatPanel() {
  const messages = useWorld((s) => s.messages);
  const role = useWorld((s) => s.self?.role);
  const [text, setText] = useState('');
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    useWorld.getState().set({ unread: 0 });
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [messages.length]);
  const send = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    realtime.send({ t: 'chat', text: t });
    setText('');
  };
  const me = useWorld((s) => s.self?.userId);
  const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <div className="flex h-full min-h-0 flex-col text-sm text-foreground">
      <div ref={list} className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1" aria-live="polite">
        {!messages.length && <p className="py-8 text-center text-muted-foreground">No messages yet. Say hello!</p>}
        {messages.map((m, i) => {
          if (m.type === 'system') return <p key={m.id} className="text-center text-xs text-muted-foreground">{m.content}</p>;
          const prev = messages[i - 1];
          const grouped = prev?.type === m.type && prev.senderId === m.senderId && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 120_000;
          const mine = m.senderId === me && m.type === 'user';
          return (
            <div key={m.id} className={`${grouped ? '-mt-2' : ''} ${mine ? 'pl-8' : 'pr-8'}`}>
              {!grouped && (
                <p className={`mb-1 text-xs text-muted-foreground ${mine ? 'text-right' : ''}`}>
                  <span className={m.type === 'ai' ? 'font-medium text-foreground' : ''}>{mine ? 'You' : m.senderName}</span> · {time(m.createdAt)}
                </p>
              )}
              <div className={`inline-block max-w-full break-words rounded-2xl px-3 py-1.5 ${mine ? 'float-right rounded-tr-md bg-foreground text-background' : m.type === 'ai' ? 'rounded-tl-md border bg-card' : 'rounded-tl-md bg-muted'}`}>{m.content}</div>
              <div className="clear-both" />
            </div>
          );
        })}
      </div>
      {role === 'viewer' ? (
        <p className="mt-2 text-xs text-muted-foreground">Viewers cannot chat in this room.</p>
      ) : (
        <form onSubmit={send} className="mt-3 flex items-center gap-1 rounded-full border bg-card py-1 pl-4 pr-1 focus-within:border-ring">
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={MAX_CHAT} placeholder="Message everyone" aria-label="Chat message"
            className="h-8 min-w-0 flex-1 bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none" />
          <button type="submit" aria-label="Send" className="grid h-8 w-8 place-items-center rounded-full bg-foreground text-background disabled:opacity-30" disabled={!text.trim()}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 19V5M5 12l7-7 7 7" /></svg>
          </button>
        </form>
      )}
    </div>
  );
}

/** One row per user (multiple tabs collapse). Owners can change roles or remove people. */
export function ParticipantsPanel() {
  const players = useWorld((s) => s.players);
  const self = useWorld((s) => s.self);
  const room = useWorld((s) => s.room);
  const speaking = useMedia((s) => s.speaking);
  const isOwner = self?.role === 'owner';
  const users = useMemo(() => {
    const m = new Map<string, PlayerState>();
    for (const p of Object.values(players)) if (!m.has(p.userId) || p.id === self?.sessionId) m.set(p.userId, p);
    return [...m.values()];
  }, [players, self]);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);

  const setRole = (userId: string, role: string) =>
    api(`/rooms/${room!.id}/members/${userId}`, { method: 'PATCH', body: { role } }).catch((e) => useWorld.getState().notify(e.message, 'error'));
  const kick = (userId: string) =>
    api(`/rooms/${room!.id}/members/${userId}`, { method: 'DELETE' }).catch((e) => useWorld.getState().notify(e.message, 'error'));

  return (
    <ul className="divide-y text-sm text-foreground">
      <li className="pb-2 text-xs text-muted-foreground">{users.length} in the city</li>
      {users.map((p) => {
        const pos = p.id === self?.sessionId ? null : remoteRendered.get(p.id);
        const talking = speaking.has(p.userId);
        return (
          <li key={p.userId} className="flex items-center gap-3 py-2.5">
            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-semibold text-white ${talking ? 'ring-2 ring-green-500 ring-offset-2 ring-offset-card' : ''}`} style={{ background: p.color }} aria-hidden>
              {p.name.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{p.name}{p.id === self?.sessionId && <span className="font-normal text-muted-foreground"> (you)</span>}</p>
              <p className="truncate text-xs text-muted-foreground">
                {talking ? 'Speaking' : p.activity}{pos ? ` · ${Math.round(pos.x)}, ${Math.round(pos.z)}` : ''}
              </p>
            </div>
            {isOwner && p.role !== 'owner' ? (
              <div className="flex items-center gap-1">
                <select value={p.role} onChange={(e) => setRole(p.userId, e.target.value)} aria-label={`Role for ${p.name}`}
                  className="h-8 rounded-md border bg-card px-1.5 text-xs capitalize text-foreground">
                  {ROLES.filter((r) => r !== 'owner').map((r) => <option key={r} value={r} className="text-ink">{r}</option>)}
                </select>
                <button className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-destructive/8 hover:text-destructive" onClick={() => kick(p.userId)} aria-label={`Remove ${p.name}`} title="Remove">✕</button>
              </div>
            ) : <RoleBadge role={p.role} />}
          </li>
        );
      })}
    </ul>
  );
}

function VideoEl({ tile, contain = false }: { tile: MediaTile; contain?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const track = media.videoTrack(tile.identity, tile.source);
    const el = ref.current;
    if (!track || !el) return;
    track.attach(el);
    return () => { track.detach(el); };
  }, [tile.key, tile.identity, tile.source]);
  return <video ref={ref} autoPlay playsInline muted={tile.local} className={`h-full w-full bg-black ${contain ? 'object-contain' : 'object-cover'} ${tile.local && tile.source === 'camera' ? '-scale-x-100' : ''}`} />;
}

/** Floating camera tiles. Hidden when nobody has video on. */
export function VideoPanel() {
  const all = useMedia((s) => s.tiles);
  const tiles = all.filter((t) => t.source === 'camera');
  const speaking = useMedia((s) => s.speaking);
  const [min, setMin] = useState(false);
  if (!tiles.length) return null;
  return (
    <div className="pointer-events-auto w-44 overflow-hidden rounded-xl bg-panel shadow-lg sm:w-56">
      <button className="flex w-full items-center justify-between px-2.5 py-1.5 text-xs text-white/80" onClick={() => setMin(!min)} aria-expanded={!min}>
        <span>Video ({tiles.length})</span><span>{min ? '▸' : '▾'}</span>
      </button>
      {!min && (
        <div className="grid max-h-[50vh] gap-1 overflow-y-auto p-1">
          {tiles.map((t) => (
            <div key={t.key} className={`relative aspect-video overflow-hidden rounded-lg ${speaking.has(t.identity) ? 'ring-2 ring-green-400' : ''}`}>
              <VideoEl tile={t} />
              <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 text-[11px] text-white">{t.local ? 'You' : t.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Dedicated presentation panel for screen shares. */
export function PresentationPanel() {
  const share = useMedia((s) => s.tiles.find((t) => t.source === 'screen'));
  const [hidden, setHidden] = useState(false);
  useEffect(() => setHidden(false), [share?.key]);
  if (!share || hidden) return null;
  return (
    <div className="pointer-events-auto absolute inset-x-2 top-16 z-20 mx-auto max-w-4xl overflow-hidden rounded-xl bg-black shadow-2xl sm:inset-x-8">
      <div className="flex items-center justify-between bg-panel px-3 py-1.5 text-xs text-white">
        <span>{share.local ? 'You are presenting' : `${share.name} is presenting`}</span>
        <button onClick={() => setHidden(true)} className="rounded px-2 py-0.5 hover:bg-white/10" aria-label="Hide presentation">Hide</button>
      </div>
      <div className="aspect-video max-h-[60vh] w-full"><VideoEl tile={share} contain /></div>
    </div>
  );
}

const icon = {
  mic: <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Zm-7 9a7 7 0 0 0 14 0M12 19v3" />,
  cam: <path d="M3 7h12v10H3zM15 10l6-3v10l-6-3" />,
  screen: <path d="M3 4h18v12H3zM8 20h8M12 16v4" />,
  chat: <path d="M4 5h16v11H8l-4 4z" />,
  people: <path d="M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-6 9a6 6 0 0 1 12 0M17 11a3 3 0 0 0 0-6M21 20a6 6 0 0 0-4-5.6" />,
  settings: <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />,
  leave: <path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" />,
  build: <path d="M3 21h18M5 21V9l7-5 7 5v12M9 21v-6h6v6" />,
  more: <path d="M5 12h.01M12 12h.01M19 12h.01" />,
};
export type IconName = keyof typeof icon;
export function Icon({ name, off }: { name: IconName; off?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {icon[name]}
      {off && <path d="M3 3l18 18" />}
    </svg>
  );
}

/** Icon button for the dark toolbars. Desktop: icon only (label in the tooltip). Mobile nav passes showLabel. */
export function ToolButton({ name, label, active, off, danger, onClick, badge, disabled, showLabel = false }: { name: IconName; label: string; active?: boolean; off?: boolean; danger?: boolean; onClick: () => void; badge?: number; disabled?: boolean; showLabel?: boolean }) {
  return (
    <button
      onClick={onClick} disabled={disabled} aria-label={label} aria-pressed={active} title={label}
      className={`relative flex shrink-0 flex-col items-center justify-center gap-0.5 rounded-full text-[10px] font-medium transition-colors disabled:opacity-35 ${
        showLabel ? 'h-12 min-w-14 px-2' : 'h-10 w-10'} ${
        danger ? 'bg-red-600 text-white hover:bg-red-500' : off ? 'text-white/50 hover:bg-white/10 hover:text-white/80' : active ? 'bg-white text-stone-900' : 'text-white/90 hover:bg-white/10'}`}
    >
      <Icon name={name} off={off} />
      {showLabel && <span className="whitespace-nowrap">{label}</span>}
      {!!badge && <span className="absolute right-0.5 top-0.5 min-w-4 rounded-full bg-red-500 px-1 text-[10px] leading-4 text-white">{badge > 9 ? '9+' : badge}</span>}
    </button>
  );
}

/** Mic / camera / screen controls shared by desktop toolbar and mobile nav. */
export function MediaButtons({ compact = false }: { compact?: boolean }) {
  const { status, micOn, camOn, screenOn, canPublish } = useMedia();
  const ready = status === 'connected' && canPublish;
  return (
    <>
      <ToolButton name="mic" label={micOn ? 'Mute' : 'Unmute'} off={!micOn} disabled={!ready} onClick={media.toggleMic} showLabel={compact} />
      <ToolButton name="cam" label={camOn ? 'Stop video' : 'Start video'} off={!camOn} disabled={!ready} onClick={media.toggleCam} showLabel={compact} />
      {!compact && screenShareSupported() && <ToolButton name="screen" label={screenOn ? 'Stop share' : 'Share screen'} active={screenOn} disabled={!ready} onClick={media.toggleScreen} />}
    </>
  );
}

export function MediaStatusPill() {
  const { status, error, audioBlocked } = useMedia();
  if (audioBlocked && status === 'connected') {
    return <button onClick={media.startAudio} className="rounded-full bg-amber-500 px-3 py-1 text-xs font-medium text-white">Tap to enable audio</button>;
  }
  const map = {
    off: null, connected: null,
    connecting: ['Connecting voice…', 'bg-stone-700'],
    reconnecting: ['Voice reconnecting…', 'bg-amber-600'],
    unavailable: ['Voice/video not configured', 'bg-stone-700'],
    error: ['Voice/video unavailable', 'bg-red-600'],
  } as const;
  const v = map[status];
  if (!v) return null;
  return <span title={error ?? ''} className={`rounded-full px-3 py-1 text-xs text-white ${v[1]}`}>{v[0]}</span>;
}
