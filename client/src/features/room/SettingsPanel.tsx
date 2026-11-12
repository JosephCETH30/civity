import { savePref, useWorld, type CameraMode } from '../../stores/world';
import { useMedia } from '../communication/mediaStore';
import { media } from '../../services/livekit/media';
import { hasWebGL, type QualityLevel } from '../../engine/optimization/quality';
import { Select } from '../../components/ui';
import { useEffect, useState } from 'react';
import { perf } from '../../engine/core/transient';

const CAMERAS: [CameraMode, string, string][] = [['first', 'First person (eyes)', 'Eyes'], ['third', 'Third person', 'Follow'], ['top', 'Top-down', 'Top'], ['free', 'Free', 'Free'], ['overview', 'Overview', 'City']];

export function CameraSwitch({ light = false }: { light?: boolean }) {
  const mode = useWorld((s) => s.cameraMode);
  const renderMode = useWorld((s) => s.renderMode);
  const set = useWorld((s) => s.set);
  if (renderMode === '2d') return null;
  return (
    <div className={`flex shrink-0 rounded-full p-0.5 ${light ? 'bg-muted' : 'bg-white/10'}`} role="group" aria-label="Camera">
      {CAMERAS.map(([m, label, short]) => (
        <button key={m} onClick={() => set({ cameraMode: m })} aria-pressed={mode === m} aria-label={label} title={label}
          className={`h-8 whitespace-nowrap rounded-full px-3 text-xs font-medium transition-colors ${mode === m ? (light ? 'bg-card text-foreground shadow-sm' : 'bg-white text-stone-900') : light ? 'text-muted-foreground hover:text-foreground' : 'text-white/70 hover:text-white'}`}>{light ? label : short}</button>
      ))}
    </div>
  );
}

const darkSelect = 'h-9';

export function SettingsPanel() {
  const { quality, autoQuality, renderMode, set } = useWorld();
  const { spatial, devices, status } = useMedia();
  const webgl = hasWebGL();
  return (
    <div className="space-y-4 text-sm text-foreground">
      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Display</h3>
        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">View</span>
          <Select className={darkSelect} value={renderMode} onChange={(e) => { const v = e.target.value as '3d' | '2d'; set({ renderMode: v }); savePref('renderMode', v); }}>
            <option value="3d" disabled={!webgl}>3D city{!webgl ? ' (WebGL unavailable)' : ''}</option>
            <option value="2d">2D map (lightweight)</option>
          </Select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">Graphics quality</span>
          <Select className={darkSelect} value={quality} disabled={renderMode === '2d'}
            onChange={(e) => { const v = e.target.value as QualityLevel; set({ quality: v, autoQuality: false }); savePref('quality', v); savePref('autoQuality', false); }}>
            <option value="low">Low: fastest, no shadows</option>
            <option value="balanced">Balanced</option>
            <option value="high">High: best visuals</option>
          </Select>
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={autoQuality} className="h-4 w-4 accent-[var(--color-brand)]" onChange={(e) => { set({ autoQuality: e.target.checked }); savePref('autoQuality', e.target.checked); }} />
          Automatically lower quality when the frame rate drops
        </label>
      </section>
      {renderMode === '3d' && <PerfLine />}
      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Audio & video</h3>
        <label className="flex items-start gap-2 text-xs">
          <input type="checkbox" checked={spatial} className="mt-0.5 h-4 w-4 accent-[var(--color-brand)]" onChange={(e) => useMedia.getState().set({ spatial: e.target.checked })} />
          <span>Spatial audio: hear people louder when their avatar is near you (silent beyond ~35 m)</span>
        </label>
        {status === 'connected' && (
          <>
            {!!devices.audioinput.length && (
              <label className="block">
                <span className="mb-1 block text-xs text-muted-foreground">Microphone</span>
                <Select className={darkSelect} onChange={(e) => media.switchDevice('audioinput', e.target.value)}>
                  {devices.audioinput.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Microphone'}</option>)}
                </Select>
              </label>
            )}
            {!!devices.videoinput.length && (
              <label className="block">
                <span className="mb-1 block text-xs text-muted-foreground">Camera</span>
                <Select className={darkSelect} onChange={(e) => media.switchDevice('videoinput', e.target.value)}>
                  {devices.videoinput.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Camera'}</option>)}
                </Select>
              </label>
            )}
            {!devices.audioinput.length && <p className="text-xs text-muted-foreground">Turn on your mic once to choose a device.</p>}
          </>
        )}
      </section>
      <section className="space-y-1 text-xs text-muted-foreground">
        <h3 className="font-semibold uppercase tracking-wide text-muted-foreground">Controls</h3>
        <p>WASD or arrows to walk, Shift to run, Space to jump, Q to wave. E to sit on a bench or chair, enter a building through its door, and leave again. Drag to rotate the camera, scroll or pinch to zoom, click to select.</p>
      </section>
    </div>
  );
}

function PerfLine() {
  const [p, setP] = useState({ ...perf });
  useEffect(() => { const t = setInterval(() => setP({ ...perf }), 1000); return () => clearInterval(t); }, []);
  return (
    <p className="text-xs text-muted-foreground" aria-live="off" data-testid="perf">
      Measured: {p.fps} fps · {p.calls} draw calls · {Math.round(p.tris / 1000)}k triangles
    </p>
  );
}
