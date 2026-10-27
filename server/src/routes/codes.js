import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { q } from '../db.js';
import { setSession, publicUser } from '../auth.js';
import { sendMail, emailEnabled } from '../notify.js';
import { joinHousehold, COLORS } from './account.js';

/**
 * Sign in (and sign up, and password reset) with a 6-digit code emailed to you.
 *  - codes last 10 minutes, work once, and allow 5 guesses
 *  - a new request replaces the old code; at most 6 requests an hour per address, 30 seconds apart
 *  - only a salted hash of the code is stored
 */
const r = Router();
const TTL_MS = 10 * 60 * 1000;
const COOLDOWN_MS = 30 * 1000;
const MAX_PER_HOUR = 6;
const MAX_TRIES = 5;
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const hits = new Map(); // best-effort per-server limit by IP, on top of the per-email limits kept in the database
function limited(key, max = 30) {
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < 15 * 60 * 1000);
  list.push(now);
  hits.set(key, list);
  return list.length > max;
}
const tooMany = (res) => res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });

const hashCode = (salt, code) => crypto.createHash('sha256').update(`${salt}:${code}`).digest('hex');
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const cleanEmail = (v) => String(v || '').trim().toLowerCase();
const needEmail = (res) => res.status(503).json({ error: "Email codes aren't set up on this Hearth yet. Use your password instead." });

function codeEmail(code, purpose) {
  const what = purpose === 'reset' ? 'reset your password' : purpose === 'register' ? 'finish creating your account' : 'sign in';
  const text = `Your Hearth code is ${code}\n\nEnter it to ${what}. It works for 10 minutes and can only be used once.\n\nIf you didn't ask for this, you can ignore this email. Nobody can get in without the code.`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:440px;margin:auto;padding:24px;color:#1d1b26">
  <p style="margin:0 0 12px;color:#6b6880">Enter this code to ${what}:</p>
  <p style="margin:0 0 16px;font-size:34px;font-weight:700;letter-spacing:0.25em;font-variant-numeric:tabular-nums">${code}</p>
  <p style="margin:0;line-height:1.5;color:#6b6880">It works for 10 minutes and can only be used once. If you didn't ask for this, you can ignore this email. Nobody can get in without the code.</p>
</div>`;
  return { subject: `${code} is your Hearth code`, text, html };
}

/** Make and email a fresh code. Returns an error string for the caller to send back, or null on success. */
async function issueCode(email, purpose, payload = {}) {
  const now = Date.now();
  const recent = await q.all('SELECT created_at FROM login_codes WHERE email = ? AND created_at > ? ORDER BY id DESC', email, new Date(now - 3600_000).toISOString());
  if (recent.length >= MAX_PER_HOUR) return 'Too many codes requested. Try again in an hour.';
  if (recent[0] && now - Date.parse(recent[0].created_at) < COOLDOWN_MS) return 'Wait a few seconds before asking for another code.';

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const salt = crypto.randomBytes(8).toString('hex');
  await q.run('UPDATE login_codes SET used = 1 WHERE email = ? AND purpose = ? AND used = 0', email, purpose);
  const row = await q.get(
    'INSERT INTO login_codes (email, purpose, salt, code_hash, payload, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id',
    email, purpose, salt, hashCode(salt, code), JSON.stringify(payload), new Date(now + TTL_MS).toISOString(), new Date(now).toISOString()
  );
  try {
    await sendMail({ to: email, ...codeEmail(code, purpose) });
  } catch (err) {
    console.error('[email] code failed for', email, err.message);
    await q.run('UPDATE login_codes SET used = 1 WHERE id = ?', row.id);
    return "We couldn't send the email just now. Try again in a minute.";
  }
  return null;
}

/** Check a code and use it up. Returns { payload } on success or { error }. */
async function useCode(email, purpose, code) {
  const row = await q.get('SELECT * FROM login_codes WHERE email = ? AND purpose = ? AND used = 0 ORDER BY id DESC LIMIT 1', email, purpose);
  if (!row || row.expires_at < new Date().toISOString()) return { error: 'That code has expired. Ask for a new one.' };
  const tried = await q.get('UPDATE login_codes SET attempts = attempts + 1 WHERE id = ? AND used = 0 AND attempts < ? RETURNING attempts', row.id, MAX_TRIES);
  if (!tried) return { error: 'Too many wrong tries. Ask for a new code.' };
  if (!/^\d{6}$/.test(code) || !same(hashCode(row.salt, code), row.code_hash)) {
    const left = MAX_TRIES - tried.attempts;
    return { error: left > 0 ? `That code isn't right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many wrong tries. Ask for a new code.' };
  }
  const claimed = await q.run('UPDATE login_codes SET used = 1 WHERE id = ? AND used = 0', row.id);
  if (!claimed.affectedRows) return { error: 'That code was already used. Ask for a new one.' };
  return { payload: JSON.parse(row.payload || '{}') };
}

/* Ask for a code. mode: 'login' (existing account) or 'register' (new account: needs a name). */
r.post('/auth/code/request', async (req, res) => {
  if (!emailEnabled()) return needEmail(res);
  if (limited(`code:${req.ip}`)) return tooMany(res);
  const email = cleanEmail(req.body.email);
  if (!emailRe.test(email)) return res.status(400).json({ error: 'Enter a valid email' });

  if (req.body.mode === 'register') {
    const name = String(req.body.name || '').trim();
    if (!name || name.length > 40) return res.status(400).json({ error: 'Enter your name (up to 40 characters)' });
    if (await q.get('SELECT id FROM users WHERE email = ?', email)) return res.status(409).json({ error: 'An account with that email already exists. Sign in instead.' });
    const err = await issueCode(email, 'register', { name, inviteCode: String(req.body.inviteCode || '').trim().slice(0, 20) });
    return err ? res.status(429).json({ error: err }) : res.json({ ok: true });
  }

  // Sign in: the answer is the same whether or not the address has an account, so this can't be used to look people up.
  if (await q.get('SELECT id FROM users WHERE email = ?', email)) {
    const err = await issueCode(email, 'login');
    if (err) return res.status(429).json({ error: err });
  }
  res.json({ ok: true });
});

/* Enter the code. */
r.post('/auth/code/verify', async (req, res) => {
  if (!emailEnabled()) return needEmail(res);
  if (limited(`verify:${req.ip}`, 60)) return tooMany(res);
  const email = cleanEmail(req.body.email);
  const code = String(req.body.code || '').replace(/\s/g, '');
  const register = req.body.mode === 'register';

  const used = await useCode(email, register ? 'register' : 'login', code);
  if (used.error) return res.status(400).json({ error: used.error });

  if (register) {
    if (await q.get('SELECT id FROM users WHERE email = ?', email)) return res.status(409).json({ error: 'An account with that email already exists. Sign in instead.' });
    const { n } = await q.get('SELECT COUNT(*)::int AS n FROM users');
    let user;
    try {
      user = await q.get('INSERT INTO users (name, email, password_hash, color) VALUES (?, ?, NULL, ?) RETURNING *', used.payload.name, email, COLORS[n % COLORS.length]);
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'An account with that email already exists. Sign in instead.' });
      throw e;
    }
    if (used.payload.inviteCode) await joinHousehold(user, used.payload.inviteCode);
    const token = setSession(res, user.id);
    return res.status(201).json({ user: publicUser(await q.get('SELECT * FROM users WHERE id = ?', user.id)), token });
  }

  const user = await q.get('SELECT * FROM users WHERE email = ?', email);
  if (!user) return res.status(400).json({ error: 'That code has expired. Ask for a new one.' });
  const token = setSession(res, user.id);
  res.json({ user: publicUser(user), token });
});

/* Forgot your password: email a code, then choose a new password with it. */
r.post('/auth/password-reset/request', async (req, res) => {
  if (!emailEnabled()) return needEmail(res);
  if (limited(`pwreq:${req.ip}`)) return tooMany(res);
  const email = cleanEmail(req.body.email);
  if (!emailRe.test(email)) return res.status(400).json({ error: 'Enter a valid email' });
  if (await q.get('SELECT id FROM users WHERE email = ?', email)) {
    const err = await issueCode(email, 'reset');
    if (err) return res.status(429).json({ error: err });
  }
  res.json({ ok: true });
});

r.post('/auth/password-reset/confirm', async (req, res) => {
  if (!emailEnabled()) return needEmail(res);
  if (limited(`pwconf:${req.ip}`, 60)) return tooMany(res);
  const email = cleanEmail(req.body.email);
  const password = String(req.body.password || '');
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const used = await useCode(email, 'reset', String(req.body.code || '').replace(/\s/g, ''));
  if (used.error) return res.status(400).json({ error: used.error });
  const user = await q.get('SELECT * FROM users WHERE email = ?', email);
  if (!user) return res.status(400).json({ error: 'That code has expired. Ask for a new one.' });
  await q.run('UPDATE users SET password_hash = ? WHERE id = ?', await bcrypt.hash(password, 10), user.id);
  const token = setSession(res, user.id);
  res.json({ user: publicUser(await q.get('SELECT * FROM users WHERE id = ?', user.id)), token });
});

export default r;
