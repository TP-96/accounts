import ExcelJS from 'exceljs';
import { q } from './db.js';
import { balancesFor, householdNets, ledgerFor, simplifyDebts } from './balances.js';

const MONEY = '"$"#,##0.00;[Red]-"$"#,##0.00';
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2A2640' } };

function styleHeader(ws) {
  const row = ws.getRow(1);
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = HEADER_FILL;
  row.alignment = { vertical: 'middle' };
  row.height = 22;
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
}

const cents = (c) => Math.round(c) / 100;

/** Build an .xlsx workbook of every transaction plus balances/ledger for the requesting user. */
export async function buildWorkbook(householdId, userId) {
  const household = await q.get('SELECT * FROM households WHERE id = ?', householdId);
  const members = await q.all('SELECT id, name FROM users WHERE household_id = ? ORDER BY id', householdId);
  const everyone = await q.all('SELECT id, name FROM users WHERE household_id = ? OR former_household_id = ?', householdId, householdId);
  const name = new Map(everyone.map((m) => [m.id, m.name]));
  const me = name.get(userId);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Hearth';
  wb.created = new Date();

  // 1. All transactions (bills + payments) in one chronological list.
  const bills = await q.all('SELECT * FROM bills WHERE household_id = ? AND deleted_at IS NULL', householdId);
  const payments = await q.all('SELECT * FROM payments WHERE household_id = ? AND deleted_at IS NULL', householdId);
  const tx = [
    ...bills.map((b) => ({ date: b.date, type: 'Bill', name: b.title, description: b.description, category: b.category, from: name.get(b.paid_by), to: 'Split', amount: b.amount_cents, split: b.split_type, createdAt: b.created_at })),
    ...payments.map((p) => ({ date: p.date, type: 'Payment', name: p.note || 'Payment', description: p.method, category: '', from: name.get(p.from_user), to: name.get(p.to_user), amount: p.amount_cents, split: '', createdAt: p.created_at })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));

  const wsTx = wb.addWorksheet('Transactions');
  wsTx.columns = [
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Type', key: 'type', width: 10 },
    { header: 'Name', key: 'name', width: 28 },
    { header: 'Description / Method', key: 'description', width: 34 },
    { header: 'Category', key: 'category', width: 14 },
    { header: 'Paid by', key: 'from', width: 14 },
    { header: 'Paid to', key: 'to', width: 14 },
    { header: 'Amount', key: 'amount', width: 12, style: { numFmt: MONEY } },
    { header: 'Split', key: 'split', width: 10 },
  ];
  tx.forEach((t) => wsTx.addRow({ ...t, amount: cents(t.amount) }));
  styleHeader(wsTx);

  // 2. Bill splits — one row per person per bill.
  const wsSplit = wb.addWorksheet('Bill Splits');
  wsSplit.columns = [
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Bill', key: 'bill', width: 28 },
    { header: 'Total', key: 'total', width: 12, style: { numFmt: MONEY } },
    { header: 'Paid by', key: 'payer', width: 14 },
    { header: 'Person', key: 'person', width: 14 },
    { header: 'Share', key: 'share', width: 12, style: { numFmt: MONEY } },
    { header: 'Percent', key: 'pct', width: 10 },
  ];
  const shares = await q.all(
    `SELECT b.date, b.title, b.amount_cents, b.paid_by, s.user_id, s.share_cents, s.percent
       FROM bills b JOIN bill_shares s ON s.bill_id = b.id
      WHERE b.household_id = ? AND b.deleted_at IS NULL ORDER BY b.date, b.id, s.user_id`,
    householdId
  );
  shares.forEach((s) =>
    wsSplit.addRow({ date: s.date, bill: s.title, total: cents(s.amount_cents), payer: name.get(s.paid_by), person: name.get(s.user_id), share: cents(s.share_cents), pct: s.percent != null ? `${s.percent}%` : '' })
  );
  styleHeader(wsSplit);

  // 3. Balances.
  const wsBal = wb.addWorksheet('Balances');
  wsBal.columns = [
    { header: 'Roommate', key: 'who', width: 18 },
    { header: 'Net with house', key: 'net', width: 16, style: { numFmt: MONEY } },
    { header: 'Meaning', key: 'meaning', width: 36 },
  ];
  (await householdNets(householdId)).forEach((n) =>
    wsBal.addRow({ who: n.user.name, net: cents(n.netCents), meaning: n.netCents > 0 ? 'is owed by the house' : n.netCents < 0 ? 'owes the house' : 'settled up' })
  );
  const totalRow = wsBal.addRow({ who: 'Check (should be 0)', net: { formula: `SUM(B2:B${members.length + 1})` } });
  totalRow.font = { italic: true };
  styleHeader(wsBal);

  wsBal.addRow([]);
  const mine = await balancesFor(householdId, userId);
  wsBal.addRow([`From ${me}'s perspective`]).font = { bold: true };
  mine.people.forEach((p) =>
    wsBal.addRow({ who: p.user.name, net: cents(p.balanceCents), meaning: p.balanceCents > 0 ? `owes ${me}` : p.balanceCents < 0 ? `${me} owes them` : 'settled up' })
  );
  wsBal.addRow([]);
  wsBal.addRow(['Suggested settle-up (fewest payments)']).font = { bold: true };
  const plan = await simplifyDebts(householdId);
  if (!plan.length) wsBal.addRow(['Everyone is settled up 🎉']);
  plan.forEach((p) => wsBal.addRow({ who: `${p.from.name} → ${p.to.name}`, net: cents(p.amountCents) }));

  // 4. One ledger sheet per roommate pair from the requester's view, plus overall.
  const addLedger = (title, rows, label) => {
    const ws = wb.addWorksheet(title.slice(0, 31));
    ws.columns = [
      { header: 'Date', key: 'date', width: 12 },
      { header: 'Type', key: 'kind', width: 10 },
      { header: 'Item', key: 'title', width: 28 },
      { header: 'With', key: 'with', width: 14 },
      { header: 'Detail', key: 'detail', width: 36 },
      { header: 'Effect on you', key: 'effect', width: 14, style: { numFmt: MONEY } },
      { header: label, key: 'running', width: 16, style: { numFmt: MONEY } },
    ];
    rows.forEach((r) =>
      ws.addRow({ date: r.date, kind: r.kind === 'bill' ? 'Bill' : 'Payment', title: r.title, with: r.counterpart.name, detail: r.detail, effect: cents(r.effectCents), running: cents(r.runningCents) })
    );
    styleHeader(ws);
  };
  addLedger(`Ledger - ${me}`, await ledgerFor(householdId, userId), 'Running net');
  for (const m of members) {
    if (m.id === userId) continue;
    addLedger(`${me} & ${m.name}`, await ledgerFor(householdId, userId, m.id), `${m.name} owes you`);
  }

  wb.title = `${household.name} transactions`;
  return wb;
}
