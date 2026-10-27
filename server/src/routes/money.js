import { Router } from 'express';
import { q, tx } from '../db.js';
import { requireHousehold } from '../auth.js';
import { normalizeBill, createBill, updateBill, getBill, serializeBill, CATEGORIES } from '../bills.js';
import { toCents, fmt, ValidationError } from '../money.js';
import { notify, logActivity } from '../notify.js';
import { balancesFor, householdNets, simplifyDebts, ledgerFor } from '../balances.js';
import { advanceDate, runRecurringThrottled } from '../recurring.js';

const r = Router();
r.use(requireHousehold);

const hid = (req) => req.user.household_id;
const isMember = async (householdId, userId) =>
  Number.isInteger(userId) && !!(await q.get('SELECT 1 AS ok FROM active_members WHERE id = ? AND household_id = ?', userId, householdId));
const nameOf = async (id) => (await q.get('SELECT name FROM users WHERE id = ?', id))?.name || 'Someone';
const todayIso = () => new Date().toISOString().slice(0, 10);

/* ---------------- Bills ---------------- */

r.get('/bills', async (req, res) => {
  const search = String(req.query.search || '');
  const category = String(req.query.category || '');
  const mine = !!req.query.mine;
  const like = `%${search.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const rows = await q.all(
    `SELECT * FROM bills WHERE household_id = ? AND deleted_at IS NULL
       AND (?::text = '' OR title ILIKE ? OR description ILIKE ?)
       AND (?::text = '' OR category = ?)
     ORDER BY date DESC, id DESC LIMIT 500`,
    hid(req), search, like, like, category, category
  );
  const shares = rows.length
    ? await q.all('SELECT * FROM bill_shares WHERE bill_id = ANY(?::int[])', rows.map((b) => b.id))
    : [];
  const byBill = new Map();
  for (const s of shares) {
    if (!byBill.has(s.bill_id)) byBill.set(s.bill_id, []);
    byBill.get(s.bill_id).push({ userId: s.user_id, shareCents: s.share_cents, percent: s.percent, units: s.units });
  }
  for (const list of byBill.values()) list.sort((a, b) => a.userId - b.userId);
  let bills = rows.map((b) => serializeBill(b, byBill.get(b.id) || []));
  if (mine) bills = bills.filter((b) => b.paidBy === req.user.id || b.shares.some((s) => s.userId === req.user.id));
  res.json({ bills, categories: CATEGORIES });
});

r.get('/bills/:id', async (req, res) => {
  const bill = await getBill(hid(req), Number(req.params.id));
  if (!bill) return res.status(404).json({ error: 'Bill not found' });
  res.json({ bill });
});

r.post('/bills', async (req, res) => {
  const bill = await normalizeBill(hid(req), req.body);
  const id = await createBill(hid(req), req.user.id, bill);

  if (['weekly', 'monthly'].includes(req.body.repeat)) {
    const template = { ...req.body, date: undefined, repeat: undefined, amountCents: bill.amountCents };
    const rec = await q.get(
      'INSERT INTO recurring_bills (household_id, template, frequency, next_date, created_by) VALUES (?, ?, ?, ?, ?) RETURNING id',
      hid(req), JSON.stringify(template), req.body.repeat, advanceDate(bill.date, req.body.repeat), req.user.id
    );
    await q.run('UPDATE bills SET recurring_id = ? WHERE id = ?', rec.id, id);
  }
  res.status(201).json({ bill: await getBill(hid(req), id) });
});

/** Only the person who added a bill may edit, delete or restore it. Sends a 403 and returns true otherwise. */
export async function notCreator(req, res, createdBy, verb) {
  if (createdBy === req.user.id) return false;
  const who = await q.get('SELECT name FROM users WHERE id = ?', createdBy);
  res.status(403).json({ error: `Only ${who?.name || 'the person who added this bill'} can ${verb} it, because they added it. Leave a comment on the bill to ask for a change.` });
  return true;
}

r.put('/bills/:id', async (req, res) => {
  const id = Number(req.params.id);
  const bill = await getBill(hid(req), id);
  if (!bill) return res.status(404).json({ error: 'Bill not found' });
  if (await notCreator(req, res, bill.createdBy, 'edit')) return;
  await updateBill(hid(req), req.user.id, id, await normalizeBill(hid(req), req.body));
  res.json({ bill: await getBill(hid(req), id) });
});

r.delete('/bills/:id', async (req, res) => {
  const bill = await getBill(hid(req), Number(req.params.id));
  if (!bill) return res.status(404).json({ error: 'Bill not found' });
  if (await notCreator(req, res, bill.createdBy, 'delete')) return;
  await tx(async (t) => {
    await t.run('UPDATE bills SET deleted_at = now_iso() WHERE id = ?', bill.id);
    // Payments made specifically for this bill stay as plain payments, so money already sent isn't lost.
    await t.run('UPDATE payments SET bill_id = NULL WHERE bill_id = ?', bill.id);
  });
  await logActivity(hid(req), req.user.id, 'bill.deleted', `${req.user.name} deleted "${bill.title}" (${fmt(bill.amountCents)})`);
  await notify(bill.shares.map((s) => s.userId).filter((u) => u !== req.user.id), {
    type: 'bill',
    title: `${req.user.name} deleted "${bill.title}"`,
    body: `The ${fmt(bill.amountCents)} bill no longer counts toward balances.`,
    link: '/bills',
    householdId: hid(req),
  });
  res.json({ ok: true });
});

/** "I paid my share" — records a payment to the bill's payer for whatever is still outstanding. */
r.post('/bills/:id/pay-share', async (req, res) => {
  const bill = await getBill(hid(req), Number(req.params.id));
  if (!bill) return res.status(404).json({ error: 'Bill not found' });
  const userId = req.body.userId ? Number(req.body.userId) : req.user.id;
  const share = bill.shares.find((s) => s.userId === userId);
  if (!share) throw new ValidationError('That person is not on this bill');
  if (userId === bill.paidBy) throw new ValidationError('The payer already covered their own share');
  const outstanding = share.shareCents - share.paidCents;
  if (outstanding <= 0) throw new ValidationError('This share is already paid');
  const payment = await recordPayment(req, {
    fromUser: userId,
    toUser: bill.paidBy,
    amountCents: outstanding,
    note: `Share of ${bill.title}`,
    method: req.body.method,
    billId: bill.id,
    date: todayIso(),
  });
  res.status(201).json({ payment, bill: await getBill(hid(req), bill.id) });
});

/* ---------------- Recurring ---------------- */

r.get('/recurring', async (req, res) => {
  const rows = await q.all('SELECT * FROM recurring_bills WHERE household_id = ? AND active = 1 ORDER BY next_date', hid(req));
  res.json({ recurring: rows.map((x) => ({ id: x.id, frequency: x.frequency, nextDate: x.next_date, template: JSON.parse(x.template) })) });
});

r.delete('/recurring/:id', async (req, res) => {
  await q.run('UPDATE recurring_bills SET active = 0 WHERE id = ? AND household_id = ?', Number(req.params.id), hid(req));
  res.json({ ok: true });
});

/* ---------------- Payments ---------------- */

const METHODS = ['etransfer', 'cash', 'card', 'paypal', 'other'];

async function recordPayment(req, p) {
  const h = hid(req);
  if (!(await isMember(h, p.fromUser)) || !(await isMember(h, p.toUser))) throw new ValidationError('Both people must be in the household');
  if (p.fromUser === p.toUser) throw new ValidationError('Pick two different people');
  if (!Number.isInteger(p.amountCents) || p.amountCents <= 0) throw new ValidationError('Amount must be more than $0');
  if (p.amountCents > 100_000_000) throw new ValidationError('Amount is unrealistically large');
  const method = METHODS.includes(p.method) ? p.method : 'other';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(p.date || '') ? p.date : todayIso();
  const row = await q.get(
    `INSERT INTO payments (household_id, from_user, to_user, amount_cents, note, method, bill_id, date, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    h, p.fromUser, p.toUser, p.amountCents, String(p.note || '').slice(0, 200), method, p.billId || null, date, req.user.id
  );
  const from = await nameOf(p.fromUser);
  const to = await nameOf(p.toUser);
  await logActivity(h, req.user.id, 'payment.created', `${from} paid ${to} ${fmt(p.amountCents)}${p.note ? ` — ${p.note}` : ''}`);
  await notify([p.fromUser, p.toUser].filter((u) => u !== req.user.id), {
    type: 'payment',
    title: `${from} paid ${to} ${fmt(p.amountCents)}`,
    body: `${p.note ? `${p.note}. ` : ''}Recorded by ${req.user.name}. Balances have been updated.`,
    link: '/ledger',
    householdId: hid(req),
  });
  return { id: row.id };
}

r.get('/payments', async (req, res) => {
  const rows = await q.all(
    'SELECT * FROM payments WHERE household_id = ? AND deleted_at IS NULL ORDER BY date DESC, id DESC LIMIT 500',
    hid(req)
  );
  res.json({
    payments: rows.map((p) => ({
      id: p.id, fromUser: p.from_user, toUser: p.to_user, amountCents: p.amount_cents, note: p.note,
      method: p.method, billId: p.bill_id, date: p.date, createdBy: p.created_by, createdAt: p.created_at,
    })),
  });
});

r.post('/payments', async (req, res) => {
  const payment = await recordPayment(req, {
    fromUser: Number(req.body.fromUser || req.user.id),
    toUser: Number(req.body.toUser),
    amountCents: req.body.amountCents != null ? Number(req.body.amountCents) : toCents(req.body.amount),
    note: req.body.note,
    method: req.body.method,
    date: req.body.date,
  });
  res.status(201).json({ payment });
});

r.delete('/payments/:id', async (req, res) => {
  const id = Number(req.params.id);
  const p = Number.isInteger(id) && (await q.get('SELECT * FROM payments WHERE id = ? AND household_id = ? AND deleted_at IS NULL', id, hid(req)));
  if (!p) return res.status(404).json({ error: 'Payment not found' });
  await q.run('UPDATE payments SET deleted_at = now_iso() WHERE id = ?', p.id);
  const from = await nameOf(p.from_user);
  const to = await nameOf(p.to_user);
  await logActivity(hid(req), req.user.id, 'payment.deleted', `${req.user.name} removed a ${fmt(p.amount_cents)} payment from ${from} to ${to}`);
  await notify([p.from_user, p.to_user].filter((u) => u !== req.user.id), {
    type: 'payment',
    title: `A ${fmt(p.amount_cents)} payment was removed`,
    body: `${req.user.name} removed the payment from ${from} to ${to}. Balances were recalculated.`,
    link: '/ledger',
    householdId: hid(req),
  });
  res.json({ ok: true });
});

/* ---------------- Balances, ledger, nudges ---------------- */

r.get('/balances', async (req, res) => {
  await runRecurringThrottled(); // makes sure due repeating bills exist even between cron runs
  res.json({
    me: await balancesFor(hid(req), req.user.id),
    house: await householdNets(hid(req)),
    simplified: await simplifyDebts(hid(req)),
  });
});

r.get('/ledger', async (req, res) => {
  const perspective = req.query.as ? Number(req.query.as) : req.user.id;
  if (!(await isMember(hid(req), perspective))) return res.status(404).json({ error: 'Not a household member' });
  const withId = req.query.with ? Number(req.query.with) : null;
  res.json({ rows: await ledgerFor(hid(req), perspective, withId) });
});

r.post('/nudge', async (req, res) => {
  const target = Number(req.body.userId);
  if (!(await isMember(hid(req), target)) || target === req.user.id) throw new ValidationError('Pick a roommate');
  const bal = (await balancesFor(hid(req), req.user.id)).people.find((p) => p.user.id === target);
  if (!bal || bal.balanceCents <= 0) throw new ValidationError("They don't owe you anything right now");
  await notify([target], {
    type: 'reminder',
    title: `Reminder: you owe ${req.user.name} ${fmt(bal.balanceCents)}`,
    body: `${req.user.name} sent a friendly nudge. Record the payment in Hearth once you've paid.`,
    link: '/settle',
    householdId: hid(req),
  });
  res.json({ ok: true });
});

r.get('/activity', async (req, res) => {
  const rows = await q.all(
    `SELECT a.*, u.name, u.color FROM activity a JOIN users u ON u.id = a.user_id
      WHERE a.household_id = ? ORDER BY a.id DESC LIMIT 50`,
    hid(req)
  );
  res.json({ activity: rows.map((a) => ({ id: a.id, action: a.action, summary: a.summary, createdAt: a.created_at, user: { id: a.user_id, name: a.name, color: a.color } })) });
});

export default r;
