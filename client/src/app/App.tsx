import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { useAuth } from '../stores/auth';
import { Spinner } from '../components/ui';
import { ErrorBoundary } from '../components/ErrorBoundary';
import Landing from '../features/landing/Landing';
import { NameGate } from '../features/authentication/NameGate';
import { Logo } from '../components/ui';

// Heavy routes load on demand; the room route pulls in three.js and LiveKit.
const Dashboard = lazy(() => import('../features/dashboard/Dashboard'));
const CreateRoom = lazy(() => import('../features/rooms/CreateRoom'));
const JoinRoom = lazy(() => import('../features/rooms/JoinRoom'));
const ProfilePage = lazy(() => import('../features/authentication/ProfilePage'));
const RoomPage = lazy(() => import('../features/room/RoomPage'));

export function App() {
  const init = useAuth((s) => s.init);
  const ready = useAuth((s) => s.ready);
  useEffect(() => { init(); }, [init]);
  if (!ready) return <FullPageSpinner />;
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <Suspense fallback={<FullPageSpinner />}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/join" element={<JoinRoom />} />
            <Route path="/join/:code" element={<JoinRoom />} />
            <Route path="/dashboard" element={<RequireUser><Dashboard /></RequireUser>} />
            <Route path="/rooms/new" element={<RequireUser><CreateRoom /></RequireUser>} />
            <Route path="/profile" element={<RequireUser><ProfilePage /></RequireUser>} />
            <Route path="/room/:id" element={<RoomPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </BrowserRouter>
  );
}

/** No login: pages that need an identity just ask for a username inline. */
function RequireUser({ children }: { children: ReactNode }) {
  const profile = useAuth((s) => s.profile);
  if (profile) return <>{children}</>;
  return (
    <div className="min-h-full bg-canvas px-4 py-10">
      <div className="mx-auto max-w-sm">
        <Logo className="mb-8 text-lg" />
        <div className="rounded-[10px] border border-line bg-surface p-6"><NameGate /></div>
      </div>
    </div>
  );
}

export function FullPageSpinner() {
  return (
    <div className="grid h-full place-items-center text-brand">
      <Spinner className="h-8 w-8" />
    </div>
  );
}
