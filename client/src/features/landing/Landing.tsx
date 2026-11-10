// Landing: one screen, one job (get into a room). Background is a real render of a CIVITAS city.
import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { useAuth } from '../../stores/auth';
import { useEnter } from '../../animations/useEnter';

export default function Landing() {
  const profile = useAuth((s) => s.profile);
  const nav = useNavigate();
  const card = useRef<HTMLDivElement>(null);
  const [code, setCode] = useState('');
  useEnter(card, { y: 8 });

  const join = (e: FormEvent) => {
    e.preventDefault();
    const c = code.trim().replace(/.*\/join\//, '');
    if (c) nav(`/join/${encodeURIComponent(c)}`);
  };

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-stone-900 text-white">
      <img src="/landing/city.jpg" alt="" width={1600} height={1000} fetchPriority="high" className="absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-0 bg-stone-950/40" aria-hidden />

      <header className="relative flex h-16 items-center justify-end px-5">
        {profile && <Link to="/dashboard" className="rounded-md px-3 py-2 text-sm font-medium text-white/90 hover:bg-white/10">My rooms</Link>}
      </header>

      <main className="relative flex flex-1 flex-col items-center justify-center px-4">
        <div ref={card} className="w-full max-w-[360px]">
          <h1 data-enter className="text-center text-[2.6rem] font-semibold tracking-tight">CIVITAS</h1>
          <p data-enter className="mb-7 mt-1 text-center text-white/80">Meet inside a city you build together.</p>
          <form data-enter onSubmit={join} className="rounded-[10px] bg-card p-4 text-foreground shadow-xl">
            <label htmlFor="code" className="mb-2 block text-center text-sm font-medium">Room code</label>
            <Input
              id="code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Enter code"
              autoComplete="off" autoCapitalize="characters" spellCheck={false}
              className="h-12 text-center font-mono text-lg tracking-[0.2em] placeholder:font-sans placeholder:tracking-normal"
            />
            <Button type="submit" size="lg" className="mt-3 h-12 w-full bg-stone-900 text-base text-white hover:bg-stone-800" disabled={!code.trim()}>Join</Button>
          </form>
          <p data-enter className="mt-5 text-center text-sm text-white/85">
            Hosting? <Link to="/rooms/new" className="font-medium text-white underline underline-offset-4">Create a city room</Link>
          </p>
        </div>
      </main>

      <footer className="relative px-4 pb-5 text-center text-xs text-white/80">
        Just a username, no account. Usernames, chat and city edits are stored on this server.
      </footer>
    </div>
  );
}
