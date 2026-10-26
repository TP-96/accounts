let currency = 'CAD';
export const setCurrency = (c) => {
  currency = c || 'CAD';
};

export function money(cents, { signed = false } = {}) {
  const s = new Intl.NumberFormat('en-CA', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).format(Math.abs(cents) / 100);
  if (!signed || cents === 0) return s;
  return cents > 0 ? `+${s}` : `−${s}`;
}

export function shortDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const sameYear = dt.getFullYear() === new Date().getFullYear();
  return dt.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

export function timeAgo(ts) {
  if (!ts) return '';
  // Server sends ISO strings ("2026-10-26T22:05:00.000Z"); older SQLite rows were "2026-10-26 22:05:00".
  const t = Date.parse(ts.includes('T') ? ts : `${ts.replace(' ', 'T')}Z`);
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return shortDate(new Date(t).toISOString());
}

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const CATEGORY_LABELS = {
  rent: 'Rent',
  utilities: 'Utilities',
  internet: 'Internet',
  groceries: 'Groceries',
  household: 'Household',
  food: 'Food & takeout',
  transport: 'Transport',
  entertainment: 'Fun',
  other: 'Other',
};

export const METHOD_LABELS = { etransfer: 'e-Transfer', cash: 'Cash', card: 'Card', paypal: 'PayPal', other: 'Other' };

/** Parse a dollar string to cents, or null if invalid. */
export function parseCents(str) {
  if (str === '' || str == null) return null;
  const n = Number(String(str).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}
