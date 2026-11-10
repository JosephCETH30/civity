import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { TEMPLATE_LABELS, type RoomSummary } from '@civitas/shared';
import { Alert, Button, Input, Logo, Spinner } from '../../components/ui';
import { api } from '../../services/api';
import { useAuth } from '../../stores/auth';
import { NameGate } from '../authentication/NameGate';

type Preview = { room: RoomSummary; access: { ok: boolean; role?: string; error?: string } };

/** Invitation landing: /join/:code. Shows the room and asks only for a username. */
export default function JoinRoom() {
  const { code } = useParams();
  const nav = useNavigate();
  const profile = useAuth((s) => s.profile);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [input, setInput] = useState('');

  useEffect(() => {
    if (!code) return;
    setPreview(null); setError('');
    api<Preview>(`/rooms/${encodeURIComponent(code)}`).then(setPreview, (e) => setError(e.message));
  }, [code, profile?.id]);

  return (
    <div className="min-h-full bg-canvas px-4 py-10">
      <div className="mx-auto max-w-md">
        <Link to="/" className="mb-8 inline-block"><Logo className="text-lg" /></Link>
        {!code ? (
          <form onSubmit={(e) => { e.preventDefault(); const c = input.trim().replace(/.*\/join\//, ''); if (c) nav(`/join/${encodeURIComponent(c)}`); }} className="rounded-[10px] border border-line bg-surface p-6">
            <h1 className="text-xl font-semibold">Join a city</h1>
            <p className="mt-1 text-sm text-ink-muted">Enter the invitation code you received.</p>
            <div className="mt-4 flex gap-2">
              <Input aria-label="Invitation code" placeholder="e.g. K7M2QX9P" value={input} onChange={(e) => setInput(e.target.value)} />
              <Button type="submit">Continue</Button>
            </div>
          </form>
        ) : error ? (
          <Alert>{error}</Alert>
        ) : !preview ? (
          <div className="text-brand"><Spinner /></div>
        ) : (
          <div className="rounded-[10px] border border-line bg-surface p-6">
            <p className="text-sm text-ink-muted">You're invited to</p>
            <h1 className="mt-0.5 text-2xl font-semibold tracking-tight">{preview.room.name}</h1>
            <p className="mt-1 text-sm text-ink-muted">{preview.room.description || TEMPLATE_LABELS[preview.room.template]} · hosted by {preview.room.ownerName}</p>
            <p className="mt-1 text-xs text-ink-subtle">{preview.room.online ?? 0}/{preview.room.maxParticipants} online</p>
            <div className="mt-6 border-t border-line pt-5">
              <NameGate title="Sign in to join" cta="Sign in and join">
                {preview.access.ok ? (
                  <Button size="lg" className="w-full" onClick={() => nav(`/room/${preview.room.id}`)}>
                    Enter as {profile?.displayName} ({preview.access.role})
                  </Button>
                ) : <Spinner />}
              </NameGate>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
