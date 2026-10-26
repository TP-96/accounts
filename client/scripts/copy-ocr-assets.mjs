// Copies the OCR engine + English model into public/ocr so receipt scanning runs
// fully on-device and offline (no CDN downloads at scan time).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nm = path.join(root, 'node_modules');
const out = path.join(root, 'public', 'ocr');
fs.mkdirSync(path.join(out, 'core'), { recursive: true });
fs.mkdirSync(path.join(out, 'lang'), { recursive: true });

const copy = (from, to) => fs.copyFileSync(path.join(nm, from), path.join(out, to));
copy('tesseract.js/dist/worker.min.js', 'worker.min.js');
for (const f of ['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js']) {
  copy(`tesseract.js-core/${f}`, `core/${f}`);
}
// "best_int" model: small (≈3 MB) and more accurate than the default fast model.
copy('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'lang/eng.traineddata.gz');
console.log('OCR assets copied to public/ocr');
