#!/usr/bin/env node
// Command-line receipt scanner, runs entirely on this computer.
// Usage: npm run scan -- path/to/receipt.jpg [more.jpg ...] [--text]
// Prints the bill fields Hearth would fill in, as JSON (add --text to also see the raw OCR text).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorker } from 'tesseract.js';
import { parseReceipt } from '../src/lib/receipt/parse.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const showText = args.includes('--text');
const files = args.filter((a) => !a.startsWith('--'));
if (!files.length) {
  console.error('Usage: npm run scan -- <receipt image> [...more] [--text]');
  process.exit(1);
}

const worker = await createWorker('eng', 1, {
  langPath: path.join(root, 'node_modules/@tesseract.js-data/eng/4.0.0_best_int'), // local model, no download
  gzip: true,
  cachePath: path.join(root, 'node_modules/.cache/tesseract'),
});
await worker.setParameters({ tessedit_pageseg_mode: '4', preserve_interword_spaces: '1' }); // PSM 4 = single column

for (const file of files) {
  const { data } = await worker.recognize(path.resolve(file));
  const r = parseReceipt(data.text);
  const out = {
    file,
    title: r.title,
    amount: r.totalCents != null ? (r.totalCents / 100).toFixed(2) : null,
    date: r.date,
    category: r.category,
    description: r.description,
    confidence: { ...r.confidence, ocr: Math.round(data.confidence) },
  };
  if (showText) out.rawText = data.text;
  console.log(JSON.stringify(out, null, 2));
}
await worker.terminate();
