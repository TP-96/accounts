import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-houses-'));
process.env.NODE_ENV = 'test';
if (!process.env.DATABASE_URL) process.env.DB_MEMORY = '1';

const { default: app } = await import('../src/app.js');
const { init, close, q } = await import('../src/db.js');

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

/** Cookie-jar client; `house` is sent as the X-Household header, like the app does. */
function client() {
  let cookie = '';
  let house = null;
  const call = async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'content-type': 'application/json', cookie, ...(house ? { 'x-household': String(house) } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json() };
  };
  return {
    get: (u) => call('GET', u),
    post: (u, b) => call('POST', u, b || {}),
    patch: (u, b) => call('PATCH', u, b),
    put: (u, b) => call('PUT', u, b),
    del: (u) => call('DELETE', u),
    use: (id) => { house = id; },
  };
}
const signUp = async (c, name) => (await c.post('/auth/register', { name, email: `${name.toLowerCase()}@h.test`, password: 'password1' })).data.user;

test('one person, two houses: each house keeps its own bills, people and balances', async () => {
  const maya = client(), jon = client(), sam = client();
  const M = await signUp(maya, 'Maya');
  const flat = (await maya.post('/household', { name: 'Flat' })).data.household;
  const J = await signUp(jon, 'Jon');
  await jon.post('/household/join', { code: flat.inviteCode });
  const S = await signUp(sam, 'Sam');

  // Maya starts a second house: the cottage, with Sam.
  const cottage = (await maya.post('/household', { name: 'Cottage' })).data.household;
  assert.notEqual(cottage.color, flat.color, 'each house gets its own colour');
  await sam.post('/household/join', { code: cottage.inviteCode });

  const me = (await maya.get('/me')).data;
  assert.deepEqual(me.households.map((h) => h.name), ['Flat', 'Cottage']);
  assert.equal(me.household.name, 'Cottage', 'defaults to the house you last used');

  // A bill in the flat (with Jon), and one at the cottage (with Sam).
  maya.use(flat.id);
  assert.equal((await maya.post('/bills', { title: 'Hydro', amount: 100, paidBy: M.id, splitType: 'equal', participants: [{ userId: M.id }, { userId: J.id }] })).status, 201);
  maya.use(cottage.id);
  assert.equal((await maya.post('/bills', { title: 'Firewood', amount: 60, paidBy: M.id, splitType: 'equal', participants: [{ userId: M.id }, { userId: S.id }] })).status, 201);
  // Jon isn't at the cottage, so he can't be on a cottage bill.
  assert.equal((await maya.post('/bills', { title: 'Nope', amount: 10, paidBy: M.id, splitType: 'equal', participants: [{ userId: M.id }, { userId: J.id }] })).status, 400);

  maya.use(flat.id);
  assert.deepEqual((await maya.get('/bills')).data.bills.map((b) => b.title), ['Hydro']);
  assert.equal((await maya.get('/balances')).data.me.people.find((p) => p.user.id === J.id).balanceCents, 5000);
  assert.equal((await maya.get('/balances')).data.me.people.find((p) => p.user.id === S.id), undefined);
  maya.use(cottage.id);
  assert.deepEqual((await maya.get('/bills')).data.bills.map((b) => b.title), ['Firewood']);
  assert.equal((await maya.get('/balances')).data.me.people.find((p) => p.user.id === S.id).balanceCents, 3000);

  // Alerts say which house they came from, and the switcher counts unread per house.
  const jonAlerts = (await jon.get('/notifications')).data.notifications;
  assert.equal(jonAlerts[0].house.name, 'Flat');
  assert.equal((await sam.get('/me')).data.households[0].unread, 1);

  // Nobody can reach a house they're not in by asking for it.
  const nosy = client();
  await signUp(nosy, 'Nosy');
  await nosy.post('/household', { name: 'Own place' });
  nosy.use(flat.id);
  const peek = (await nosy.get('/bills')).data.bills;
  assert.equal(peek.length, 0, "asking for another house's id still shows only their own");
  assert.equal((await nosy.get('/me')).data.household.name, 'Own place');
});

test('joining twice is refused; leaving one house keeps the other', async () => {
  const [a, b] = [client(), client()];
  const A = await signUp(a, 'Ana');
  const one = (await a.post('/household', { name: 'One' })).data.household;
  const B = await signUp(b, 'Ben');
  await b.post('/household/join', { code: one.inviteCode });
  assert.equal((await b.post('/household/join', { code: one.inviteCode })).status, 409);
  const two = (await b.post('/household', { name: 'Two' })).data.household;
  assert.equal((await b.get('/me')).data.households.length, 2);

  // Ben leaves "Two" (the one he last used): he lands in "One".
  b.use(two.id);
  assert.equal((await b.post(`/household/members/${B.id}/remove`)).status, 200);
  const after = (await b.get('/me')).data;
  assert.deepEqual(after.households.map((h) => h.name), ['One']);
  assert.equal(after.household.name, 'One');
  // Ben can come back with the code, and "One" still lists him.
  b.use(one.id);
  assert.equal((await b.get('/me')).data.household.members.length, 2);
  await a.post('/household/members/' + B.id + '/remove');
  const gone = (await b.get('/me')).data;
  assert.equal(gone.household, null);
  assert.equal(gone.households.length, 0);
  assert.equal((await b.post('/household/join', { code: one.inviteCode })).status, 200, 'rejoining works');
  assert.equal((await a.get('/me')).data.household.formerMembers.length, 0);
  assert.ok(A.id !== B.id);
});

test('house colour can be changed to one of the palette', async () => {
  const c = client();
  await signUp(c, 'Cleo');
  await c.post('/household', { name: 'Colourful' });
  assert.equal((await c.patch('/household', { color: '#6a4c93' })).data.household.color, '#6a4c93');
  assert.equal((await c.patch('/household', { color: 'red' })).data.household.color, '#6a4c93', 'unknown colours are ignored');
});

test('stats by month: totals, categories, and previous/next month', async () => {
  const c = client();
  const U = await signUp(c, 'Stan');
  const h = (await c.post('/household', { name: 'Statsville' })).data.household;
  const add = (title, amount, date, category = 'groceries') =>
    c.post('/bills', { title, amount, date, category, paidBy: U.id, splitType: 'equal', participants: [{ userId: U.id }] });
  await add('Old rent', 500, '2026-08-01', 'rent');
  await add('Shop', 40, '2026-09-10');
  await add('Shop 2', 60, '2026-09-20');
  await add('Power', 80, '2026-09-25', 'utilities');

  const sep = (await c.get('/stats/month?month=2026-09')).data;
  assert.equal(sep.summary.houseCents, 18000);
  assert.equal(sep.summary.billCount, 3);
  assert.equal(sep.previous.houseCents, 50000, 'compares with August');
  assert.equal(sep.prevMonth, '2026-08');
  assert.equal(sep.nextMonth, '2026-10');
  assert.deepEqual(sep.byCategory.map((x) => [x.category, x.totalCents]), [['groceries', 10000], ['utilities', 8000]]);
  assert.deepEqual(sep.bills.map((b) => b.title), ['Power', 'Shop 2', 'Shop']);
  // A month with no bills is fine, and the first month has no "previous".
  assert.equal((await c.get('/stats/month?month=2026-10')).data.summary.billCount, 0);
  assert.equal((await c.get('/stats/month?month=2026-08')).data.previous, null);
  // The overview doesn't pad months from before the first bill.
  const overview = (await c.get('/stats?range=12')).data;
  assert.equal(overview.months[0].month, '2026-08');
  assert.ok(h.id);
});

test('house admins: creator is admin, can fix any bill and remove people; admin passes on when they leave', async () => {
  const ann = client(), bo = client(), cy = client();
  const A = await signUp(ann, 'Ann');
  const house = (await ann.post('/household', { name: 'Admin house' })).data.household;
  assert.equal(house.members.find((m) => m.id === A.id).role, 'admin', 'whoever creates a house is its admin');
  const B = await signUp(bo, 'Bo');
  const C = await signUp(cy, 'Cy');
  await bo.post('/household/join', { code: house.inviteCode });
  await cy.post('/household/join', { code: house.inviteCode });
  const members = (await bo.get('/me')).data.household.members;
  assert.equal(members.find((m) => m.id === B.id).role, 'member', 'people who join are members');

  // Bo adds a bill. Cy (member) can't touch it; Ann (admin) can.
  const bill = (await bo.post('/bills', { title: 'Snacks', amount: 30, paidBy: B.id, splitType: 'equal', participants: [{ userId: A.id }, { userId: B.id }, { userId: C.id }] })).data.bill;
  assert.equal((await cy.del(`/bills/${bill.id}`)).status, 403);
  const fix = await ann.put(`/bills/${bill.id}`, { title: 'Snacks (fixed)', amount: 36, paidBy: B.id, splitType: 'equal', participants: [{ userId: A.id }, { userId: B.id }, { userId: C.id }] });
  assert.equal(fix.status, 200, 'admin can edit any bill');
  assert.equal(fix.data.bill.title, 'Snacks (fixed)');

  // House settings and removing others are admin-only.
  assert.equal((await cy.patch('/household', { name: 'Cy rules' })).status, 403);
  assert.equal((await cy.post(`/household/members/${B.id}/remove`)).status, 403, "members can't remove others");
  assert.equal((await ann.patch('/household', { name: 'Renamed' })).status, 200);
  assert.equal((await cy.post(`/household/members/${A.id}/role`, { role: 'member' })).status, 403);

  // The only admin can't step down; after making Bo admin, they can.
  assert.equal((await ann.post(`/household/members/${A.id}/role`, { role: 'member' })).status, 409);
  const promoted = await ann.post(`/household/members/${B.id}/role`, { role: 'admin' });
  assert.equal(promoted.data.household.members.find((m) => m.id === B.id).role, 'admin');
  assert.match((await bo.get('/notifications')).data.notifications[0].title, /made you an admin/);
  assert.equal((await ann.post(`/household/members/${A.id}/role`, { role: 'member' })).status, 200);

  // Bo (now the only admin) deletes the bill so everyone is square, then moves out: Ann (longest here) takes over.
  assert.equal((await bo.del(`/bills/${bill.id}`)).status, 200);
  assert.equal((await bo.post(`/household/members/${B.id}/remove`)).status, 200);
  const after = (await ann.get('/me')).data.household.members;
  assert.equal(after.find((m) => m.id === A.id).role, 'admin', 'a house always has an admin');
  assert.equal(after.length, 2);
  // Members can still move themselves out.
  assert.equal((await cy.post(`/household/members/${C.id}/remove`)).status, 200);
});
