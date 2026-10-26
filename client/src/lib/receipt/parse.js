// Turns raw OCR text from a receipt into bill fields.
// Pure JS with no browser APIs, so the same code runs in the app and in the Node CLI.

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

// Known merchants -> category. Matched loosely to survive OCR typos.
const MERCHANTS = [
  ['Costco', 'groceries'], ['Walmart', 'groceries'], ['No Frills', 'groceries'], ['Food Basics', 'groceries'],
  ['Fortinos', 'groceries'], ['Metro', 'groceries'], ['Loblaws', 'groceries'], ['Sobeys', 'groceries'],
  ['FreshCo', 'groceries'], ['Zehrs', 'groceries'], ['Real Canadian Superstore', 'groceries'], ['Giant Tiger', 'groceries'],
  ['T&T Supermarket', 'groceries'], ['Bulk Barn', 'groceries'], ['Farm Boy', 'groceries'], ['Longo\'s', 'groceries'],
  ['Whole Foods', 'groceries'], ['Trader Joe\'s', 'groceries'], ['Kroger', 'groceries'], ['Safeway', 'groceries'], ['Aldi', 'groceries'],
  ['Shoppers Drug Mart', 'household'], ['Dollarama', 'household'], ['Canadian Tire', 'household'], ['Home Depot', 'household'],
  ['IKEA', 'household'], ['Lowe\'s', 'household'], ['Target', 'household'], ['Best Buy', 'household'], ['Amazon', 'household'],
  ['Tim Hortons', 'food'], ['Starbucks', 'food'], ['McDonald\'s', 'food'], ['Pizza Pizza', 'food'], ['Domino\'s', 'food'],
  ['Pizza Hut', 'food'], ['Subway', 'food'], ['Uber Eats', 'food'], ['SkipTheDishes', 'food'], ['DoorDash', 'food'],
  ['A&W', 'food'], ['Wendy\'s', 'food'], ['Chipotle', 'food'], ['Popeyes', 'food'], ['Osmow\'s', 'food'],
  ['Alectra', 'utilities'], ['Hydro One', 'utilities'], ['Toronto Hydro', 'utilities'], ['Enbridge', 'utilities'], ['Hamilton Water', 'utilities'],
  ['Rogers', 'internet'], ['Bell', 'internet'], ['Telus', 'internet'], ['Fido', 'internet'], ['Virgin Plus', 'internet'],
  ['Freedom Mobile', 'internet'], ['TekSavvy', 'internet'], ['Cogeco', 'internet'],
  ['LCBO', 'entertainment'], ['The Beer Store', 'entertainment'], ['Cineplex', 'entertainment'],
  ['Esso', 'transport'], ['Petro-Canada', 'transport'], ['Shell', 'transport'], ['Presto', 'transport'], ['Uber', 'transport'], ['Lyft', 'transport'],
];

const CATEGORY_WORDS = [
  ['utilities', /\b(hydro|electric(ity)?|kwh|water|gas bill|natural gas|utility|meter)\b/i],
  ['internet', /\b(internet|wi-?fi|broadband|mbps|wireless|mobile plan)\b/i],
  ['rent', /\b(rent|lease|landlord|tenancy)\b/i],
  ['groceries', /\b(grocery|groceries|produce|dairy|bakery|deli|meat|frozen|organic|bananas?|milk|eggs|bread)\b/i],
  ['food', /\b(restaurant|dine|dining|server|table|takeout|take-out|pizza|burger|sushi|coffee|latte|delivery fee|gratuity|tip)\b/i],
  ['transport', /\b(fuel|gasoline|unleaded|litres?|parking|transit|fare)\b/i],
  ['household', /\b(detergent|soap|paper towels?|toilet paper|cleaner|bleach|trash bags?|sponges?)\b/i],
];

const RE = {
  total: /\b(grand\s*total|total\s*due|amount\s*due|balance\s*due|total\s*amount|amount\s*payable|total|montant)\b/i,
  strongTotal: /\b(grand\s*total|total\s*due|amount\s*due|balance\s*due|amount\s*payable|total\s*amount)\b/i,
  notTotal: /\b(sub\s*-?\s*total|total\s*(savings?|saved|discounts?|items?|qty|quantity|number|units?|tax|points?)|items?\s*sold|you\s*saved|before\s*tax)\b/i,
  subtotal: /\bsub\s*-?\s*total\b/i,
  tax: /\b(h\.?s\.?t|g\.?s\.?t|p\.?s\.?t|q\.?s\.?t|tax(es)?|vat|tps|tvq)\b/i,
  tip: /\b(tip|gratuity)\b/i,
  payment: /\b(visa|master\s*card|mastercard|amex|american\s*express|debit|interac|credit|card|paid|payment|tend(ered)?|approved|apple\s*pay|google\s*pay)\b/i,
  cash: /\b(cash|tendered|change|chg)\b/i,
  change: /\b(change|chg|change\s*due)\b/i,
  skipItem: /\b(sub\s*-?\s*total|total|tax|h\.?s\.?t|g\.?s\.?t|p\.?s\.?t|balance|amount\s*due|change|cash|visa|master\s*card|mastercard|debit|interac|credit|card|tend|payment|points|savings?|saved|auth|approval|ref(erence)?|tip|gratuity|rounding|account|acct|invoice|order\s*#|tel|phone)\b/i,
};

/** Fix the most common OCR mistakes inside numbers. */
function normalizeLine(line) {
  return line
    .replace(/[|]/g, ' ')
    .replace(/(\d\s?[.,]\s?)([0-9oO]{2})\b/g, (_, a, b) => a + b.replace(/[oO]/g, '0')) // "32.OO" -> "32.00"
    .replace(/(?<=\d)[oO](?=\d)|[oO](?=[.,]\d\d\b)/g, '0')
    .replace(/(?<=\d)[lI](?=\d)/g, '1')
    .replace(/(^|\s)[S§](?=\d+[.,]\d{2}\b)/g, '$1$')
    .replace(/(\d)\s*[.,]\s(\d{2})\b/g, '$1.$2') // "12. 34" -> "12.34"
    .replace(/\s+/g, ' ')
    .trim();
}

/** All money amounts on a line, in cents. Handles $1,234.56, 12,34, trailing minus for discounts. */
export function amountsIn(line) {
  const clean = line.replace(/-?\d+(\.\d+)?\s*%/g, ' '); // drop percentages like "13%" or "13.00 %"
  const out = [];
  const re = /(-)?\$?\s?(\d{1,3}(?:,\d{3})+|\d+)[.,](\d{2})(?!\d)(-)?/g;
  let m;
  while ((m = re.exec(clean))) {
    const whole = Number(m[2].replace(/,/g, ''));
    const cents = whole * 100 + Number(m[3]);
    out.push({ cents: m[1] || m[4] ? -cents : cents, index: m.index });
  }
  return out;
}

const lastAmount = (line) => {
  const a = amountsIn(line);
  return a.length ? a[a.length - 1].cents : null;
};

function lev(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

const letters = (s) => s.toLowerCase().replace(/[^a-z]/g, '');
// Undo look-alike characters OCR swaps in shop names (C0STC0, Walrnart, 5HELL).
const lookalike = (s) =>
  s.toLowerCase().replace(/0/g, 'o').replace(/[1|!]/g, 'l').replace(/5/g, 's').replace(/8/g, 'b').replace(/rn/g, 'm').replace(/vv/g, 'w');

function findKnownMerchant(lines) {
  // Merchants print their name in the header, so only look at the first few lines.
  const header = lines.slice(0, 5);
  const words = header.map((l) => lookalike(l).split(/[^a-z&']+/).filter(Boolean));
  const flat = words.map((w) => w.join('')).join(' ');
  for (const [name, category] of MERCHANTS) {
    const key = letters(lookalike(name));
    if (key.length <= 4) {
      // Short names ("Bell", "Esso", "IKEA") must be a whole word to avoid false hits.
      if (words.some((ws) => ws.some((w) => letters(w) === key))) return { name, category, confidence: 'high' };
      continue;
    }
    if (flat.includes(key)) return { name, category, confidence: 'high' };
    if (key.length < 6) continue;
    // Allow one typo per 6 letters, comparing windows that start at a word boundary.
    const allowed = Math.floor(key.length / 6);
    for (const ws of words) {
      for (let s = 0; s < ws.length; s++) {
        const candidate = letters(ws.slice(s).join(''));
        for (const len of [key.length - 1, key.length, key.length + 1]) {
          if (len > candidate.length) continue;
          if (lev(candidate.slice(0, len), key) <= allowed) return { name, category, confidence: 'medium' };
        }
      }
    }
  }
  return null;
}

function guessMerchant(lines) {
  for (const raw of lines.slice(0, 8)) {
    const l = raw.trim();
    const letterCount = (l.match(/[a-z]/gi) || []).length;
    if (letterCount < 3) continue;
    if (letterCount / l.length < 0.5) continue;
    if (/(www\.|https?:|\.com|\.ca\b|@)/i.test(l)) continue;
    if (/\b(tel|phone|fax|ph)\b|\(\d{3}\)|\d{3}[-.\s]\d{3}[-.\s]\d{4}/i.test(l)) continue;
    if (/^\d+\s+\w+.*\b(st|street|ave|avenue|rd|road|blvd|dr|drive|way|hwy|cres|crt|lane|ln|unit|suite)\b/i.test(l)) continue;
    if (/\b(welcome|receipt|invoice|store\s*#|cashier|register|transaction|order|thank|date|time|table|server|guest)\b/i.test(l)) continue;
    if (/\b(on|bc|ab|qc|ns|nb|mb|sk)\s+[a-z]\d[a-z]\s?\d[a-z]\d\b/i.test(l)) continue; // postal code line
    const name = l.replace(/^[^a-z0-9]+|[^a-z0-9)'.!&]+$/gi, '').replace(/\s{2,}/g, ' ');
    if (name.length < 3) continue;
    return { name: titleCase(name), category: null, confidence: 'low' };
  }
  return null;
}

function titleCase(s) {
  if (s !== s.toUpperCase()) return s; // already mixed case: keep as printed
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .replace(/'S\b/g, "'s")
    .replace(/(\d)(l|ml|kg|lb|g|oz)\b/gi, (_, n, u) => n + (u.toLowerCase() === 'l' ? 'L' : u.toLowerCase()));
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function validDate(y, m, d) {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Find the most plausible purchase date: not in the future, within ~2 years, closest to today. */
export function findDate(lines, today = new Date()) {
  const todayIso = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const minIso = `${today.getFullYear() - 2}-01-01`;
  const cands = [];
  const add = (iso, weight) => iso && iso <= todayIso && iso >= minIso && cands.push({ iso, weight });
  const text = lines.join('\n');
  let m;

  const isoRe = /\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/g;
  while ((m = isoRe.exec(text))) add(validDate(+m[1], +m[2], +m[3]), 3);

  const numRe = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/g;
  while ((m = numRe.exec(text))) {
    const a = +m[1], b = +m[2], y = +m[3];
    add(validDate(y, a, b), a > 12 ? 0 : 2); // MM/DD
    add(validDate(y, b, a), b > 12 ? 0 : 2); // DD/MM
  }

  const mon = '(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\\.?';
  const mdyRe = new RegExp(`\\b${mon}\\s*(\\d{1,2})(?:st|nd|rd|th)?,?\\s*(\\d{4}|\\d{2})\\b`, 'gi');
  while ((m = mdyRe.exec(text))) add(validDate(+m[3], MONTHS[m[1].toLowerCase()], +m[2]), 3);
  const dmyRe = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?[\\s-]*${mon}[\\s,-]*(\\d{4}|\\d{2})\\b`, 'gi');
  while ((m = dmyRe.exec(text))) add(validDate(+m[3], MONTHS[m[2].toLowerCase()], +m[1]), 3);

  if (!cands.length) return null;
  const dist = (iso) => Math.abs(Date.parse(todayIso) - Date.parse(iso));
  cands.sort((x, y) => y.weight - x.weight || dist(x.iso) - dist(y.iso));
  return cands[0].iso;
}

function cleanItemName(text) {
  return text
    .replace(/^\s*[A-Z*]\s+(?=\d{4,})/, '') // leading tax flag before a SKU ("E 1234567 ...")
    .replace(/^\s*\d{4,}\s*/, '') // leading SKU / UPC
    .replace(/\b\d{6,}\b/g, '')
    .replace(/\s+[A-Z]{1,2}\s*$/, '') // trailing tax flags like "H", "HC", "E"
    .replace(/^\W+|\W+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Parse OCR text into bill fields.
 * @returns {{
 *   merchant: string|null, category: string|null, date: string|null,
 *   totalCents: number|null, subtotalCents: number|null, taxCents: number|null, tipCents: number|null,
 *   items: {name: string, cents: number}[], confidence: {merchant: string, total: string, date: string},
 *   title: string|null, description: string
 * }}
 */
export function parseReceipt(text, { today = new Date() } = {}) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map(normalizeLine)
    .filter((l) => l.length > 0);

  // Subtotal / tax / tip
  let subtotalCents = null;
  let tipCents = null;
  const taxLines = [];
  for (const l of lines) {
    const amt = lastAmount(l);
    if (amt == null) continue;
    if (RE.subtotal.test(l)) subtotalCents ??= amt;
    else if (RE.tip.test(l) && !RE.total.test(l)) tipCents ??= amt;
    else if (RE.tax.test(l) && !RE.payment.test(l)) taxLines.push({ l, amt });
  }
  const totalTax = taxLines.find((t) => /total/i.test(t.l));
  const taxCents = totalTax ? totalTax.amt : taxLines.length ? taxLines.reduce((s, t) => s + t.amt, 0) : null;

  // Total: score candidate lines, then cross-check against subtotal + tax and the card payment line.
  const cands = [];
  lines.forEach((l, i) => {
    const amt = lastAmount(l);
    if (amt == null || amt <= 0) return;
    if (RE.change.test(l)) return;
    if (RE.total.test(l) && !RE.notTotal.test(l) && !(RE.tax.test(l) && !RE.strongTotal.test(l))) {
      cands.push({ amt, score: RE.strongTotal.test(l) ? 4 : 3, i });
    } else if (RE.payment.test(l) && !RE.cash.test(l) && !RE.tax.test(l)) {
      cands.push({ amt, score: 1, i });
    }
  });
  const expected = subtotalCents != null ? subtotalCents + (taxCents || 0) + (tipCents || 0) : null;
  for (const c of cands) {
    if (expected != null && Math.abs(c.amt - expected) <= 2) c.score += 2;
    if (cands.some((o) => o !== c && o.amt === c.amt)) c.score += 1; // total echoed by the payment line
  }
  cands.sort((a, b) => b.score - a.score || b.i - a.i);

  let totalCents = null;
  let totalConf = 'low';
  if (cands.length) {
    totalCents = cands[0].amt;
    totalConf = cands[0].score >= 5 ? 'high' : cands[0].score >= 3 ? 'medium' : 'low';
  } else if (expected != null) {
    totalCents = expected;
    totalConf = 'medium';
  } else {
    // Last resort: the largest amount that isn't cash handed over or change.
    const all = lines.filter((l) => !RE.cash.test(l)).flatMap((l) => amountsIn(l).map((a) => a.cents));
    if (all.length) totalCents = Math.max(...all);
  }

  // Line items
  const items = [];
  for (const l of lines) {
    if (RE.skipItem.test(l)) continue;
    const a = amountsIn(l);
    if (!a.length) continue;
    const last = a[a.length - 1];
    const name = cleanItemName(l.slice(0, last.index));
    if ((name.match(/[a-z]/gi) || []).length < 2) continue;
    if (findDate([l], today) && name.length < 6) continue;
    if (totalCents != null && Math.abs(last.cents) > totalCents) continue;
    items.push({ name: titleCase(name).slice(0, 60), cents: last.cents });
    if (items.length >= 40) break;
  }

  const known = findKnownMerchant(lines);
  const merchant = known || guessMerchant(lines);
  const date = findDate(lines, today);

  let category = merchant?.category || null;
  if (!category) {
    const body = lines.join(' ');
    category = CATEGORY_WORDS.find(([, re]) => re.test(body))?.[0] || null;
  }

  const fmt = (c) => `$${(Math.abs(c) / 100).toFixed(2)}`;
  const descLines = [];
  if (items.length) {
    descLines.push(...items.slice(0, 25).map((it) => `${it.name}: ${it.cents < 0 ? '−' : ''}${fmt(it.cents)}`));
    if (items.length > 25) descLines.push(`+ ${items.length - 25} more items`);
  }
  const extras = [
    subtotalCents != null && `Subtotal ${fmt(subtotalCents)}`,
    taxCents != null && `Tax ${fmt(taxCents)}`,
    tipCents != null && `Tip ${fmt(tipCents)}`,
  ].filter(Boolean);
  if (extras.length) descLines.push(extras.join(', '));

  return {
    merchant: merchant?.name || null,
    category,
    date,
    totalCents,
    subtotalCents,
    taxCents,
    tipCents,
    items,
    confidence: { merchant: merchant?.confidence || 'none', total: totalCents == null ? 'none' : totalConf, date: date ? 'medium' : 'none' },
    title: merchant?.name || null,
    description: descLines.join('\n').slice(0, 1000),
  };
}
