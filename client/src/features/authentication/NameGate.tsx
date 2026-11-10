import { useState, type FormEvent } from 'react';
import { Alert, Button, Field, Input } from '../../components/ui';
import { api, type AuthResult } from '../../services/api';
import { useAuth } from '../../stores/auth';

/** Sign in / create account with email + password. Renders children once signed in. */
export function NameGate({ title, cta, children }: { title?: string; cta?: string; children?: React.ReactNode }) {
  const profile = useAuth((s) => s.profile);
  const setSession = useAuth((s) => s.setSession);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (profile) return <>{children}</>;
  const signup = mode === 'signup';

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true); setError('');
    try {
      setSession(await api<AuthResult>(signup ? '/auth/register' : '/auth/login', { body: f }));
    } catch (err) { setError((err as Error).message); setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{title ?? (signup ? 'Create your account' : 'Sign in')}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">Your rooms stay yours on any device.</p>
      </div>
      {error && <Alert>{error}</Alert>}
      {signup && (
        <Field label="Name" hint="Shown to others in the city.">
          <Input name="name" required minLength={2} maxLength={24} autoComplete="nickname" placeholder="e.g. Rafa" />
        </Field>
      )}
      <Field label="Email"><Input name="email" type="email" required autoComplete="email" autoFocus /></Field>
      <Field label="Password" hint={signup ? 'At least 8 characters.' : undefined}>
        <Input name="password" type="password" required minLength={signup ? 8 : 1} autoComplete={signup ? 'new-password' : 'current-password'} />
      </Field>
      <Button type="submit" className="w-full" loading={busy}>{signup ? 'Create account' : cta ?? 'Sign in'}</Button>
      <p className="text-center text-sm text-muted-foreground">
        {signup ? 'Already have an account?' : 'New here?'}{' '}
        <button type="button" className="font-medium text-foreground underline-offset-4 hover:underline" onClick={() => { setMode(signup ? 'signin' : 'signup'); setError(''); }}>
          {signup ? 'Sign in' : 'Create an account'}
        </button>
      </p>
    </form>
  );
}
