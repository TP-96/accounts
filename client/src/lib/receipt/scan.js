// On-device receipt scanning: the image never leaves the phone/computer.
// OCR engine + English model are bundled under /ocr (see scripts/copy-ocr-assets.mjs).
import { parseReceipt } from './parse.js';

const asset = (p) => new URL(`ocr/${p}`, document.baseURI).href;

let workerPromise = null;
let idleTimer = null;

async function getWorker(onProgress) {
  clearTimeout(idleTimer);
  if (!workerPromise) {
    workerPromise = (async () => {
      const mod = await import('tesseract.js'); // loaded only when someone scans
      const createWorker = mod.createWorker || mod.default.createWorker;
      const worker = await createWorker('eng', 1, {
        workerPath: asset('worker.min.js'),
        corePath: asset('core'),
        langPath: asset('lang'),
        gzip: true,
        logger: (m) => workerPromise.onProgress?.(m),
      });
      await worker.setParameters({
        tessedit_pageseg_mode: '4', // PSM 4 = single column: receipts are one tall column of lines
        preserve_interword_spaces: '1',
      });
      return worker;
    })();
    workerPromise.catch(() => (workerPromise = null));
  }
  workerPromise.onProgress = onProgress;
  return workerPromise;
}

function releaseLater() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    const p = workerPromise;
    workerPromise = null;
    (await p)?.terminate();
  }, 90_000);
}

/**
 * Returns an image Tesseract reads well. Testing showed it does best with the
 * untouched photo (its own thresholding beats manual contrast tweaks, which can
 * wipe out thin digits on faded receipts), so we only downscale very large
 * phone photos for speed and bake in the camera's rotation.
 */
export async function preprocess(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const longSide = Math.max(bitmap.width, bitmap.height);
  if (longSide <= 2400) {
    bitmap.close?.();
    return file;
  }
  const scale = 2400 / longSide;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b || file), 'image/png'));
}

/**
 * Scan a receipt image file and return parsed bill fields plus the raw text.
 * onProgress receives {stage, progress 0..1}.
 */
export async function scanReceipt(file, onProgress = () => {}) {
  if (!file || !file.type.startsWith('image/')) throw new Error('Choose a photo of a receipt (JPG, PNG or HEIC)');
  onProgress({ stage: 'Preparing photo', progress: 0.05 });
  const image = await preprocess(file);
  onProgress({ stage: 'Loading text recognition', progress: 0.1 });
  const worker = await getWorker((m) => {
    if (m.status === 'recognizing text') onProgress({ stage: 'Reading receipt', progress: 0.15 + m.progress * 0.8 });
  });
  try {
    const { data } = await worker.recognize(image);
    onProgress({ stage: 'Done', progress: 1 });
    const parsed = parseReceipt(data.text);
    return { ...parsed, rawText: data.text, ocrConfidence: Math.round(data.confidence) };
  } finally {
    releaseLater();
  }
}
