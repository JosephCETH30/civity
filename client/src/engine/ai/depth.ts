// Monocular depth estimation in the browser: Depth Anything V2 (small) via Transformers.js (ONNX Runtime Web).
// No server GPU, no API key: the model (~27 MB, quantized) downloads once from Hugging Face and is cached by the browser.
// Loaded lazily so nobody pays for it unless they open the photo-to-3D studio.

const MODEL = 'onnx-community/depth-anything-v2-small';
type Estimator = (input: string) => Promise<{ depth: { width: number; height: number; toCanvas(): HTMLCanvasElement | OffscreenCanvas } }>;
let loading: Promise<Estimator> | null = null;

export function loadDepthModel(onProgress: (percent: number) => void): Promise<Estimator> {
  loading ??= (async () => {
    const { pipeline } = await import('@huggingface/transformers');
    // WASM + int8 weights: works on every browser and keeps the download small (WebGPU is not available everywhere).
    return (await pipeline('depth-estimation', MODEL, {
      device: 'wasm',
      dtype: 'q8',
      progress_callback: (p: { status: string; progress?: number }) => {
        if (p.status === 'progress_total' && typeof p.progress === 'number') onProgress(p.progress);
      },
    })) as unknown as Estimator;
  })();
  loading.catch(() => { loading = null; }); // allow a retry after a failed download
  return loading;
}

/** Depth map for a photo as a grayscale PNG data URL (brighter = closer), at most `maxSide` px. */
export async function estimateDepth(photoDataUrl: string, onProgress: (percent: number) => void, maxSide = 256) {
  const estimator = await loadDepthModel(onProgress);
  const { depth } = await estimator(photoDataUrl);
  const src = depth.toCanvas();
  const scale = Math.min(1, maxSide / Math.max(depth.width, depth.height));
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(depth.width * scale));
  out.height = Math.max(1, Math.round(depth.height * scale));
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src as CanvasImageSource, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

/** Downscale a user photo to a JPEG data URL small enough to upload (<= ~1 MB). */
export async function preparePhoto(file: File, maxSide = 1024): Promise<{ dataUrl: string; aspect: number }> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Choose a JPEG, PNG or WebP photo');
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bitmap.width * scale);
  c.height = Math.round(bitmap.height * scale);
  c.getContext('2d')!.drawImage(bitmap, 0, 0, c.width, c.height);
  bitmap.close();
  let quality = 0.88;
  let dataUrl = c.toDataURL('image/jpeg', quality);
  while (dataUrl.length * 0.75 > 1_000_000 && quality > 0.4) dataUrl = c.toDataURL('image/jpeg', (quality -= 0.12));
  return { dataUrl, aspect: c.width / c.height };
}
