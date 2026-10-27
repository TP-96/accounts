import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-codes-'));
process.env.NODE_ENV = 'test';
process.env.MAIL_TEST = '1'; // pretend email is set up; mail lands in `mailbox`
if (!process.env.DATABASE_URL) process.env.DB_MEMORY = '1';

const { default: app } = await import('../src/app.js');
const { init, close, q } = await import('../src/db.js');
const { mailbox } = await import('../src/notify.js');

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

function client() {
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json() };
  };
  return { get: (u) => call('GET', u), post: (u, b) => call('POST', u, b || {}), patch: (u, b) => call('PATCH', u, b) };
}
// Newest code emailed to an address (the subject starts with the 6 digits).
const lastCode = (to) => [...mailbox].reverse().find((m) => m.to === to)?.subject.slice(0, 6);
// Skip the 30-second wait between requests for one address.
const skipCooldown = () => q.run("UPDATE login_codes SET created_at = '2000-01-01T00:00:00.000Z'");

test('sign up with an emailed code: no password, address verified, invite joins the house', async () => {
  const maya = client();
  assert.equal((await maya.get('/me')).data.emailEnabled, true);
  // Password sign-up is closed while email is on, so every address is verified.
  assert.equal((await maya.post('/auth/register', { name: 'X', email: 'x@t.test', password: 'password1' })).status, 400);

  assert.equal((await maya.post('/auth/code/request', { mode: 'register', name: 'Maya', email: 'Maya@T.test' })).status, 200);
  const code = lastCode('maya@t.test');
  assert.match(code, /^\d{6}$/);
  const done = await maya.post('/auth/code/verify', { mode: 'register', email: 'maya@t.test', code });
  assert.equal(done.status, 201);
  assert.equal(done.data.user.name, 'Maya');
  assert.equal(done.data.user.hasPassword, false);
  assert.equal((await maya.get('/me')).data.user.email, 'maya@t.test'); // signed in
  const { household } = (await maya.post('/household', { name: 'Test house' })).data;

  const jon = client();
  await jon.post('/auth/code/request', { mode: 'register', name: 'Jon', email: 'jon@t.test', inviteCode: household.inviteCode });
  const r = await jon.post('/auth/code/verify', { mode: 'register', email: 'jon@t.test', code: lastCode('jon@t.test') });
  assert.equal(r.status, 201);
  assert.equal((await jon.get('/me')).data.household.members.length, 2);

  // Can't make a second account with the same address.
  await skipCooldown();
  assert.equal((await client().post('/auth/code/request', { mode: 'register', name: 'Maya2', email: 'maya@t.test' })).status, 409);
});

test('sign in with a code: single use, wrong codes limited, expires, and no way to look up who has an account', async () => {
  await skipCooldown();
  const c = client();
  const unknown = await c.post('/auth/code/request', { mode: 'login', email: 'nobody@t.test' });
  assert.equal(unknown.status, 200); // same answer as for a real account
  assert.equal(lastCode('nobody@t.test'), undefined); // but nothing was sent

  assert.equal((await c.post('/auth/code/request', { mode: 'login', email: 'maya@t.test' })).status, 200);
  const code = lastCode('maya@t.test');
  const wrong = code === '000000' ? '111111' : '000000';
  const bad = await c.post('/auth/code/verify', { email: 'maya@t.test', code: wrong });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /4 tries left/);
  assert.equal((await c.get('/me')).data.user, null); // still signed out

  const ok = await c.post('/auth/code/verify', { email: 'maya@t.test', code });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.user.email, 'maya@t.test');
  assert.equal((await c.get('/me')).data.user.name, 'Maya');
  // The same code can't be used again.
  assert.equal((await client().post('/auth/code/verify', { email: 'maya@t.test', code })).status, 400);

  // Five wrong guesses burn the code, even if the sixth is right.
  await skipCooldown();
  await c.post('/auth/code/request', { mode: 'login', email: 'maya@t.test' });
  const good = lastCode('maya@t.test');
  const guess = good === '123456' ? '654321' : '123456';
  const d = client();
  for (let i = 0; i < 5; i++) await d.post('/auth/code/verify', { email: 'maya@t.test', code: guess });
  const late = await d.post('/auth/code/verify', { email: 'maya@t.test', code: good });
  assert.equal(late.status, 400);
  assert.match(late.data.error, /Too many wrong tries/);

  // Expired codes are refused.
  await skipCooldown();
  await c.post('/auth/code/request', { mode: 'login', email: 'maya@t.test' });
  const old = lastCode('maya@t.test');
  await q.run("UPDATE login_codes SET expires_at = '2000-01-01T00:00:00.000Z' WHERE used = 0");
  const exp = await client().post('/auth/code/verify', { email: 'maya@t.test', code: old });
  assert.match(exp.data.error, /expired/);
});

test('requests are spaced out and capped per address', async () => {
  await skipCooldown();
  const c = client();
  assert.equal((await c.post('/auth/code/request', { mode: 'login', email: 'jon@t.test' })).status, 200);
  const quick = await c.post('/auth/code/request', { mode: 'login', email: 'jon@t.test' });
  assert.equal(quick.status, 429);
  assert.match(quick.data.error, /few seconds/);
  // A newer code replaces the older one.
  const first = lastCode('jon@t.test');
  await skipCooldown();
  await c.post('/auth/code/request', { mode: 'login', email: 'jon@t.test' });
  const second = lastCode('jon@t.test');
  if (first !== second) assert.equal((await client().post('/auth/code/verify', { email: 'jon@t.test', code: first })).status, 400);
  // Hourly cap: backdate the cooldown each time so only the cap can stop us.
  let last;
  for (let i = 0; i < 8; i++) {
    await q.run("UPDATE login_codes SET created_at = to_char(now() - interval '40 seconds', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')");
    last = await c.post('/auth/code/request', { mode: 'login', email: 'jon@t.test' });
  }
  assert.equal(last.status, 429);
  assert.match(last.data.error, /hour/);
});

test('forgot password: emailed code sets a new password; passwords stay optional', async () => {
  await skipCooldown();
  const me = client();
  await me.post('/auth/code/request', { mode: 'login', email: 'maya@t.test' });
  await me.post('/auth/code/verify', { email: 'maya@t.test', code: lastCode('maya@t.test') });
  // Add a password from Settings (no "current password" needed because there isn't one yet).
  const added = await me.patch('/me', { newPassword: 'first-pass-1' });
  assert.equal(added.status, 200);
  assert.equal(added.data.user.hasPassword, true);
  assert.equal((await client().post('/auth/login', { email: 'maya@t.test', password: 'first-pass-1' })).status, 200);
  // Changing it now needs the current one.
  assert.equal((await me.patch('/me', { newPassword: 'second-pass-2' })).status, 400);

  // Forgot it: ask for a code by email, then choose a new password.
  await skipCooldown();
  const f = client();
  assert.equal((await f.post('/auth/password-reset/request', { email: 'maya@t.test' })).status, 200);
  const code = lastCode('maya@t.test');
  assert.equal((await f.post('/auth/password-reset/confirm', { email: 'maya@t.test', code, password: 'short' })).status, 400); // too short: code not used up
  const bad = code === '000000' ? '111111' : '000000';
  assert.equal((await f.post('/auth/password-reset/confirm', { email: 'maya@t.test', code: bad, password: 'brand-new-3' })).status, 400);
  const done = await f.post('/auth/password-reset/confirm', { email: 'maya@t.test', code, password: 'brand-new-3' });
  assert.equal(done.status, 200);
  assert.equal((await f.get('/me')).data.user.email, 'maya@t.test'); // signed in after resetting
  assert.equal((await client().post('/auth/login', { email: 'maya@t.test', password: 'first-pass-1' })).status, 401);
  assert.equal((await client().post('/auth/login', { email: 'maya@t.test', password: 'brand-new-3' })).status, 200);
  // Asking about an unknown address looks the same and sends nothing.
  assert.equal((await client().post('/auth/password-reset/request', { email: 'ghost@t.test' })).status, 200);
  assert.equal(lastCode('ghost@t.test'), undefined);
});

test('an account with no password cannot be signed into with a blank or guessed password', async () => {
  const jon = await q.get("SELECT * FROM users WHERE email = 'jon@t.test'");
  assert.equal(jon.password_hash, null);
  for (const password of ['', 'null', 'undefined', 'password']) {
    assert.equal((await client().post('/auth/login', { email: 'jon@t.test', password })).status, 401);
  }
});
