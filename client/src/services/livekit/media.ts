// LiveKit (WebRTC) media. Fully independent of the multiplayer socket: if media fails, the city keeps working.
import { Room, RoomEvent, Track, type Participant, type RemoteParticipant, type RemoteTrack } from 'livekit-client';
import { useMedia, type MediaTile } from '../../features/communication/mediaStore';
import { useWorld } from '../../stores/world';
import { localPlayer, remoteRendered, remoteTargets } from '../../engine/core/transient';
import { api, ApiError } from '../api';

const HEAR_FULL = 8; // spatial audio: full volume within this distance
const HEAR_MAX = 35; // silent beyond this distance

class MediaManager {
  room: Room | null = null;
  private audioEls = new Map<string, HTMLMediaElement[]>();
  private spatialTimer?: ReturnType<typeof setInterval>;
  private roomId = '';

  async connect(roomId: string) {
    this.disconnect();
    this.roomId = roomId;
    const st = useMedia.getState();
    st.set({ status: 'connecting', error: null });
    let creds: { url: string; token: string; canPublish: boolean };
    try {
      creds = await api(`/rooms/${roomId}/media-token`, { method: 'POST', body: {} });
    } catch (e) {
      if (this.roomId !== roomId) return;
      const unavailable = e instanceof ApiError && e.status === 503;
      return st.set({ status: unavailable ? 'unavailable' : 'error', error: (e as Error).message });
    }
    if (this.roomId !== roomId) return;
    const room = new Room({ adaptiveStream: true, dynacast: true, audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true } });
    this.room = room;
    const refresh = () => this.refreshTiles();
    room
      .on(RoomEvent.TrackSubscribed, (track, _pub, p) => { this.attachAudio(track, p); refresh(); })
      .on(RoomEvent.TrackUnsubscribed, (track) => {
        // Only remove the hidden <audio> elements we created; <video> tiles belong to React.
        const els = track.detach();
        if (track.kind === Track.Kind.Audio) els.forEach((el) => el.remove());
        refresh();
      })
      .on(RoomEvent.TrackMuted, refresh)
      .on(RoomEvent.TrackUnmuted, refresh)
      .on(RoomEvent.LocalTrackPublished, refresh)
      .on(RoomEvent.LocalTrackUnpublished, refresh)
      .on(RoomEvent.ParticipantDisconnected, refresh)
      .on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => useMedia.getState().set({ speaking: new Set(speakers.map((s) => s.identity)) }))
      .on(RoomEvent.AudioPlaybackStatusChanged, () => useMedia.getState().set({ audioBlocked: !room.canPlaybackAudio }))
      .on(RoomEvent.Reconnecting, () => useMedia.getState().set({ status: 'reconnecting' }))
      .on(RoomEvent.Reconnected, () => useMedia.getState().set({ status: 'connected' }))
      .on(RoomEvent.Disconnected, () => { if (this.room === room) useMedia.getState().set({ status: 'error', error: 'Voice/video disconnected', micOn: false, camOn: false, screenOn: false }); })
      .on(RoomEvent.MediaDevicesChanged, () => this.loadDevices());
    try {
      await room.connect(creds.url, creds.token);
    } catch (e) {
      if (this.room !== room) return;
      this.room = null;
      return st.set({ status: 'error', error: 'Could not connect to voice/video: ' + (e as Error).message });
    }
    if (this.room !== room) return void room.disconnect();
    st.set({ status: 'connected', canPublish: creds.canPublish, audioBlocked: !room.canPlaybackAudio });
    room.remoteParticipants.forEach((p) => p.trackPublications.forEach((pub) => pub.track && this.attachAudio(pub.track, p)));
    this.refreshTiles();
    this.loadDevices();
    this.spatialTimer = setInterval(() => this.applySpatial(), 250);
  }

  disconnect() {
    this.roomId = '';
    clearInterval(this.spatialTimer);
    const r = this.room;
    this.room = null;
    r?.disconnect();
    this.audioEls.forEach((els) => els.forEach((el) => el.remove()));
    this.audioEls.clear();
    useMedia.getState().set({ status: 'off', micOn: false, camOn: false, screenOn: false, tiles: [], speaking: new Set() });
  }

  private attachAudio(track: RemoteTrack | Track, p: Participant) {
    if (track.kind !== Track.Kind.Audio) return;
    const el = track.attach();
    el.style.display = 'none';
    document.body.appendChild(el);
    this.audioEls.set(p.identity, [...(this.audioEls.get(p.identity) ?? []), el]);
  }

  private refreshTiles() {
    const room = this.room;
    if (!room) return;
    const tiles: MediaTile[] = [];
    const add = (p: Participant, local: boolean) => {
      for (const pub of p.trackPublications.values()) {
        if (pub.kind !== Track.Kind.Video || !pub.track || pub.isMuted) continue;
        const source = pub.source === Track.Source.ScreenShare ? 'screen' : 'camera';
        tiles.push({ key: `${p.identity}:${source}`, identity: p.identity, name: p.name || 'Participant', source, local });
      }
    };
    add(room.localParticipant, true);
    room.remoteParticipants.forEach((p) => add(p, false));
    const lp = room.localParticipant;
    useMedia.getState().set({ tiles, micOn: lp.isMicrophoneEnabled, camOn: lp.isCameraEnabled, screenOn: lp.isScreenShareEnabled });
  }

  /** Video track for a tile (component attaches it to its own <video>). */
  videoTrack(identity: string, source: 'camera' | 'screen') {
    const room = this.room;
    if (!room) return undefined;
    const p = room.localParticipant.identity === identity ? room.localParticipant : room.remoteParticipants.get(identity);
    const pub = p?.getTrackPublication(source === 'screen' ? Track.Source.ScreenShare : Track.Source.Camera);
    return pub?.track;
  }

  private async toggle(kind: 'mic' | 'cam' | 'screen') {
    const room = this.room;
    const st = useMedia.getState();
    if (!room || st.status !== 'connected') return useWorld.getState().notify('Voice/video is not connected', 'error');
    if (!st.canPublish) return useWorld.getState().notify('Your role cannot speak or share in this room', 'error');
    const lp = room.localParticipant;
    try {
      if (kind === 'mic') await lp.setMicrophoneEnabled(!lp.isMicrophoneEnabled);
      if (kind === 'cam') await lp.setCameraEnabled(!lp.isCameraEnabled, { resolution: { width: 640, height: 360, frameRate: 24 } });
      if (kind === 'screen') await lp.setScreenShareEnabled(!lp.isScreenShareEnabled);
      await room.startAudio();
    } catch (e) {
      const msg = (e as Error).name === 'NotAllowedError' ? 'Permission denied. Allow access in your browser settings.' : (e as Error).message;
      useWorld.getState().notify(msg, 'error');
    }
    this.refreshTiles();
    this.loadDevices();
  }
  toggleMic = () => this.toggle('mic');
  toggleCam = () => this.toggle('cam');
  toggleScreen = () => this.toggle('screen');
  startAudio = () => this.room?.startAudio().then(() => useMedia.getState().set({ audioBlocked: false }));

  async loadDevices() {
    try {
      const [audioinput, videoinput] = await Promise.all([Room.getLocalDevices('audioinput', false), Room.getLocalDevices('videoinput', false)]);
      useMedia.getState().set({ devices: { audioinput, videoinput } });
    } catch { /* device enumeration unsupported */ }
  }
  switchDevice(kind: 'audioinput' | 'videoinput', id: string) {
    return this.room?.switchActiveDevice(kind, id);
  }

  /** Proximity audio: scale each remote participant's volume by distance between avatars. */
  private applySpatial() {
    const room = this.room;
    if (!room) return;
    const spatial = useMedia.getState().spatial;
    const players = useWorld.getState().players;
    room.remoteParticipants.forEach((p: RemoteParticipant) => {
      let vol = 1;
      if (spatial) {
        let best = Infinity;
        for (const pl of Object.values(players)) {
          if (pl.userId !== p.identity) continue;
          const pos = remoteRendered.get(pl.id) ?? remoteTargets.get(pl.id);
          if (pos) best = Math.min(best, Math.hypot(pos.x - localPlayer.x, pos.z - localPlayer.z));
        }
        vol = best <= HEAR_FULL ? 1 : best >= HEAR_MAX ? 0 : 1 - (best - HEAR_FULL) / (HEAR_MAX - HEAR_FULL);
      }
      p.setVolume(vol);
    });
  }
}

export const media = new MediaManager();
export const screenShareSupported = () => !!navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices;
