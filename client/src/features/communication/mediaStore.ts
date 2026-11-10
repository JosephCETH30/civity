import { create } from 'zustand';

export type MediaStatus = 'off' | 'connecting' | 'connected' | 'reconnecting' | 'unavailable' | 'error';

export interface MediaTile {
  key: string; // participant identity + source
  identity: string; // = CIVITAS user id
  name: string;
  source: 'camera' | 'screen';
  local: boolean;
}

interface MediaState {
  status: MediaStatus;
  error: string | null;
  canPublish: boolean;
  micOn: boolean;
  camOn: boolean;
  screenOn: boolean;
  audioBlocked: boolean;
  spatial: boolean;
  speaking: Set<string>; // user ids currently speaking
  tiles: MediaTile[];
  devices: { audioinput: MediaDeviceInfo[]; videoinput: MediaDeviceInfo[] };
  set: (p: Partial<MediaState>) => void;
}

export const useMedia = create<MediaState>((set) => ({
  status: 'off',
  error: null,
  canPublish: false,
  micOn: false,
  camOn: false,
  screenOn: false,
  audioBlocked: false,
  spatial: false,
  speaking: new Set(),
  tiles: [],
  devices: { audioinput: [], videoinput: [] },
  set: (p) => set(p),
}));
