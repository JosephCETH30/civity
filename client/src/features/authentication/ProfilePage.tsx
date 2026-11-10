import { useState, type ChangeEvent, type FormEvent } from 'react';
import type { Profile } from '@civitas/shared';
import { AppHeader } from '../../components/layout/AppHeader';
import { Avatar } from '../../components/layout/Avatar';
import { Alert, Button, Field, Input } from '../../components/ui';
import { useNavigate } from 'react-router';
import { api, type AuthResult } from '../../services/api';
import { useAuth } from '../../stores/auth';

const COLORS = ['#2f7de1', '#e0663a', '#3aa76d', '#9b6fd0', '#d9a520', '#d6457a', '#0f766e', '#475569'];

/** Email sign-in for this account. A name-only account adds one here and keeps its rooms. */
function AccountSection() {
  const profile = useAuth((s) => s.profile)!;
  const { setSession, signOut } = useAuth();
  const nav = useNavigate();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function addEmail(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError('');
    try { setSession(await api<AuthResult>('/auth/register', { body: Object.fromEntries(new FormData(e.currentTarget)) })); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  return (
    <section className="mt-6 space-y-4 rounded-[10px] border border-line bg-surface p-5 sm:p-6">
      <h2 className="font-semibold">Account</h2>
      {profile.email ? (
        <p className="text-sm text-muted-foreground">Signed in as <span className="font-medium text-foreground">{profile.email}</span></p>
      ) : (
        <form onSubmit={addEmail} className="space-y-4">
          <Alert kind="info">This account only lives in this browser. Add an email to keep your rooms on any device.</Alert>
          {error && <Alert>{error}</Alert>}
          <Field label="Email"><Input name="email" type="email" required autoComplete="email" /></Field>
          <Field label="Password" hint="At least 8 characters."><Input name="password" type="password" required minLength={8} autoComplete="new-password" /></Field>
          <Button type="submit" loading={busy}>Add email</Button>
        </form>
      )}
      <Button variant="secondary" disabled={!profile.email} title={profile.email ? undefined : 'Add an email first, or you lose this account'}
        onClick={() => { signOut(); nav('/'); }}>Sign out</Button>
    </section>
  );
}

export default function ProfilePage() {
  const profile = useAuth((s) => s.profile)!;
  const setProfile = useAuth((s) => s.setProfile);
  const [color, setColor] = useState(profile.avatarColor);
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setMsg(null);
    try {
      setProfile(await api<Profile>('/me', { method: 'PATCH', body: { username: f.get('username'), displayName: f.get('displayName'), avatarColor: color } }));
      setMsg({ kind: 'success', text: 'Profile saved' });
    } catch (err) { setMsg({ kind: 'error', text: (err as Error).message }); } finally { setBusy(false); }
  }

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 1024 * 1024) return setMsg({ kind: 'error', text: 'Image must be under 1 MB' });
    const dataUrl = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(file); });
    try {
      setProfile(await api<Profile>('/me/avatar', { body: { dataUrl } }));
      setMsg({ kind: 'success', text: 'Avatar updated' });
    } catch (err) { setMsg({ kind: 'error', text: (err as Error).message }); }
  }

  return (
    <div className="min-h-full">
      <AppHeader />
      <main className="mx-auto max-w-xl px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
        <form onSubmit={save} className="mt-6 space-y-5 rounded-[10px] border border-line bg-surface p-5 sm:p-6">
          {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
          <div className="flex items-center gap-4">
            <Avatar profile={{ ...profile, avatarColor: color }} size={64} />
            <label className="cursor-pointer rounded-xl border border-line px-3 py-2 text-sm font-medium hover:bg-canvas">
              Upload photo
              <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={upload} />
            </label>
          </div>
          <Field label="Display name"><Input name="displayName" defaultValue={profile.displayName} required maxLength={40} /></Field>
          <Field label="Username"><Input name="username" defaultValue={profile.username} required pattern="[A-Za-z0-9_]{3,24}" /></Field>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Avatar color in the city</legend>
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button key={c} type="button" aria-label={`Color ${c}`} aria-pressed={color === c} onClick={() => setColor(c)}
                  className={`h-9 w-9 rounded-full border-2 ${color === c ? 'border-ink' : 'border-transparent'}`} style={{ background: c }} />
              ))}
            </div>
          </fieldset>
          <Button type="submit" loading={busy}>Save</Button>
        </form>
        <AccountSection />
      </main>
    </div>
  );
}
