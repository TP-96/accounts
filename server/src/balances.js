import { q } from './db.js';

/**
 * Pull every live bill share and payment for a household, as signed "edges":
 * an edge {debtor, creditor, cents} means debtor owes creditor that much more.
 */
async function loadEdges(householdId) {
  const shares = await q.all(
    `SELECT b.id AS bill_id, b.title, b.date, b.created_at, b.paid_by, b.amount_cents, s.user_id, s.share_cents
       FROM bills b JOIN bill_shares s ON s.bill_id = b.id
      WHERE b.household_id = ? AND b.deleted_at IS NULL`,
    householdId
  );
  const payments = await q.all(
    `SELECT id, from_user, to_user, amount_cents, note, date, created_at
       FROM payments WHERE household_id = ? AND deleted_at IS NULL`,
    householdId
  );
  return { shares, payments };
}

/** Matrix owes[a][b] = net cents a owes b (only positive direction kept). */
export async function pairwiseBalances(householdId) {
  const { shares, payments } = await loadEdges(householdId);
  const raw = new Map(); // "a|b" -> cents a owes b (gross, before netting)
  const add = (a, b, c) => raw.set(`${a}|${b}`, (raw.get(`${a}|${b}`) || 0) + c);

  for (const s of shares) {
    if (s.user_id !== s.paid_by) add(s.user_id, s.paid_by, s.share_cents);
  }
  // Paying someone reduces what you owe them (or puts them in your debt).
  for (const p of payments) add(p.to_user, p.from_user, p.amount_cents);

  const net = new Map();
  for (const [key, cents] of raw) {
    const [a, b] = key.split('|').map(Number);
    const reverse = raw.get(`${b}|${a}`) || 0;
    const diff = cents - reverse;
    if (diff > 0) net.set(`${a}|${b}`, diff);
  }
  return net;
}

/** Balance summary from one user's point of view. Positive = they owe me. */
export async function balancesFor(householdId, userId) {
  const members = await q.all('SELECT id, name, color FROM active_members WHERE household_id = ? ORDER BY id', householdId);
  const net = await pairwiseBalances(householdId);
  const people = members
    .filter((m) => m.id !== userId)
    .map((m) => {
      const theyOweMe = net.get(`${m.id}|${userId}`) || 0;
      const iOweThem = net.get(`${userId}|${m.id}`) || 0;
      return { user: m, balanceCents: theyOweMe - iOweThem };
    });
  const owedToMe = people.filter((p) => p.balanceCents > 0).reduce((a, p) => a + p.balanceCents, 0);
  const iOwe = people.filter((p) => p.balanceCents < 0).reduce((a, p) => a - p.balanceCents, 0);
  return { people, owedToMeCents: owedToMe, iOweCents: iOwe, netCents: owedToMe - iOwe };
}

/** Each member's net position in the house. Positive = house owes them. */
export async function householdNets(householdId) {
  const members = await q.all('SELECT id, name, color FROM active_members WHERE household_id = ? ORDER BY id', householdId);
  const net = await pairwiseBalances(householdId);
  const totals = new Map(members.map((m) => [m.id, 0]));
  for (const [key, cents] of net) {
    const [a, b] = key.split('|').map(Number);
    totals.set(a, (totals.get(a) || 0) - cents);
    totals.set(b, (totals.get(b) || 0) + cents);
  }
  return members.map((m) => ({ user: m, netCents: totals.get(m.id) || 0 }));
}

/** Fewest-payments plan: greedily match the biggest debtor with the biggest creditor. */
export async function simplifyDebts(householdId) {
  const nets = await householdNets(householdId);
  const creditors = nets.filter((n) => n.netCents > 0).map((n) => ({ ...n }));
  const debtors = nets.filter((n) => n.netCents < 0).map((n) => ({ ...n, netCents: -n.netCents }));
  const plan = [];
  while (creditors.length && debtors.length) {
    creditors.sort((a, b) => b.netCents - a.netCents);
    debtors.sort((a, b) => b.netCents - a.netCents);
    const c = creditors[0];
    const d = debtors[0];
    const amt = Math.min(c.netCents, d.netCents);
    plan.push({ from: d.user, to: c.user, amountCents: amt });
    c.netCents -= amt;
    d.netCents -= amt;
    if (!c.netCents) creditors.shift();
    if (!d.netCents) debtors.shift();
  }
  return plan;
}

/**
 * Chronological ledger from `userId`'s perspective.
 * Each row's `effectCents` is how it moved the balance in the user's favour
 * (+ = someone now owes you more / you owe less). If counterpartId is given,
 * only rows involving that person are returned and the running balance is
 * the pairwise balance; otherwise it is your overall net with the house.
 */
export async function ledgerFor(householdId, userId, counterpartId = null) {
  const { shares, payments } = await loadEdges(householdId);
  const names = new Map((await q.all('SELECT id, name FROM active_members WHERE household_id = ? UNION SELECT id, name FROM former_members WHERE household_id = ?', householdId, householdId)).map((u) => [u.id, u.name]));
  const rows = [];

  for (const s of shares) {
    if (s.user_id === s.paid_by) continue;
    let effect = 0;
    let other = null;
    if (s.paid_by === userId) {
      effect = s.share_cents;
      other = s.user_id;
    } else if (s.user_id === userId) {
      effect = -s.share_cents;
      other = s.paid_by;
    } else continue;
    if (counterpartId && other !== counterpartId) continue;
    rows.push({
      kind: 'bill',
      refId: s.bill_id,
      date: s.date,
      createdAt: s.created_at,
      title: s.title,
      counterpart: { id: other, name: names.get(other) },
      detail:
        effect > 0 ? `${names.get(other)}'s share of a bill you paid` : `Your share of a bill ${names.get(other)} paid`,
      effectCents: effect,
    });
  }
  for (const p of payments) {
    let effect = 0;
    let other = null;
    if (p.from_user === userId) {
      effect = p.amount_cents;
      other = p.to_user;
    } else if (p.to_user === userId) {
      effect = -p.amount_cents;
      other = p.from_user;
    } else continue;
    if (counterpartId && other !== counterpartId) continue;
    rows.push({
      kind: 'payment',
      refId: p.id,
      date: p.date,
      createdAt: p.created_at,
      title: p.note || 'Payment',
      counterpart: { id: other, name: names.get(other) },
      detail: effect > 0 ? `You paid ${names.get(other)}` : `${names.get(other)} paid you`,
      effectCents: effect,
    });
  }

  rows.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  let running = 0;
  for (const r of rows) {
    running += r.effectCents;
    r.runningCents = running;
  }
  return rows;
}
