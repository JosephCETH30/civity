// Shown while looking through a scene camera (Blender's camera view): which camera, its field of view, switch to
// the previous/next camera, and exit (button or Esc).
import { useEffect } from 'react';
import { useWorld } from '../../stores/world';

export function CameraViewBanner() {
  const viewCamera = useWorld((s) => s.viewCamera);
  const objects = useWorld((s) => s.objects);
  const set = useWorld((s) => s.set);
  useEffect(() => {
    if (!viewCamera) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') set({ viewCamera: null }); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [viewCamera, set]);
  const cam = viewCamera ? objects[viewCamera] : undefined;
  if (!cam) return null;
  const cams = Object.values(objects).filter((o) => o.type === 'camera');
  const i = cams.findIndex((o) => o.id === cam.id);
  const go = (d: number) => set({ viewCamera: cams[(i + d + cams.length) % cams.length].id });
  const btn = 'rounded px-2 py-1 font-medium hover:bg-white/15';
  return (
    <div className="absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-2 rounded-md bg-stone-950/80 py-1.5 pl-3 pr-1.5 text-xs text-white shadow-lg" role="status">
      <span>Camera view: <b className="font-medium">{cam.props.name || `Camera ${i + 1}`}</b> · FOV {cam.props.fov ?? 40}°</span>
      {cams.length > 1 && (
        <>
          <button className={btn} onClick={() => go(-1)} aria-label="Previous camera">‹</button>
          <button className={btn} onClick={() => go(1)} aria-label="Next camera">›</button>
        </>
      )}
      <button className={btn + ' bg-white/10'} onClick={() => set({ viewCamera: null })}>Exit (Esc)</button>
    </div>
  );
}
