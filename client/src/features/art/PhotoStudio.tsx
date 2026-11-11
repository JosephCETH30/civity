// Photo-to-3D studio (M7): upload a realistic photo, an AI model estimates per-pixel depth in the browser,
// and the photo becomes a 3D relief sculpture that is placed in the park for everyone in the room.
import { Suspense, useEffect, useRef, useState, type ChangeEvent } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { defaultSpec } from '@civitas/shared';
import { useWorld } from '../../stores/world';
import { api } from '../../services/api';
import { realtime } from '../../services/realtime';
import { localPlayer } from '../../engine/core/transient';
import { estimateDepth, preparePhoto } from '../../engine/ai/depth';
import { ReliefMesh } from '../../engine/objects/ArtworkReliefs';
import { Button } from '../../components/ui';
import { FountainStudio } from './FountainStudio';
import { cn } from '@/lib/utils';

type Stage =
  | { kind: 'pick' }
  | { kind: 'working'; label: string; percent?: number }
  | { kind: 'ready'; photo: string; depth: string; aspect: number }
  | { kind: 'error'; message: string };

export function PhotoStudio() {
  const parkId = useWorld((s) => s.artStudio);
  const roomId = useWorld((s) => s.room?.id);
  const canEdit = useWorld((s) => s.self?.role === 'owner' || s.self?.role === 'editor');
  const [stage, setStage] = useState<Stage>({ kind: 'pick' });
  const [depthScale, setDepthScale] = useState(0.8);
  const [cutout, setCutout] = useState(0);
  const [placing, setPlacing] = useState(false);
  const [mode, setMode] = useState<'realism' | '3d'>('realism');
  const fileRef = useRef<HTMLInputElement>(null);
  const close = () => useWorld.getState().set({ artStudio: null });

  useEffect(() => { if (parkId) { setStage({ kind: 'pick' }); setDepthScale(0.8); setCutout(0); } }, [parkId]);
  if (!parkId) return null;

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setStage({ kind: 'working', label: 'Preparing photo' });
      const { dataUrl, aspect } = await preparePhoto(file);
      setStage({ kind: 'working', label: 'Loading the depth model (first time only, about 27 MB)', percent: 0 });
      const depth = await estimateDepth(dataUrl, (percent) => setStage({ kind: 'working', label: 'Loading the depth model (first time only, about 27 MB)', percent }));
      setStage({ kind: 'ready', photo: dataUrl, depth, aspect });
    } catch (err) {
      setStage({ kind: 'error', message: `Could not convert this photo: ${(err as Error).message}` });
    }
  }

  async function place() {
    if (stage.kind !== 'ready' || !roomId) return;
    setPlacing(true);
    try {
      const { id } = await api<{ id: string }>(`/rooms/${roomId}/artworks`, { body: { image: stage.photo, depth: stage.depth } });
      // Stand it 2.5 m in front of the player, facing them.
      const x = localPlayer.x + Math.sin(localPlayer.r) * 2.5, z = localPlayer.z + Math.cos(localPlayer.r) * 2.5;
      const spec = defaultSpec('artwork', { x, y: 0, z });
      spec.rotationY = localPlayer.r + Math.PI;
      spec.props = { assetId: id, depthScale, cutout, aspect: Math.min(5, Math.max(0.2, stage.aspect)) };
      realtime.send({ t: 'obj_add', spec });
      useWorld.getState().notify('Sculpture placed in the park');
      close();
    } catch (err) {
      setStage({ kind: 'error', message: (err as Error).message });
    } finally {
      setPlacing(false);
    }
  }

  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-stone-950/40 p-3" role="dialog" aria-label="Fountain studio">
      <div className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-[10px] border bg-card text-foreground shadow-lg">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h2 className="text-sm font-medium">Fountain studio</h2>
            <p className="text-xs text-muted-foreground">{mode === 'realism' ? 'AI realism: show a person at another age, a place in another era, or a realistic restyle.' : 'An AI model estimates the depth of every pixel, then the photo becomes a 3D sculpture in this park.'}</p>
          </div>
          <div className="ml-auto mr-2 flex rounded-md bg-muted p-0.5" role="tablist" aria-label="Studio mode">
            {([['realism', 'Realistic AI'], ['3d', 'Photo → 3D']] as const).map(([m, label]) => (
              <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
                className={cn('whitespace-nowrap rounded-[5px] px-2.5 py-1 text-xs font-medium', mode === m ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground')}>{label}</button>
            ))}
          </div>
          <button onClick={close} className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close fountain studio">✕</button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {mode === 'realism' && <FountainStudio onBack={close} />}
          {mode === '3d' && <>
          {!canEdit && <p className="text-sm text-muted-foreground">You need edit permission in this room to place sculptures. Ask the owner to make you an editor.</p>}
          {canEdit && stage.kind === 'pick' && (
            <div className="grid place-items-center gap-3 rounded-md border border-dashed px-4 py-10 text-center">
              <p className="text-sm">Choose a realistic photo with a clear subject: a person, pet, statue, plant or building.</p>
              <p className="text-xs text-muted-foreground">JPEG, PNG or WebP. The photo is resized before upload and stays in this room.</p>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={onFile} aria-label="Photo file" />
              <Button onClick={() => fileRef.current?.click()}>Choose photo</Button>
            </div>
          )}
          {stage.kind === 'working' && (
            <div className="py-10 text-center" role="status">
              <p className="text-sm">{stage.label}{stage.percent !== undefined && stage.percent > 0 ? ` · ${Math.round(stage.percent)}%` : ''}</p>
              <div className="mx-auto mt-3 h-1.5 max-w-xs overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-foreground transition-all" style={{ width: `${stage.percent ?? 15}%` }} />
              </div>
              <p className="mt-3 text-xs text-muted-foreground">Runs on your device. Later photos convert in a few seconds.</p>
            </div>
          )}
          {stage.kind === 'error' && (
            <div className="space-y-3 py-6 text-center">
              <p className="text-sm text-destructive">{stage.message}</p>
              <Button variant="secondary" onClick={() => setStage({ kind: 'pick' })}>Try another photo</Button>
            </div>
          )}
          {stage.kind === 'ready' && (
            <div className="grid gap-4 md:grid-cols-[1fr_200px]">
              <div className="aspect-square overflow-hidden rounded-md border bg-stone-200 md:aspect-[4/3]">
                <Canvas camera={{ position: [0, 1.6, 4.2], fov: 45 }} dpr={[1, 1.5]}>
                  <hemisphereLight args={['#ffffff', '#b9a98c', 1.6]} />
                  <directionalLight position={[2, 4, 3]} intensity={2.2} />
                  <Suspense fallback={null}>
                    <Preview photo={stage.photo} depth={stage.depth} aspect={stage.aspect} depthScale={depthScale} cutout={cutout} />
                  </Suspense>
                  <OrbitControls target={[0, 1.2, 0]} autoRotate autoRotateSpeed={1.2} enablePan={false} minDistance={2} maxDistance={8} />
                </Canvas>
              </div>
              <div className="space-y-4 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <figure><img src={stage.photo} alt="Your photo" className="aspect-square w-full rounded border object-cover" /><figcaption className="mt-1 text-xs text-muted-foreground">Photo</figcaption></figure>
                  <figure><img src={stage.depth} alt="Depth map estimated by the AI model" className="aspect-square w-full rounded border object-cover" /><figcaption className="mt-1 text-xs text-muted-foreground">AI depth map</figcaption></figure>
                </div>
                <label className="block">
                  <span className="mb-1 flex justify-between text-xs text-muted-foreground"><span>Depth</span><span>{depthScale.toFixed(1)} m</span></span>
                  <input type="range" min={0.2} max={2} step={0.1} value={depthScale} onChange={(e) => setDepthScale(+e.target.value)} className="w-full accent-[var(--primary)]" />
                </label>
                <label className="block">
                  <span className="mb-1 flex justify-between text-xs text-muted-foreground"><span>Remove background</span><span>{Math.round(cutout * 100)}%</span></span>
                  <input type="range" min={0} max={0.6} step={0.05} value={cutout} onChange={(e) => setCutout(+e.target.value)} className="w-full accent-[var(--primary)]" />
                </label>
                <div className="flex flex-col gap-2">
                  <Button onClick={place} loading={placing}>Place in this park</Button>
                  <Button variant="ghost" onClick={() => setStage({ kind: 'pick' })}>Use another photo</Button>
                </div>
              </div>
            </div>
          )}
          </>}
        </div>
      </div>
    </div>
  );
}

function Preview({ photo, depth, aspect, depthScale, cutout }: { photo: string; depth: string; aspect: number; depthScale: number; cutout: number }) {
  const [tex, setTex] = useState<[THREE.Texture, THREE.Texture] | null>(null);
  useEffect(() => {
    let live = true;
    const loader = new THREE.TextureLoader();
    let loaded: THREE.Texture[] = [];
    Promise.all([loader.loadAsync(photo), loader.loadAsync(depth)]).then((t) => {
      loaded = t;
      if (live) setTex(t as [THREE.Texture, THREE.Texture]);
      else t.forEach((x) => x.dispose());
    });
    return () => { live = false; loaded.forEach((x) => x.dispose()); };
  }, [photo, depth]);
  if (!tex) return null;
  return <ReliefMesh image={tex[0]} depth={tex[1]} aspect={aspect} depthScale={depthScale} cutout={cutout} segments={160} castShadow={false} />;
}
