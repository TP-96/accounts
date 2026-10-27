import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-test-'));
process.env.DATA_DIR = dir;
process.env.NODE_ENV = 'test';
if (!process.env.DATABASE_URL) process.env.DB_MEMORY = '1'; // fresh in-memory Postgres (PGlite) per run

const { default: app } = await import('../src/app.js');
const { init, close, q } = await import('../src/db.js');
const { runRecurring } = await import('../src/recurring.js');
const { splitEqual, splitPercent, splitExact, splitShares } = await import('../src/money.js');
const { advanceDate } = await import('../src/recurring.js');
const ExcelJS = (await import('exceljs')).default;

let server, base;
before(async () => {
  await init();
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}/api`;
});
after(async () => {
  server.close();
  await close();
});

/** Tiny cookie-jar client per user. */
function client() {
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'content-type': 'application/json', cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data };
  };
  return { get: (u) => call('GET', u), post: (u, b) => call('POST', u, b || {}), put: (u, b) => call('PUT', u, b), patch: (u, b) => call('PATCH', u, b), del: (u) => call('DELETE', u) };
}

test('split math always sums to the total', () => {
  assert.deepEqual(splitEqual(1000, [1, 2, 3]).map((s) => s.shareCents), [334, 333, 333]);
  const pct = splitPercent(10001, [{ userId: 1, percent: 33.33 }, { userId: 2, percent: 33.33 }, { userId: 3, percent: 33.34 }]);
  assert.equal(pct.reduce((a, s) => a + s.shareCents, 0), 10001);
  assert.throws(() => splitPercent(100, [{ userId: 1, percent: 50 }, { userId: 2, percent: 40 }]), /90%/);
  assert.throws(() => splitExact(1000, [{ userId: 1, amount: '4' }, { userId: 2, amount: '5' }]), /off by/);
});

test('monthly recurrence clamps to month end and keeps anchor day', () => {
  assert.equal(advanceDate('2026-01-31', 'monthly'), '2026-02-28');
  assert.equal(advanceDate('2026-02-28', 'monthly', 31), '2026-03-31');
  assert.equal(advanceDate('2026-12-15', 'monthly'), '2027-01-15');
  assert.equal(advanceDate('2026-10-26', 'weekly'), '2026-11-02');
});

test('full roommate flow: bills, payments, balances, ledger, export', async () => {
  const a = client(), b = client(), c = client();
  const A = (await a.post('/auth/register', { name: 'Alex', email: 'alex@x.com', password: 'password1' })).data.user;
  const h = (await a.post('/household', { name: 'Maple St' })).data.household;
  const B = (await b.post('/auth/register', { name: 'Bea', email: 'bea@x.com', password: 'password1', inviteCode: h.inviteCode })).data.user;
  await c.post('/auth/register', { name: 'Cam', email: 'cam@x.com', password: 'password1' });
  const joined = await c.post('/household/join', { code: h.inviteCode.toLowerCase() });
  assert.equal(joined.status, 200);
  const C = joined.data.household.members.find((m) => m.name === 'Cam');

  // Duplicate email and wrong password are rejected.
  assert.equal((await client().post('/auth/register', { name: 'X', email: 'ALEX@x.com', password: 'password1' })).status, 409);
  assert.equal((await client().post('/auth/login', { email: 'alex@x.com', password: 'nope' })).status, 401);

  // Alex pays $150 hydro split equally among all three.
  const hydro = await a.post('/bills', {
    title: 'Hydro', description: 'October electric', category: 'utilities', amount: '150.00', paidBy: A.id,
    splitType: 'equal', participants: [{ userId: A.id }, { userId: B.id }, { userId: C.id }], date: '2026-10-01',
  });
  assert.equal(hydro.status, 201);
  assert.deepEqual(hydro.data.bill.shares.map((s) => s.shareCents), [5000, 5000, 5000]);

  // Bea and Cam got notified; Alex (creator & payer) did not.
  const bn = (await b.get('/notifications')).data;
  assert.equal(bn.unread, 2); // "Cam joined" + the hydro bill
  assert.match(bn.notifications[0].title, /You owe Alex \$50\.00 for Hydro/);
  assert.equal((await a.get('/notifications')).data.unread, 2); // only "Bea/Cam joined" notices for Alex
  assert.ok((await a.get('/notifications')).data.notifications.every((n) => n.type === 'member'));

  // Bea pays $60 groceries, only Bea & Cam, 75/25 by percent.
  const groc = await b.post('/bills', {
    title: 'Groceries', amount: 60, paidBy: B.id, splitType: 'percent',
    participants: [{ userId: B.id, percent: 75 }, { userId: C.id, percent: 25 }], date: '2026-10-05',
  });
  assert.equal(groc.status, 201);

  // Bad split rejected with a helpful message.
  const bad = await a.post('/bills', { title: 'Bad', amount: 10, paidBy: A.id, splitType: 'exact', participants: [{ userId: A.id, amount: 3 }, { userId: B.id, amount: 3 }] });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /off by/);
  // Non-member cannot be put on a bill.
  const outsider = client();
  await outsider.post('/auth/register', { name: 'Zed', email: 'zed@x.com', password: 'password1' });
  assert.equal((await outsider.get('/balances')).status, 409);

  let bal = (await a.get('/balances')).data;
  assert.equal(bal.me.owedToMeCents, 10000);
  assert.equal(bal.me.iOweCents, 0);

  let cb = (await c.get('/balances')).data.me;
  assert.equal(cb.iOweCents, 5000 + 1500);
  assert.equal(cb.people.find((p) => p.user.id === A.id).balanceCents, -5000);
  assert.equal(cb.people.find((p) => p.user.id === B.id).balanceCents, -1500);

  // Cam uses "pay my share" on hydro.
  const paid = await c.post(`/bills/${hydro.data.bill.id}/pay-share`, { method: 'etransfer' });
  assert.equal(paid.status, 201);
  assert.equal(paid.data.bill.shares.find((s) => s.userId === C.id).paidCents, 5000);
  assert.equal((await c.post(`/bills/${hydro.data.bill.id}/pay-share`)).status, 400); // already paid
  assert.match((await a.get('/notifications')).data.notifications[0].title, /Cam paid Alex \$50\.00/);

  // Bea records a partial $20 manual payment to Alex.
  assert.equal((await b.post('/payments', { toUser: A.id, amount: '20', note: 'part of hydro' })).status, 201);
  // Cheques and bank drafts are recorded as such (and undone again so the totals below are unchanged).
  for (const method of ['cheque', 'bankdraft']) {
    const pay = await b.post('/payments', { toUser: A.id, amount: '1', method });
    assert.equal((await b.get('/payments')).data.payments.find((x) => x.id === pay.data.payment.id).method, method);
    assert.equal((await b.del(`/payments/${pay.data.payment.id}`)).status, 200);
  }

  bal = (await a.get('/balances')).data;
  assert.equal(bal.me.owedToMeCents, 3000); // Bea still owes 30
  const nets = Object.fromEntries(bal.house.map((n) => [n.user.name, n.netCents]));
  assert.deepEqual(nets, { Alex: 3000, Bea: -3000 + 1500, Cam: -1500 });
  assert.equal(bal.house.reduce((s, n) => s + n.netCents, 0), 0);

  // Ledger from Alex's perspective with Bea: +50 then -20 => running 30.
  const led = (await a.get(`/ledger?with=${B.id}`)).data.rows;
  assert.deepEqual(led.map((r) => r.runningCents), [5000, 3000]);
  // Viewing as Cam (any member can view another's perspective).
  const camLed = (await a.get(`/ledger?as=${C.id}`)).data.rows;
  assert.equal(camLed.at(-1).runningCents, -1500);

  // Simplified plan nets to the same totals.
  const planSum = bal.simplified.reduce((s, p) => s + p.amountCents, 0);
  assert.equal(planSum, 3000);

  // Nudge works only when they owe you.
  assert.equal((await a.post('/nudge', { userId: B.id })).status, 200);
  assert.equal((await a.post('/nudge', { userId: C.id })).status, 400);

  // Edit groceries to $80 equal — balances update.
  await b.put(`/bills/${groc.data.bill.id}`, { title: 'Groceries', amount: 80, paidBy: B.id, splitType: 'equal', participants: [{ userId: B.id }, { userId: C.id }], date: '2026-10-05' });
  cb = (await c.get('/balances')).data.me;
  assert.equal(cb.people.find((p) => p.user.id === B.id).balanceCents, -4000);

  // Delete it — Cam's debt to Bea disappears.
  await b.del(`/bills/${groc.data.bill.id}`);
  cb = (await c.get('/balances')).data.me;
  assert.equal(cb.people.find((p) => p.user.id === B.id).balanceCents, 0);

  // Recurring monthly rent creates the first instance immediately.
  const rent = await a.post('/bills', { title: 'Rent', amount: 2400, paidBy: A.id, splitType: 'equal', participants: [{ userId: A.id }, { userId: B.id }, { userId: C.id }], date: '2026-10-01', repeat: 'monthly' });
  assert.equal(rent.status, 201);
  const rec = (await a.get('/recurring')).data.recurring;
  assert.equal(rec[0].nextDate, '2026-11-01');

  // Excel export opens and has the expected sheets with the right numbers.
  const x = await a.get('/export.xlsx');
  assert.equal(x.status, 200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(x.data);
  const names = wb.worksheets.map((w) => w.name);
  assert.deepEqual(names, ['Transactions', 'Bill Splits', 'Balances', 'Ledger - Alex', 'Alex & Bea', 'Alex & Cam']);
  const txRows = wb.getWorksheet('Transactions').rowCount - 1;
  assert.equal(txRows, 4); // hydro, rent, 2 payments (groceries deleted)
  fs.writeFileSync(path.join(dir, 'sample.xlsx'), x.data);
  console.log('sample export at', path.join(dir, 'sample.xlsx'));
});

test('native app auth: bearer token, CORS preflight, export link, cron', async () => {
  const origin = 'capacitor://localhost';
  const pre = await fetch(`${base}/bills`, { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST' } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), origin);
  const evil = await fetch(`${base}/me`, { headers: { origin: 'https://evil.example' } });
  assert.equal(evil.headers.get('access-control-allow-origin'), null);

  const reg = await fetch(`${base}/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ name: 'Nia', email: 'nia@x.com', password: 'password1' }),
  }).then((r) => r.json());
  assert.ok(reg.token, 'register returns a token for native apps');
  const auth = { authorization: `Bearer ${reg.token}`, 'content-type': 'application/json' };
  const me = await fetch(`${base}/me`, { headers: auth }).then((r) => r.json());
  assert.equal(me.user.name, 'Nia');
  assert.equal((await fetch(`${base}/me`, { headers: { authorization: 'Bearer nope' } }).then((r) => r.json())).user, null);

  await fetch(`${base}/household`, { method: 'POST', headers: auth, body: JSON.stringify({ name: 'Nia place' }) });
  const link = await fetch(`${base}/export-link`, { method: 'POST', headers: auth }).then((r) => r.json());
  assert.match(link.path, /^\/api\/export\.xlsx\?dl=/);
  const dl = await fetch(base.replace('/api', '') + link.path);
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get('content-type'), /spreadsheetml/);
  // A download token can't be used as a session.
  const dlTok = decodeURIComponent(link.path.split('dl=')[1]);
  assert.equal((await fetch(`${base}/me`, { headers: { authorization: `Bearer ${dlTok}` } }).then((r) => r.json())).user, null);

  assert.equal((await fetch(`${base}/cron/recurring`)).status, 200);
});

test('recurring bills: catch up, and concurrent runs never duplicate', async () => {
  const c = client();
  const U = (await c.post('/auth/register', { name: 'Rae', email: 'rae@x.com', password: 'password1' })).data.user;
  await c.post('/household', { name: 'Rae place' });
  await c.post('/bills', { title: 'Wifi', amount: 60, paidBy: U.id, splitType: 'equal', participants: [{ userId: U.id }], date: '2026-07-15', repeat: 'monthly' });
  // July created now; Aug, Sep, Oct are due by Oct 26. Run 3 workers at once.
  const results = await Promise.all([runRecurring('2026-10-26'), runRecurring('2026-10-26'), runRecurring('2026-10-26')]);
  assert.equal(results.reduce((a, b) => a + b, 0), 3);
  const bills = (await c.get('/bills')).data.bills.filter((b) => b.title === 'Wifi').map((b) => b.date).sort();
  assert.deepEqual(bills, ['2026-07-15', '2026-08-15', '2026-09-15', '2026-10-15']);
  const rec = await q.get("SELECT next_date FROM recurring_bills WHERE template LIKE '%Wifi%'");
  assert.equal(rec.next_date, '2026-11-15');
});

test('moving out; and nobody can reset another roommate\'s password', async () => {
  const a = client(), b = client();
  const A = (await a.post('/auth/register', { name: 'Ana', email: 'ana@x.com', password: 'password1' })).data.user;
  const h = (await a.post('/household', { name: 'Elm' })).data.household;
  const B = (await b.post('/auth/register', { name: 'Ben', email: 'ben@x.com', password: 'password1', inviteCode: h.inviteCode })).data.user;

  // Roommates cannot reset each other's passwords: the old reset-link routes are gone.
  assert.equal((await a.post(`/household/members/${B.id}/reset-link`)).status, 404);
  assert.notEqual((await client().post('/auth/reset', { token: 'x', password: 'newpassword2' })).status, 200);
  assert.equal((await client().post('/auth/login', { email: 'ben@x.com', password: 'password1' })).status, 200, "Ben's password is untouched");

  // Ben owes Ana, so he can't be removed yet.
  await a.post('/bills', { title: 'Hydro', amount: 100, paidBy: A.id, splitType: 'equal', participants: [{ userId: A.id }, { userId: B.id }] });
  await a.post('/bills', { title: 'Rent', amount: 1000, paidBy: A.id, splitType: 'equal', participants: [{ userId: A.id }, { userId: B.id }], repeat: 'monthly' });
  const blocked = await a.post(`/household/members/${B.id}/remove`);
  assert.equal(blocked.status, 409);
  assert.match(blocked.data.error, /settle up first/);

  await b.post('/payments', { toUser: A.id, amount: 550 });
  const removed = await a.post(`/household/members/${B.id}/remove`);
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.data.household.members.map((m) => m.name), ['Ana']);
  assert.deepEqual(removed.data.household.formerMembers.map((m) => m.name), ['Ben']);
  assert.equal((await a.get('/recurring')).data.recurring.length, 0, 'repeating bills with Ben are stopped');
  // History still names him.
  const led = (await a.get('/ledger')).data.rows;
  assert.ok(led.every((r) => r.counterpart.name === 'Ben'));
  // Ben can now join a different house.
  assert.equal((await b.get('/me')).data.household, null);
  assert.equal((await b.post('/household', { name: 'New place' })).status, 201);
});

test('split by shares adds up to the cent', () => {
  const r = splitShares(10000, [{ userId: 1, shares: 2 }, { userId: 2, shares: 1 }, { userId: 3, shares: 1 }]);
  assert.deepEqual(r.map((x) => x.shareCents), [5000, 2500, 2500]);
  const odd = splitShares(1000, [{ userId: 1, shares: 1 }, { userId: 2, shares: 1 }, { userId: 3, shares: 1 }]);
  assert.equal(odd.reduce((a, x) => a + x.shareCents, 0), 1000);
  assert.throws(() => splitShares(100, [{ userId: 1, shares: 0 }]), /at least one person a share/);
});

test('new features: shares bills, comments, restore, e-Transfer, stats', async () => {
  const a = client(), b = client();
  const A = (await a.post('/auth/register', { name: 'Ivy', email: 'ivy@x.com', password: 'password1' })).data.user;
  const h = (await a.post('/household', { name: 'Oak' })).data.household;
  const B = (await b.post('/auth/register', { name: 'Kai', email: 'kai@x.com', password: 'password1', inviteCode: h.inviteCode })).data.user;
  const thisMonth = new Date().toISOString().slice(0, 7);

  // Shares: Ivy 2 shares, Kai 1 share of $90.
  const rent = await a.post('/bills', { title: 'Big room rent', amount: 90, paidBy: A.id, splitType: 'shares', category: 'rent',
    participants: [{ userId: A.id, shares: 2 }, { userId: B.id, shares: 1 }], date: `${thisMonth}-01` });
  assert.equal(rent.status, 201);
  assert.deepEqual(rent.data.bill.shares.map((s) => [s.shareCents, s.units]), [[6000, 2], [3000, 1]]);
  assert.equal((await b.get('/balances')).data.me.iOweCents, 3000);
  await a.post('/bills', { title: 'Snacks', amount: 20, paidBy: B.id, category: 'groceries', participants: [{ userId: A.id }, { userId: B.id }], date: `${thisMonth}-02` });

  // Comments notify the other person.
  assert.equal((await b.post(`/bills/${rent.data.bill.id}/comments`, { body: 'Thanks for covering it!' })).status, 201);
  assert.equal((await b.post(`/bills/${rent.data.bill.id}/comments`, { body: '  ' })).status, 400);
  const comments = (await a.get(`/bills/${rent.data.bill.id}/comments`)).data.comments;
  assert.equal(comments[0].user.name, 'Kai');
  assert.match((await a.get('/notifications')).data.notifications[0].title, /Kai commented on "Big room rent"/);
  assert.equal((await a.del(`/comments/${comments[0].id}`)).status, 403, "can't delete someone else's comment");

  // Only the person who added a bill can edit, delete or restore it.
  const notMine = await b.del(`/bills/${rent.data.bill.id}`);
  assert.equal(notMine.status, 403);
  assert.match(notMine.data.error, /can delete it/);
  assert.equal((await b.put(`/bills/${rent.data.bill.id}`, { title: 'Hacked', amount: 1 })).status, 403);
  assert.equal((await b.get(`/bills/${rent.data.bill.id}`)).data.bill.title, 'Big room rent');

  // Delete then restore.
  await a.del(`/bills/${rent.data.bill.id}`);
  assert.equal((await b.get('/balances')).data.me.iOweCents, 0);
  const deleted = (await a.get('/bills-deleted')).data.bills;
  assert.equal(deleted[0].title, 'Big room rent');
  assert.equal((await b.post(`/bills/${rent.data.bill.id}/restore`)).status, 403, "can't restore someone else's bill");
  assert.equal((await a.post(`/bills/${rent.data.bill.id}/restore`)).status, 200);
  assert.equal((await b.get('/balances')).data.me.iOweCents, 3000 - 1000);
  assert.equal((await a.get('/bills-deleted')).data.bills.length, 0);
  assert.equal((await a.post(`/bills/${rent.data.bill.id}/restore`)).status, 404);

  // e-Transfer details are visible to housemates.
  await a.patch('/me', { etransfer: 'ivy.pays@x.com' });
  const members = (await b.get('/me')).data.household.members;
  assert.equal(members.find((m) => m.id === A.id).etransfer, 'ivy.pays@x.com');

  // Stats for this month.
  const st = (await a.get('/stats?range=3')).data;
  assert.equal(st.months.length, 1, 'months before the first bill are not shown');
  assert.equal(st.summary.hasLastMonth, false);
  assert.deepEqual(st.months.at(-1), { month: thisMonth, houseCents: 11000, myShareCents: 7000, iPaidCents: 9000 });
  assert.deepEqual(st.byCategory.map((c) => [c.category, c.totalCents, c.myShareCents]), [['rent', 9000, 6000], ['groceries', 2000, 1000]]);
  const ivy = st.byPerson.find((p) => p.user.name === 'Ivy');
  assert.deepEqual([ivy.paidCents, ivy.shareCents], [9000, 7000]);
  assert.equal(st.biggest[0].title, 'Big room rent');
  assert.equal(st.summary.houseCents, 11000);
  assert.equal((await a.get('/stats?range=all')).data.months.length, 1);
});
