// WebSocket client for the authoritative room server: reconnection, outbox for edits made while offline,
// 10 Hz movement uplink, and routing server messages into the world store / transient maps.
import type { ClientMessage, PlayerState, ServerMessage } from '@civitas/shared';
import { useWorld } from '../stores/world';
import { localPlayer, remoteRendered, remoteTargets } from '../engine/core/transient';
import { tokenStore } from './api';

const SEND_HZ = 10;

class RealtimeClient {
  private ws: WebSocket | null = null;
  private roomId = '';
  private retry = 0;
  private stopped = true;
  private outbox: ClientMessage[] = [];
  private moveTimer?: ReturnType<typeof setInterval>;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private lastSent = { x: NaN, z: NaN, r: NaN, a: '' };
  private initialized = false; // true once the current socket received init
  private spawned = false; // true after the first init of this room visit

  connect(roomId: string) {
    this.stop();
    this.roomId = roomId;
    this.stopped = false;
    this.retry = 0;
    this.spawned = false;
    useWorld.getState().reset();
    this.open();
  }

  private open() {
    this.initialized = false;
    const st = useWorld.getState();
    st.set({ status: this.retry ? 'reconnecting' : 'connecting' });
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/ws?room=${encodeURIComponent(this.roomId)}&token=${encodeURIComponent(tokenStore.get() ?? '')}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    let fatal = false;
    ws.onmessage = (ev) => {
      let m: ServerMessage;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === 'error' && m.fatal) fatal = true;
      this.handle(m);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      clearInterval(this.moveTimer);
      remoteTargets.clear();
      remoteRendered.clear();
      if (this.stopped) return;
      if (fatal) { useWorld.getState().set({ status: 'failed' }); return; }
      // Exponential backoff, capped. The world stays visible and editable meanwhile; edits are queued.
      const delay = Math.min(10_000, 500 * 2 ** this.retry++);
      useWorld.getState().set({ status: 'reconnecting' });
      this.retryTimer = setTimeout(() => this.open(), delay);
    };
  }

  stop() {
    this.stopped = true;
    clearInterval(this.moveTimer);
    clearTimeout(this.retryTimer);
    this.ws?.close();
    this.ws = null;
    this.outbox = [];
    remoteTargets.clear();
    remoteRendered.clear();
  }

  /** Send now if connected; otherwise queue world edits/chat to flush on reconnect. Movement is never queued. */
  send(m: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN && this.initialized) this.ws.send(JSON.stringify(m));
    else if (m.t !== 'move' && m.t !== 'ping' && this.outbox.length < 200) this.outbox.push(m);
  }

  private startMoveLoop() {
    clearInterval(this.moveTimer);
    this.lastSent = { x: NaN, z: NaN, r: NaN, a: '' };
    this.moveTimer = setInterval(() => {
      if (!localPlayer.moved) return;
      const p = localPlayer, l = this.lastSent;
      if (Math.abs(p.x - l.x) < 0.02 && Math.abs(p.z - l.z) < 0.02 && Math.abs(p.r - l.r) < 0.02 && p.a === l.a) return;
      localPlayer.moved = false;
      this.lastSent = { x: p.x, z: p.z, r: p.r, a: p.a };
      this.send({ t: 'move', p: [p.x, p.y, p.z], r: p.r, a: p.a });
    }, 1000 / SEND_HZ);
  }

  private handle(m: ServerMessage) {
    const st = useWorld.getState();
    switch (m.t) {
      case 'init': {
        const players: Record<string, PlayerState> = {};
        remoteTargets.clear();
        for (const p of m.players) {
          players[p.id] = p;
          if (p.id !== m.self.sessionId) remoteTargets.set(p.id, { x: p.p[0], y: p.p[1], z: p.p[2], r: p.r, a: p.a });
        }
        const me = m.players.find((p) => p.id === m.self.sessionId);
        // Keep our position across reconnects; use the server spawn on first join.
        if (me && !this.spawned) Object.assign(localPlayer, { x: me.p[0], y: 0, z: me.p[2], r: 0, vy: 0, inside: null, seat: null, waveUntil: 0, moved: true });
        localPlayer.moved = true;
        st.set({
          status: 'connected', error: null, room: m.room, self: m.self, players,
          objects: Object.fromEntries(m.objects.map((o) => [o.id, o])),
          routes: Object.fromEntries(m.routes.map((r) => [r.id, r])),
          messages: m.messages, sim: m.sim, serverOffset: m.serverNow - Date.now(),
        });
        if (st.selectedId && !m.objects.some((o) => o.id === st.selectedId)) st.set({ selectedId: null });
        this.retry = 0;
        this.initialized = true;
        this.spawned = true;
        const queued = this.outbox.splice(0);
        for (const q of queued) this.send(q);
        if (queued.length) st.notify(`Reconnected. Synced ${queued.length} pending change(s).`);
        this.startMoveLoop();
        break;
      }
      case 'player_join':
        st.set({ players: { ...st.players, [m.player.id]: m.player } });
        remoteTargets.set(m.player.id, { x: m.player.p[0], y: m.player.p[1], z: m.player.p[2], r: m.player.r, a: m.player.a });
        break;
      case 'player_leave': {
        const { [m.id]: _, ...rest } = st.players;
        st.set({ players: rest });
        remoteTargets.delete(m.id);
        remoteRendered.delete(m.id);
        break;
      }
      case 'snap':
        for (const [id, x, y, z, r, a] of m.players) {
          if (id === st.self?.sessionId) continue;
          const t = remoteTargets.get(id);
          if (t) Object.assign(t, { x, y, z, r, a });
          else remoteTargets.set(id, { x, y, z, r, a });
        }
        break;
      case 'presence': {
        const p = st.players[m.id];
        if (p) st.set({ players: { ...st.players, [m.id]: { ...p, activity: m.activity } } });
        break;
      }
      case 'role': {
        const p = st.players[m.id];
        if (p) st.set({ players: { ...st.players, [m.id]: { ...p, role: m.role } } });
        if (m.id === st.self?.sessionId) {
          st.set({ self: { ...st.self, role: m.role }, tool: { kind: 'select' } });
          st.notify(`Your role is now ${m.role}`);
        }
        break;
      }
      case 'chat':
        st.set({ messages: [...st.messages.slice(-199), m.message], unread: st.unread + 1 });
        break;
      case 'obj_added':
      case 'obj_updated':
        st.set({ objects: { ...st.objects, [m.object.id]: m.object } });
        break;
      case 'obj_deleted': {
        const { [m.id]: _, ...rest } = st.objects;
        st.set({ objects: rest, selectedId: st.selectedId === m.id ? null : st.selectedId });
        break;
      }
      case 'route_added':
        st.set({ routes: { ...st.routes, [m.route.id]: m.route } });
        break;
      case 'route_deleted': {
        const { [m.id]: _, ...rest } = st.routes;
        st.set({ routes: rest });
        break;
      }
      case 'sim':
        st.set({ sim: m.sim, serverOffset: m.serverNow - Date.now() });
        break;
      case 'pong':
        break;
      case 'error':
        if (m.fatal) st.set({ status: 'failed', error: m.message });
        else st.notify(m.message, 'error');
        break;
    }
  }
}

export const realtime = new RealtimeClient();
export const serverNow = () => Date.now() + useWorld.getState().serverOffset;
