import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { q } from '../db.js';
import { setSession, clearSession, publicUser, requireUser, requireHousehold, resetToken, verifyResetToken, resetTokenUserId } from '../auth.js';
import { balancesFor } from '../balances.js';
import { notify, logActivity, emailEnabled } from '../notify.js';

const r = Router();
// Ink tones that read on the ledger-paper background (kept in sync with client INK_COLORS).
const COLORS = ['#3b5b92', '#9a3d63', '#2f7a55', '#9a6a1c', '#2b7f8f', '#6a4c93', '#a8452d', '#5a6b2e'];
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Best-effort in-memory rate limit (per server instance) for auth endpoints.
const attempts = new Map();
function limited(key) {
  const now = Date.now();
  const list = (attempts.get(key) || []).filter((t) => now - t < 15 * 60 * 1000);
  list.push(now);
  attempts.set(key, list);
  return list.length > 20;
}

const getUser = (id) => q.get('SELECT * FROM users WHERE id = ?', id);

r.post('/auth/register', async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (limited(`reg:${req.ip}`)) return res.status(429).json({ error: 'Too many attempts — try again in a few minutes' });
  if (!name || name.length > 40) return res.status(400).json({ error: 'Enter your name (up to 40 characters)' });
  if (!emailRe.test(email)) return res.status(400).json({ error: 'Enter a valid email' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (await q.get('SELECT id FROM users WHERE email = ?', email)) return res.status(409).json({ error: 'An account with that email already exists' });

  const hash = await bcrypt.hash(password, 10);
  const { n } = await q.get('SELECT COUNT(*)::int AS n FROM users');
  let user;
  try {
    user = await q.get('INSERT INTO users (name, email, password_hash, color) VALUES (?, ?, ?, ?) RETURNING *', name, email, hash, COLORS[n % COLORS.length]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'An account with that email already exists' });
    throw e;
  }

  if (req.body.inviteCode) await joinHousehold(user, String(req.body.inviteCode)); // optional at signup
  const token = setSession(res, user.id);
  res.status(201).json({ user: publicUser(await getUser(user.id)), token });
});

r.post('/auth/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (limited(`login:${req.ip}:${email}`)) return res.status(429).json({ error: 'Too many attempts — try again in a few minutes' });
  const user = await q.get('SELECT * FROM users WHERE email = ?', email);
  const ok = user && (await bcrypt.compare(String(req.body.password || ''), user.password_hash));
  if (!ok) return res.status(401).json({ error: 'Email or password is incorrect' });
  const token = setSession(res, user.id);
  res.json({ user: publicUser(user), token });
});

r.post('/auth/logout', (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

r.get('/me', async (req, res) => {
  if (!req.user) return res.json({ user: null, household: null });
  res.json({ user: publicUser(req.user), household: await householdPayload(req.user.household_id), emailEnabled: emailEnabled() });
});

r.patch('/me', requireUser, async (req, res) => {
  const u = req.user;
  const name = req.body.name != null ? String(req.body.name).trim() : u.name;
  if (!name || name.length > 40) return res.status(400).json({ error: 'Enter your name (up to 40 characters)' });
  let hash = u.password_hash;
  if (req.body.newPassword) {
    if (String(req.body.newPassword).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    if (!(await bcrypt.compare(String(req.body.currentPassword || ''), u.password_hash)))
      return res.status(400).json({ error: 'Current password is incorrect' });
    hash = await bcrypt.hash(String(req.body.newPassword), 10);
  }
  const color = /^#[0-9a-f]{6}$/i.test(req.body.color || '') ? req.body.color : u.color;
  const emailNotifications = req.body.emailNotifications != null ? (req.body.emailNotifications ? 1 : 0) : u.email_notifications;
  // Where roommates should send money (Interac e-Transfer email or phone). Shown to housemates only.
  const etransfer = req.body.etransfer != null ? String(req.body.etransfer).trim().slice(0, 120) : u.etransfer || '';
  await q.run('UPDATE users SET name=?, color=?, email_notifications=?, password_hash=?, etransfer=? WHERE id=?', name, color, emailNotifications, hash, etransfer, u.id);
  res.json({ user: publicUser(await getUser(u.id)) });
});

/* ---------- Password reset without email: a roommate makes a one-time link ---------- */

r.post('/household/members/:id/reset-link', requireHousehold, async (req, res) => {
  const target = await q.get('SELECT * FROM users WHERE id = ? AND household_id = ?', Number(req.params.id), req.user.household_id);
  if (!target) return res.status(404).json({ error: 'That person is not in your house' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'Change your own password in Settings instead' });
  await notify([target.id], {
    type: 'account',
    title: `${req.user.name} made a password reset link for you`,
    body: "If you didn't ask for this, you can ignore it. The link stops working once your password changes.",
    link: '/settings',
  });
  res.json({ path: `/reset?token=${encodeURIComponent(resetToken(target))}`, name: target.name, expiresInDays: 3 });
});

r.get('/auth/reset-info', async (req, res) => {
  const token = String(req.query.token || '');
  const user = await q.get('SELECT * FROM users WHERE id = ?', resetTokenUserId(token) || 0);
  if (!verifyResetToken(token, user)) return res.status(400).json({ error: 'This reset link has expired or was already used. Ask a roommate for a new one.' });
  res.json({ name: user.name, email: user.email });
});

r.post('/auth/reset', async (req, res) => {
  const token = String(req.body.token || '');
  const password = String(req.body.password || '');
  if (limited(`reset:${req.ip}`)) return res.status(429).json({ error: 'Too many attempts — try again in a few minutes' });
  const user = await q.get('SELECT * FROM users WHERE id = ?', resetTokenUserId(token) || 0);
  if (!verifyResetToken(token, user)) return res.status(400).json({ error: 'This reset link has expired or was already used. Ask a roommate for a new one.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  await q.run('UPDATE users SET password_hash = ? WHERE id = ?', await bcrypt.hash(password, 10), user.id);
  const sessionTok = setSession(res, user.id);
  res.json({ user: publicUser(user), token: sessionTok });
});

/* ---------- Moving out: leave, or remove someone who has left (only when settled up) ---------- */

r.post('/household/members/:id/remove', requireHousehold, async (req, res) => {
  const hid = req.user.household_id;
  const target = await q.get('SELECT * FROM users WHERE id = ? AND household_id = ?', Number(req.params.id), hid);
  if (!target) return res.status(404).json({ error: 'That person is not in your house' });
  const owing = (await balancesFor(hid, target.id)).people.filter((p) => p.balanceCents !== 0);
  if (owing.length) {
    const list = owing.map((p) => `${p.user.name} (${p.balanceCents > 0 ? 'owes them' : 'is owed'} $${(Math.abs(p.balanceCents) / 100).toFixed(2)})`).join(', ');
    return res.status(409).json({ error: `${target.id === req.user.id ? 'You need' : `${target.name} needs`} to settle up first: ${list}.` });
  }
  await q.run('UPDATE users SET household_id = NULL, former_household_id = ? WHERE id = ?', hid, target.id);
  // Stop repeating bills that include them (they'd fail anyway once they've left).
  for (const rb of await q.all('SELECT id, template FROM recurring_bills WHERE household_id = ? AND active = 1', hid)) {
    const t = JSON.parse(rb.template);
    if (Number(t.paidBy) === target.id || (t.participants || []).some((x) => Number(x.userId) === target.id)) {
      await q.run('UPDATE recurring_bills SET active = 0 WHERE id = ?', rb.id);
    }
  }
  const self = target.id === req.user.id;
  await logActivity(hid, req.user.id, 'member.left', self ? `${target.name} moved out` : `${req.user.name} removed ${target.name} from the house`);
  const others = (await q.all('SELECT id FROM users WHERE household_id = ?', hid)).map((u) => u.id).filter((id) => id !== req.user.id);
  await notify(self ? others : [...others, target.id], {
    type: 'member',
    title: self ? `${target.name} moved out` : `${target.name} was removed from the house`,
    body: 'Their past bills stay in the ledger. Repeating bills that included them were stopped, so re-add those for the people still living there.',
    link: '/bills',
  });
  res.json({ ok: true, household: self ? null : await householdPayload(hid) });
});

const newCode = () => crypto.randomBytes(4).toString('hex').toUpperCase();

async function householdPayload(id) {
  if (!id) return null;
  const h = await q.get('SELECT * FROM households WHERE id = ?', id);
  const members = await q.all('SELECT id, name, email, color, etransfer FROM users WHERE household_id = ? ORDER BY id', id);
  // People who moved out: kept so old bills and the ledger still show their names.
  const formerMembers = await q.all('SELECT id, name, color FROM users WHERE former_household_id = ? AND household_id IS DISTINCT FROM ? ORDER BY id', id, id);
  return { id: h.id, name: h.name, inviteCode: h.invite_code, currency: h.currency, members, formerMembers };
}

async function joinHousehold(user, code) {
  const h = await q.get('SELECT * FROM households WHERE invite_code = ?', code.trim().toUpperCase());
  if (!h) return null;
  const others = (await q.all('SELECT id FROM users WHERE household_id = ?', h.id)).map((m) => m.id);
  await q.run('UPDATE users SET household_id = ? WHERE id = ?', h.id, user.id);
  await logActivity(h.id, user.id, 'member.joined', `${user.name} joined the house`);
  await notify(others, { type: 'member', title: `${user.name} joined ${h.name}`, body: 'You can now split bills with them.', link: '/' });
  return h;
}

r.post('/household', requireUser, async (req, res) => {
  if (req.user.household_id) return res.status(409).json({ error: 'You are already in a household' });
  const name = String(req.body.name || '').trim() || 'Our place';
  const currency = /^[A-Z]{3}$/.test(req.body.currency || '') ? req.body.currency : 'CAD';
  const h = await q.get('INSERT INTO households (name, invite_code, currency) VALUES (?, ?, ?) RETURNING id', name.slice(0, 60), newCode(), currency);
  await q.run('UPDATE users SET household_id = ? WHERE id = ?', h.id, req.user.id);
  await logActivity(h.id, req.user.id, 'household.created', `${req.user.name} created ${name}`);
  res.status(201).json({ household: await householdPayload(h.id) });
});

r.post('/household/join', requireUser, async (req, res) => {
  if (req.user.household_id) return res.status(409).json({ error: 'You are already in a household' });
  const h = await joinHousehold(req.user, String(req.body.code || ''));
  if (!h) return res.status(404).json({ error: 'No household found with that code' });
  res.json({ household: await householdPayload(h.id) });
});

r.patch('/household', requireHousehold, async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (name) await q.run('UPDATE households SET name = ? WHERE id = ?', name.slice(0, 60), req.user.household_id);
  if (req.body.regenerateCode) await q.run('UPDATE households SET invite_code = ? WHERE id = ?', newCode(), req.user.household_id);
  res.json({ household: await householdPayload(req.user.household_id) });
});

export default r;
