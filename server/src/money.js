// All money is integer cents. Splits always sum exactly to the bill total.

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

/** Parse "12.34" / 12.34 into 1234 cents. */
export function toCents(value) {
  const n = typeof value === 'string' ? Number(value.replace(/[$,\s]/g, '')) : Number(value);
  if (!Number.isFinite(n)) throw new ValidationError('Amount must be a number');
  return Math.round(n * 100);
}

/** Equal split; leftover cents go to the first participants (deterministic). */
export function splitEqual(totalCents, userIds) {
  if (!userIds.length) throw new ValidationError('Pick at least one person for this bill');
  const n = userIds.length;
  const base = Math.floor(totalCents / n);
  let remainder = totalCents - base * n;
  return userIds.map((userId) => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return { userId, shareCents: base + extra, percent: null };
  });
}

/** Exact amounts; must add up to the total. */
export function splitExact(totalCents, entries) {
  if (!entries.length) throw new ValidationError('Pick at least one person for this bill');
  const shares = entries.map((e) => ({ userId: e.userId, shareCents: toCents(e.amount), percent: null }));
  if (shares.some((s) => s.shareCents < 0)) throw new ValidationError('Amounts cannot be negative');
  const sum = shares.reduce((a, s) => a + s.shareCents, 0);
  if (sum !== totalCents) {
    throw new ValidationError(
      `Amounts add up to ${fmt(sum)} but the bill is ${fmt(totalCents)} (off by ${fmt(Math.abs(totalCents - sum))})`
    );
  }
  return shares;
}

/** Percentages; must total 100. Uses largest-remainder rounding so cents sum exactly. */
export function splitPercent(totalCents, entries) {
  if (!entries.length) throw new ValidationError('Pick at least one person for this bill');
  const pcts = entries.map((e) => Number(e.percent));
  if (pcts.some((p) => !Number.isFinite(p) || p < 0)) throw new ValidationError('Percentages must be positive numbers');
  const total = pcts.reduce((a, b) => a + b, 0);
  if (Math.abs(total - 100) > 0.001) throw new ValidationError(`Percentages add up to ${round2(total)}%, not 100%`);

  const raw = entries.map((e, i) => {
    const exact = (totalCents * pcts[i]) / 100;
    return { userId: e.userId, percent: pcts[i], floor: Math.floor(exact), frac: exact - Math.floor(exact), i };
  });
  let remainder = totalCents - raw.reduce((a, r) => a + r.floor, 0);
  [...raw]
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
    .forEach((r) => {
      if (remainder > 0) {
        r.floor += 1;
        remainder -= 1;
      }
    });
  return raw.map((r) => ({ userId: r.userId, shareCents: r.floor, percent: r.percent }));
}

export function computeShares(splitType, totalCents, participants) {
  switch (splitType) {
    case 'equal':
      return splitEqual(totalCents, participants.map((p) => p.userId));
    case 'exact':
      return splitExact(totalCents, participants);
    case 'percent':
      return splitPercent(totalCents, participants);
    default:
      throw new ValidationError('Unknown split type');
  }
}

export function fmt(cents, currency = 'CAD') {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format(cents / 100);
}

const round2 = (n) => Math.round(n * 100) / 100;
