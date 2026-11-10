import { Link } from 'react-router';
import { Logo } from '../ui';
import { useAuth } from '../../stores/auth';
import { Avatar } from './Avatar';

export function AppHeader() {
  const profile = useAuth((s) => s.profile);
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link to="/dashboard" aria-label="Dashboard"><Logo /></Link>
        {profile && (
          <div className="flex items-center gap-2">
            <Link to="/profile" className="flex items-center gap-2 rounded-xl px-2 py-1 hover:bg-canvas">
              <Avatar profile={profile} size={28} />
              <span className="hidden text-sm font-medium sm:inline">{profile.displayName}</span>
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
