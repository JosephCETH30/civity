import { create } from 'zustand';
import type { Profile } from '@civitas/shared';
import { api, ApiError, tokenStore, type AuthResult } from '../services/api';

interface AuthState {
  profile: Profile | null;
  ready: boolean;
  init: () => Promise<void>;
  setSession: (r: AuthResult) => void;
  setProfile: (p: Profile) => void;
  signOut: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  profile: null,
  ready: false,
  async init() {
    if (!tokenStore.get()) return set({ ready: true });
    try {
      set({ profile: await api<Profile>('/me'), ready: true });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) tokenStore.set(null);
      set({ ready: true });
    }
  },
  setSession({ token, profile }) {
    tokenStore.set(token);
    set({ profile });
  },
  setProfile: (profile) => set({ profile }),
  signOut() {
    tokenStore.set(null);
    set({ profile: null });
  },
}));
