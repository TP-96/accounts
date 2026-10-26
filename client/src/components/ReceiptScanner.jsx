import { useRef, useState } from 'react';
import { Camera, ScanText, X } from 'lucide-react';
import { scanReceipt } from '../lib/receipt/scan.js';

/**
 * "Scan a receipt" control. Reads the photo on this device, then hands parsed
 * fields to onResult. Nothing is uploaded.
 */
export default function ReceiptScanner({ onResult }) {
  const input = useRef(null);
  const [status, setStatus] = useState(null); // {stage, progress}
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [raw, setRaw] = useState(null);

  async function handle(file) {
    if (!file) return;
    setError(null);
    setRaw(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(file));
    setStatus({ stage: 'Preparing photo', progress: 0.02 });
    try {
      const result = await scanReceipt(file, setStatus);
      setRaw(result.rawText);
      if (result.totalCents == null && !result.merchant) {
        setError("Couldn't find a total on that photo. Try again in better light, with the whole receipt flat in frame.");
      } else {
        onResult(result);
      }
    } catch (e) {
      setError(e.message || 'Scanning failed. Try another photo.');
    } finally {
      setStatus(null);
      if (input.current) input.current.value = '';
    }
  }

  const busy = !!status;
  return (
    <div className="scan-box">
      <div className="scan-row">
        {preview ? (
          <img src={preview} alt="Receipt you scanned" className="scan-thumb" />
        ) : (
          <span className="scan-icon" aria-hidden="true">
            <ScanText size={22} />
          </span>
        )}
        <div className="list-main">
          <div style={{ fontWeight: 600 }}>{busy ? status.stage : preview ? 'Receipt scanned' : 'Have a receipt?'}</div>
          <div className="faint">
            {busy
              ? 'This happens on your device and takes a few seconds.'
              : preview
                ? 'Filled-in fields are highlighted below. Edit anything it got wrong.'
                : 'Snap or upload it to fill in the amount, name, date and items. Read on your device, never uploaded.'}
          </div>
        </div>
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => input.current?.click()}>
          <Camera size={16} /> {preview ? 'Scan another' : 'Scan receipt'}
        </button>
        <input
          ref={input}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => handle(e.target.files?.[0])}
          aria-label="Receipt photo"
        />
      </div>
      {busy && (
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(status.progress * 100)}>
          <span style={{ width: `${Math.round(status.progress * 100)}%` }} />
        </div>
      )}
      {error && (
        <div className="error" role="alert" style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" className="btn btn-ghost btn-sm" style={{ height: 24, padding: 0 }} onClick={() => setError(null)} aria-label="Dismiss">
            <X size={16} />
          </button>
        </div>
      )}
      {raw && (
        <details className="scan-raw">
          <summary>Show the text it read</summary>
          <pre>{raw}</pre>
        </details>
      )}
    </div>
  );
}
