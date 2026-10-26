// Spending stats, comments on bills, and restoring deleted bills.
import { Router } from 'express';
import { q } from '../db.js';
import { requireHousehold } from '../auth.js';
import { fmt, ValidationError } from '../money.js';
import { notify, logActivity } from '../notify.js';

const r = Router();
const hid = (req) => req.user.household_id;

/* ---------------- Stats ---------------- */

const ymOf = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

/** Every month from `startYm` to this month, inclusive (capped at 60). */
function monthsFrom(startYm) {
  const out = [];
  const now = new Date();
  const end = ymOf(now);
  let [y, m] = startYm.split('-').map(Number);
  while (out.length < 60) {
    const ym = `${y}-${String(m).padStart(2, '0')}`;
    out.push(ym);
    if (ym >= end) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out.slice(-60);
}

r.get('/stats', requireHousehold, async (req, res) => {
  const h = hid(req);
  const me = req.user.id;
  const range = ['3', '6', '12', 'all'].includes(String(req.query.range)) ? String(req.query.range) : '6';

  let startYm;
  if (range === 'all') {
    const first = await q.get('SELECT MIN(date) AS d FROM bills WHERE household_id = ? AND deleted_at IS NULL', h);
    startYm = first?.d ? first.d.slice(0, 7) : ymOf(new Date());
  } else {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - (Number(range) - 1));
    startYm = ymOf(d);
  }
  const since = `${startYm}-01`;
  const months = monthsFrom(startYm);

  const monthlyRows = await q.all(
    `SELECT substr(b.date, 1, 7) AS ym,
            SUM(b.amount_cents)::int AS total,
            SUM(CASE WHEN b.paid_by = ? THEN b.amount_cents ELSE 0 END)::int AS i_paid,
            SUM(COALESCE(s.share_cents, 0))::int AS my_share
       FROM bills b
       LEFT JOIN bill_shares s ON s.bill_id = b.id AND s.user_id = ?
      WHERE b.household_id = ? AND b.deleted_at IS NULL AND b.date >= ?
      GROUP BY ym`,
    me, me, h, since
  );
  const byYm = new Map(monthlyRows.map((x) => [x.ym, x]));
  const monthly = months.map((ym) => ({
    month: ym,
    houseCents: byYm.get(ym)?.total || 0,
    myShareCents: byYm.get(ym)?.my_share || 0,
    iPaidCents: byYm.get(ym)?.i_paid || 0,
  }));

  const byCategory = await q.all(
    `SELECT b.category, COUNT(*)::int AS bills, SUM(b.amount_cents)::int AS total, SUM(COALESCE(s.share_cents, 0))::int AS mine
       FROM bills b
       LEFT JOIN bill_shares s ON s.bill_id = b.id AND s.user_id = ?
      WHERE b.household_id = ? AND b.deleted_at IS NULL AND b.date >= ?
      GROUP BY b.category ORDER BY total DESC`,
    me, h, since
  );

  const paid = await q.all(
    `SELECT paid_by AS id, SUM(amount_cents)::int AS cents FROM bills
      WHERE household_id = ? AND deleted_at IS NULL AND date >= ? GROUP BY paid_by`,
    h, since
  );
  const used = await q.all(
    `SELECT s.user_id AS id, SUM(s.share_cents)::int AS cents FROM bill_shares s JOIN bills b ON b.id = s.bill_id
      WHERE b.household_id = ? AND b.deleted_at IS NULL AND b.date >= ? GROUP BY s.user_id`,
    h, since
  );
  const people = await q.all(
    'SELECT id, name, color, household_id FROM users WHERE household_id = ? OR former_household_id = ? ORDER BY id',
    h, h
  );
  const paidMap = new Map(paid.map((x) => [x.id, x.cents]));
  const usedMap = new Map(used.map((x) => [x.id, x.cents]));
  const byPerson = people
    .map((u) => ({
      user: { id: u.id, name: u.name, color: u.color },
      current: u.household_id === h,
      paidCents: paidMap.get(u.id) || 0,
      shareCents: usedMap.get(u.id) || 0,
    }))
    .filter((p) => p.current || p.paidCents || p.shareCents);

  const biggest = await q.all(
    `SELECT id, title, category, amount_cents, date, paid_by FROM bills
      WHERE household_id = ? AND deleted_at IS NULL AND date >= ?
      ORDER BY amount_cents DESC, date DESC LIMIT 5`,
    h, since
  );

  // What repeating bills add up to each month (weekly bills counted as 52/12 per month).
  const recurring = await q.all('SELECT template, frequency FROM recurring_bills WHERE household_id = ? AND active = 1', h);
  let recurringMonthlyCents = 0;
  let recurringMyMonthlyCents = 0;
  for (const rb of recurring) {
    const t = JSON.parse(rb.template);
    const factor = rb.frequency === 'weekly' ? 52 / 12 : 1;
    recurringMonthlyCents += Math.round((t.amountCents || 0) * factor);
    const n = (t.participants || []).length || 1;
    if ((t.participants || []).some((p) => Number(p.userId) === me)) {
      // Approximation for the summary line: equal split unless amounts/percent/shares say otherwise.
      const mine = (t.participants || []).find((p) => Number(p.userId) === me);
      let cents = (t.amountCents || 0) / n;
      if (t.splitType === 'exact' && mine.amount != null) cents = Math.round(Number(mine.amount) * 100);
      if (t.splitType === 'percent' && mine.percent != null) cents = ((t.amountCents || 0) * Number(mine.percent)) / 100;
      if (t.splitType === 'shares') {
        const total = (t.participants || []).reduce((a, p) => a + (Number(p.shares) || 0), 0) || 1;
        cents = ((t.amountCents || 0) * (Number(mine.shares) || 0)) / total;
      }
      recurringMyMonthlyCents += Math.round(cents * factor);
    }
  }

  const houseTotal = monthly.reduce((a, m) => a + m.houseCents, 0);
  const myTotal = monthly.reduce((a, m) => a + m.myShareCents, 0);
  const cur = monthly.at(-1);
  const prev = monthly.at(-2);
  res.json({
    range,
    months: monthly,
    summary: {
      houseCents: houseTotal,
      myShareCents: myTotal,
      monthCount: monthly.length,
      avgHouseCents: Math.round(houseTotal / Math.max(1, monthly.length)),
      avgMyShareCents: Math.round(myTotal / Math.max(1, monthly.length)),
      thisMonthMyShareCents: cur?.myShareCents || 0,
      lastMonthMyShareCents: prev?.myShareCents || 0,
      recurringMonthlyCents,
      recurringMyMonthlyCents,
    },
    byCategory: byCategory.map((c) => ({ category: c.category, bills: c.bills, totalCents: c.total, myShareCents: c.mine })),
    byPerson,
    biggest: biggest.map((b) => ({ id: b.id, title: b.title, category: b.category, amountCents: b.amount_cents, date: b.date, paidBy: b.paid_by })),
  });
});

/* ---------------- Comments ---------------- */

async function billInHouse(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return null;
  return q.get('SELECT * FROM bills WHERE id = ? AND household_id = ? AND deleted_at IS NULL', id, hid(req));
}

r.get('/bills/:id/comments', requireHousehold, async (req, res) => {
  const bill = await billInHouse(req);
  if (!bill) return res.status(404).json({ error: 'Bill not found' });
  const rows = await q.all(
    `SELECT c.id, c.body, c.created_at, c.user_id, u.name, u.color FROM bill_comments c JOIN users u ON u.id = c.user_id
      WHERE c.bill_id = ? ORDER BY c.id`,
    bill.id
  );
  res.json({ comments: rows.map((c) => ({ id: c.id, body: c.body, createdAt: c.created_at, user: { id: c.user_id, name: c.name, color: c.color } })) });
});

r.post('/bills/:id/comments', requireHousehold, async (req, res) => {
  const bill = await billInHouse(req);
  if (!bill) return res.status(404).json({ error: 'Bill not found' });
  const body = String(req.body.body || '').trim();
  if (!body) throw new ValidationError('Write something first');
  if (body.length > 1000) throw new ValidationError('Keep comments under 1,000 characters');
  const row = await q.get('INSERT INTO bill_comments (bill_id, user_id, body) VALUES (?, ?, ?) RETURNING id', bill.id, req.user.id, body);
  const involved = (await q.all('SELECT user_id FROM bill_shares WHERE bill_id = ?', bill.id)).map((x) => x.user_id);
  const commenters = (await q.all('SELECT DISTINCT user_id FROM bill_comments WHERE bill_id = ?', bill.id)).map((x) => x.user_id);
  await notify([...involved, bill.paid_by, ...commenters].filter((u) => u !== req.user.id), {
    type: 'comment',
    title: `${req.user.name} commented on "${bill.title}"`,
    body: body.length > 140 ? `${body.slice(0, 140)}…` : body,
    link: `/bills/${bill.id}`,
  });
  res.status(201).json({ id: row.id });
});

r.delete('/comments/:id', requireHousehold, async (req, res) => {
  const c = await q.get(
    `SELECT c.* FROM bill_comments c JOIN bills b ON b.id = c.bill_id WHERE c.id = ? AND b.household_id = ?`,
    Number(req.params.id) || 0, hid(req)
  );
  if (!c) return res.status(404).json({ error: 'Comment not found' });
  if (c.user_id !== req.user.id) return res.status(403).json({ error: 'You can only delete your own comments' });
  await q.run('DELETE FROM bill_comments WHERE id = ?', c.id);
  res.json({ ok: true });
});

/* ---------------- Recently deleted bills ---------------- */

r.get('/bills-deleted', requireHousehold, async (req, res) => {
  const rows = await q.all(
    `SELECT id, title, amount_cents, date, paid_by, deleted_at FROM bills
      WHERE household_id = ? AND deleted_at IS NOT NULL AND deleted_at >= to_char((now() - interval '90 days') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ORDER BY deleted_at DESC LIMIT 50`,
    hid(req)
  );
  res.json({ bills: rows.map((b) => ({ id: b.id, title: b.title, amountCents: b.amount_cents, date: b.date, paidBy: b.paid_by, deletedAt: b.deleted_at })) });
});

r.post('/bills/:id/restore', requireHousehold, async (req, res) => {
  const bill = await q.get('SELECT * FROM bills WHERE id = ? AND household_id = ? AND deleted_at IS NOT NULL', Number(req.params.id) || 0, hid(req));
  if (!bill) return res.status(404).json({ error: 'That bill is not in the recently deleted list' });
  // Everyone on it must still live here, or the balances would point at someone who left.
  const gone = await q.all(
    `SELECT u.name FROM bill_shares s JOIN users u ON u.id = s.user_id
      WHERE s.bill_id = ? AND u.household_id IS DISTINCT FROM ?`,
    bill.id, hid(req)
  );
  const payerGone = await q.get('SELECT name FROM users WHERE id = ? AND household_id IS DISTINCT FROM ?', bill.paid_by, hid(req));
  if (gone.length || payerGone) {
    const names = [...new Set([...gone.map((g) => g.name), ...(payerGone ? [payerGone.name] : [])])].join(', ');
    throw new ValidationError(`Can't restore this bill because ${names} no longer lives here. Add it again with the current roommates.`);
  }
  await q.run('UPDATE bills SET deleted_at = NULL WHERE id = ?', bill.id);
  await logActivity(hid(req), req.user.id, 'bill.restored', `${req.user.name} restored "${bill.title}" (${fmt(bill.amount_cents)})`);
  const involved = (await q.all('SELECT user_id FROM bill_shares WHERE bill_id = ?', bill.id)).map((x) => x.user_id);
  await notify([...involved, bill.paid_by].filter((u) => u !== req.user.id), {
    type: 'bill',
    title: `${req.user.name} restored "${bill.title}"`,
    body: `The ${fmt(bill.amount_cents)} bill counts toward balances again.`,
    link: `/bills/${bill.id}`,
  });
  res.json({ ok: true });
});

export default r;
