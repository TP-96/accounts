import { q, tx } from './db.js';
import { computeShares, toCents, fmt, ValidationError } from './money.js';
import { notify, logActivity } from './notify.js';

export const CATEGORIES = ['rent', 'utilities', 'internet', 'groceries', 'household', 'food', 'transport', 'entertainment', 'other'];
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/** Validate raw input and return a normalized bill (cents + shares). */
export async function normalizeBill(householdId, input) {
  const title = String(input.title || '').trim();
  if (!title) throw new ValidationError('Give the bill a name');
  if (title.length > 120) throw new ValidationError('Name is too long');
  const description = String(input.description || '').trim().slice(0, 1000);
  const category = CATEGORIES.includes(input.category) ? input.category : 'other';
  const amountCents = input.amountCents != null ? Number(input.amountCents) : toCents(input.amount);
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new ValidationError('Amount must be more than $0');
  if (amountCents > 100_000_000) throw new ValidationError('Amount is unrealistically large');
  const date = input.date || new Date().toISOString().slice(0, 10);
  if (!isDate(date)) throw new ValidationError('Invalid date');

  const memberIds = new Set((await q.all('SELECT id FROM users WHERE household_id = ?', householdId)).map((u) => u.id));
  const paidBy = Number(input.paidBy);
  if (!memberIds.has(paidBy)) throw new ValidationError('Whoever paid must be in the household');

  const participants = (input.participants || []).map((p) => ({ ...p, userId: Number(p.userId) }));
  if (new Set(participants.map((p) => p.userId)).size !== participants.length) throw new ValidationError('Someone is listed twice');
  for (const p of participants) if (!memberIds.has(p.userId)) throw new ValidationError('Everyone on the bill must be in the household');

  const splitType = input.splitType || 'equal';
  const shares = computeShares(splitType, amountCents, participants);
  return { title, description, category, amountCents, paidBy, splitType, date, shares };
}

async function insertShares(t, billId, shares) {
  for (const s of shares) {
    await t.run('INSERT INTO bill_shares (bill_id, user_id, share_cents, percent, units) VALUES (?, ?, ?, ?, ?)', billId, s.userId, s.shareCents, s.percent ?? null, s.units ?? null);
  }
}

export async function createBill(householdId, actorId, bill, { recurringId = null, silent = false } = {}) {
  const id = await tx(async (t) => {
    const r = await t.get(
      `INSERT INTO bills (household_id, title, description, category, amount_cents, paid_by, split_type, date, recurring_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      householdId, bill.title, bill.description, bill.category, bill.amountCents, bill.paidBy, bill.splitType, bill.date, recurringId, actorId
    );
    await insertShares(t, r.id, bill.shares);
    return r.id;
  });

  const actor = await q.get('SELECT name FROM users WHERE id = ?', actorId);
  const payer = await q.get('SELECT name FROM users WHERE id = ?', bill.paidBy);
  await logActivity(householdId, actorId, 'bill.created', `${actor.name} added "${bill.title}" (${fmt(bill.amountCents)})`);

  if (!silent) {
    for (const s of bill.shares) {
      if (s.userId === bill.paidBy || s.shareCents === 0) continue;
      await notify([s.userId], {
        type: 'bill',
        title: `You owe ${payer.name} ${fmt(s.shareCents)} for ${bill.title}`,
        body: `${actor.name} added "${bill.title}" — ${fmt(bill.amountCents)} total, paid by ${payer.name}.${bill.description ? ` Note: ${bill.description}` : ''}`,
        link: `/bills/${id}`,
      });
    }
  }
  return id;
}

export async function updateBill(householdId, actorId, billId, bill) {
  await tx(async (t) => {
    await t.run(
      `UPDATE bills SET title=?, description=?, category=?, amount_cents=?, paid_by=?, split_type=?, date=?, updated_at=now_iso()
        WHERE id=? AND household_id=?`,
      bill.title, bill.description, bill.category, bill.amountCents, bill.paidBy, bill.splitType, bill.date, billId, householdId
    );
    await t.run('DELETE FROM bill_shares WHERE bill_id = ?', billId);
    await insertShares(t, billId, bill.shares);
  });
  const actor = await q.get('SELECT name FROM users WHERE id = ?', actorId);
  await logActivity(householdId, actorId, 'bill.updated', `${actor.name} edited "${bill.title}"`);
  const affected = bill.shares.map((s) => s.userId).filter((id) => id !== actorId);
  await notify(affected, { type: 'bill', title: `${actor.name} edited "${bill.title}"`, body: 'Your balance may have changed.', link: `/bills/${billId}` });
}

export async function getBill(householdId, billId) {
  if (!Number.isInteger(billId)) return null;
  const bill = await q.get('SELECT * FROM bills WHERE id = ? AND household_id = ? AND deleted_at IS NULL', billId, householdId);
  if (!bill) return null;
  const shares = await q.all(
    `SELECT s.user_id, s.share_cents, s.percent, s.units, u.name, u.color FROM bill_shares s JOIN users u ON u.id = s.user_id
      WHERE s.bill_id = ? ORDER BY u.id`,
    billId
  );
  // Which shares have been settled via "pay my share" payments linked to this bill.
  const linked = await q.all(
    'SELECT from_user, SUM(amount_cents)::int AS paid FROM payments WHERE bill_id = ? AND deleted_at IS NULL GROUP BY from_user',
    billId
  );
  const paidMap = new Map(linked.map((l) => [l.from_user, l.paid]));
  return serializeBill(bill, shares.map((s) => ({
    userId: s.user_id,
    name: s.name,
    color: s.color,
    shareCents: s.share_cents,
    percent: s.percent,
    units: s.units,
    paidCents: s.user_id === bill.paid_by ? s.share_cents : paidMap.get(s.user_id) || 0,
  })));
}

export function serializeBill(b, shares) {
  return {
    id: b.id,
    title: b.title,
    description: b.description,
    category: b.category,
    amountCents: b.amount_cents,
    paidBy: b.paid_by,
    splitType: b.split_type,
    date: b.date,
    recurringId: b.recurring_id,
    createdBy: b.created_by,
    createdAt: b.created_at,
    updatedAt: b.updated_at,
    shares,
  };
}
