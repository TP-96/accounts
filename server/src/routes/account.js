import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { q } from '../db.js';
import { setSession, clearSession, publicUser, requireUser, requireHousehold } from '../auth.js';
import { balancesFor } from '../balances.js';
import { notify, logActivity, emailEnabled } from '../notify.js';

const r = Router();
// Ink tones that read on the ledger-paper background (kept in sync with client INK_COLORS).
export const HOUSE_COLORS = ['#2f7a55', '#3b5b92', '#9a3d63', '#9a6a1c', '#2b7f8f', '#6a4c93', '#a8452d', '#5a6b2e'];
export const COLORS = ['#3b5b92', '#9a3d63', '#2f7a55', '#9a6a1c', '#2b7f8f', '#6a4c93', '#a8452d', '#5a6b2e'];
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
  // With email set up, new accounts are made with an emailed code (see routes/codes.js) so every address is verified.
  if (emailEnabled()) return res.status(400).json({ error: 'Create your account with the email code option' });
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
  const ok = user && user.password_hash && (await bcrypt.compare(String(req.body.password || ''), user.password_hash));
  if (!ok) return res.status(401).json({ error: 'Email or password is incorrect' });
  const token = setSession(res, user.id);
  res.json({ user: publicUser(user), token });
});

r.post('/auth/logout', (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

r.get('/me', async (req, res) => {
  if (!req.user) return res.json({ user: null, household: null, emailEnabled: emailEnabled() });
  res.json({
    user: publicUser(req.user),
    household: await householdPayload(req.user.household_id),
    households: await myHouseholds(req.user.id),
    emailEnabled: emailEnabled(),
  });
});

r.patch('/me', requireUser, async (req, res) => {
  const u = req.user;
  const name = req.body.name != null ? String(req.body.name).trim() : u.name;
  if (!name || name.length > 40) return res.status(400).json({ error: 'Enter your name (up to 40 characters)' });
  let hash = u.password_hash;
  if (req.body.newPassword) {
    if (String(req.body.newPassword).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    // Accounts made with an emailed code have no password yet, so they can add one without a "current" one.
    if (u.password_hash && !(await bcrypt.compare(String(req.body.currentPassword || ''), u.password_hash)))
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

/* ---------- Moving out: leave, or remove someone who has left (only when settled up) ---------- */

r.post('/household/members/:id/remove', requireHousehold, async (req, res) => {
  const hid = req.user.household_id;
  const target = await q.get(
    'SELECT u.* FROM users u JOIN household_members m ON m.user_id = u.id WHERE u.id = ? AND m.household_id = ? AND m.left_at IS NULL',
    Number(req.params.id), hid
  );
  if (!target) return res.status(404).json({ error: 'That person is not in your house' });
  if (target.id !== req.user.id && !(await isAdmin(hid, req.user.id))) return adminOnly(res, 'remove a roommate');
  const owing = (await balancesFor(hid, target.id)).people.filter((p) => p.balanceCents !== 0);
  if (owing.length) {
    const list = owing.map((p) => `${p.user.name} (${p.balanceCents > 0 ? 'owes them' : 'is owed'} $${(Math.abs(p.balanceCents) / 100).toFixed(2)})`).join(', ');
    return res.status(409).json({ error: `${target.id === req.user.id ? 'You need' : `${target.name} needs`} to settle up first: ${list}.` });
  }
  await q.run("UPDATE household_members SET left_at = now_iso(), role = 'member' WHERE user_id = ? AND household_id = ?", target.id, hid);
  const promoted = await ensureAdmin(hid);
  if (promoted) {
    const who = await q.get('SELECT name FROM users WHERE id = ?', promoted);
    await logActivity(hid, promoted, 'member.admin', `${who.name} is now the house admin`);
    await notify([promoted], { type: 'member', title: `You're now an admin of this house`, body: `${target.name} left, so you can now manage the house's settings and fix anyone's bills.`, link: '/settings?s=house', householdId: hid });
  }
  // If that was the house they last used, point them at another one they still belong to (or none).
  await q.run(
    `UPDATE users SET household_id = (SELECT household_id FROM household_members WHERE user_id = ? AND left_at IS NULL ORDER BY joined_at LIMIT 1)
      WHERE id = ? AND household_id IS NOT DISTINCT FROM ?`,
    target.id, target.id, hid
  );
  // Stop repeating bills that include them (they'd fail anyway once they've left).
  for (const rb of await q.all('SELECT id, template FROM recurring_bills WHERE household_id = ? AND active = 1', hid)) {
    const t = JSON.parse(rb.template);
    if (Number(t.paidBy) === target.id || (t.participants || []).some((x) => Number(x.userId) === target.id)) {
      await q.run('UPDATE recurring_bills SET active = 0 WHERE id = ?', rb.id);
    }
  }
  const self = target.id === req.user.id;
  await logActivity(hid, req.user.id, 'member.left', self ? `${target.name} moved out` : `${req.user.name} removed ${target.name} from the house`);
  const others = (await q.all('SELECT id FROM active_members WHERE household_id = ?', hid)).map((u) => u.id).filter((id) => id !== req.user.id);
  await notify(self ? others : [...others, target.id], {
    type: 'member',
    title: self ? `${target.name} moved out` : `${target.name} was removed from the house`,
    body: 'Their past bills stay in the ledger. Repeating bills that included them were stopped, so re-add those for the people still living there.',
    link: '/bills',
    householdId: hid,
  });
  res.json({ ok: true, household: self ? null : await householdPayload(hid) });
});

/** Is this person an admin of this house? */
export async function isAdmin(householdId, userId) {
  return !!(await q.get("SELECT 1 AS ok FROM household_members WHERE household_id = ? AND user_id = ? AND left_at IS NULL AND role = 'admin'", householdId, userId));
}

/** A house always has an admin: if the last one left, the longest-standing roommate takes over. Returns the new admin, if any. */
export async function ensureAdmin(householdId) {
  if (await q.get("SELECT 1 AS ok FROM household_members WHERE household_id = ? AND left_at IS NULL AND role = 'admin'", householdId)) return null;
  const next = await q.get('SELECT user_id FROM household_members WHERE household_id = ? AND left_at IS NULL ORDER BY joined_at, user_id LIMIT 1', householdId);
  if (!next) return null;
  await q.run("UPDATE household_members SET role = 'admin' WHERE household_id = ? AND user_id = ?", householdId, next.user_id);
  return next.user_id;
}

const adminOnly = (res, what) => res.status(403).json({ error: `Only a house admin can ${what}. Ask an admin (shown in Settings → House).` });

const newCode = () => crypto.randomBytes(4).toString('hex').toUpperCase();

/** Every house this person belongs to, for the house switcher (with unread alerts per house). */
async function myHouseholds(userId) {
  return (
    await q.all(
      `SELECT h.id, h.name, h.color,
              (SELECT COUNT(*) FROM household_members x WHERE x.household_id = h.id AND x.left_at IS NULL)::int AS members,
              (SELECT COUNT(*) FROM notifications n WHERE n.user_id = ? AND n.household_id = h.id AND n.read_at IS NULL)::int AS unread
         FROM household_members m JOIN households h ON h.id = m.household_id
        WHERE m.user_id = ? AND m.left_at IS NULL ORDER BY m.joined_at, h.id`,
      userId, userId
    )
  ).map((h) => ({ id: h.id, name: h.name, color: h.color || COLORS[0], members: h.members, unread: h.unread }));
}

async function householdPayload(id) {
  if (!id) return null;
  const h = await q.get('SELECT * FROM households WHERE id = ?', id);
  const members = await q.all('SELECT id, name, email, color, etransfer, role FROM active_members WHERE household_id = ? ORDER BY id', id);
  // People who moved out: kept so old bills and the ledger still show their names.
  const formerMembers = await q.all('SELECT id, name, color FROM former_members WHERE household_id = ? ORDER BY id', id);
  return { id: h.id, name: h.name, color: h.color || COLORS[0], inviteCode: h.invite_code, currency: h.currency, members, formerMembers };
}

export async function joinHousehold(user, code) {
  const h = await q.get('SELECT * FROM households WHERE invite_code = ?', code.trim().toUpperCase());
  if (!h) return null;
  const already = await q.get('SELECT 1 AS ok FROM household_members WHERE user_id = ? AND household_id = ? AND left_at IS NULL', user.id, h.id);
  if (already) return { ...h, already: true };
  const others = (await q.all('SELECT id FROM active_members WHERE household_id = ?', h.id)).map((m) => m.id);
  await q.run(
    `INSERT INTO household_members (user_id, household_id) VALUES (?, ?)
     ON CONFLICT (user_id, household_id) DO UPDATE SET left_at = NULL, joined_at = now_iso(), role = 'member'`,
    user.id, h.id
  );
  await q.run('UPDATE users SET household_id = ? WHERE id = ?', h.id, user.id);
  await ensureAdmin(h.id); // e.g. rejoining a house everyone else has left
  await logActivity(h.id, user.id, 'member.joined', `${user.name} joined the house`);
  await notify(others, { type: 'member', title: `${user.name} joined ${h.name}`, body: 'You can now split bills with them.', link: '/', householdId: h.id });
  return h;
}

// You can belong to several houses. Each new one gets its own accent colour so they're easy to tell apart.
r.post('/household', requireUser, async (req, res) => {
  const name = String(req.body.name || '').trim() || 'Our place';
  const currency = /^[A-Z]{3}$/.test(req.body.currency || '') ? req.body.currency : 'CAD';
  const used = new Set((await myHouseholds(req.user.id)).map((h) => h.color));
  const color = HOUSE_COLORS.find((c) => !used.has(c)) || HOUSE_COLORS[used.size % HOUSE_COLORS.length];
  const h = await q.get('INSERT INTO households (name, invite_code, currency, color) VALUES (?, ?, ?, ?) RETURNING id', name.slice(0, 60), newCode(), currency, color);
  await q.run("INSERT INTO household_members (user_id, household_id, role) VALUES (?, ?, 'admin')", req.user.id, h.id);
  await q.run('UPDATE users SET household_id = ? WHERE id = ?', h.id, req.user.id);
  await logActivity(h.id, req.user.id, 'household.created', `${req.user.name} created ${name}`);
  res.status(201).json({ household: await householdPayload(h.id) });
});

r.post('/household/join', requireUser, async (req, res) => {
  const h = await joinHousehold(req.user, String(req.body.code || ''));
  if (!h) return res.status(404).json({ error: 'No household found with that code' });
  if (h.already) return res.status(409).json({ error: `You're already in ${h.name}` });
  res.json({ household: await householdPayload(h.id) });
});

r.patch('/household', requireHousehold, async (req, res) => {
  if (!(await isAdmin(req.user.household_id, req.user.id))) return adminOnly(res, "change the house's name, colour or invite code");
  const name = String(req.body.name || '').trim();
  if (name) await q.run('UPDATE households SET name = ? WHERE id = ?', name.slice(0, 60), req.user.household_id);
  if (HOUSE_COLORS.includes(req.body.color)) await q.run('UPDATE households SET color = ? WHERE id = ?', req.body.color, req.user.household_id);
  if (req.body.regenerateCode) await q.run('UPDATE households SET invite_code = ? WHERE id = ?', newCode(), req.user.household_id);
  res.json({ household: await householdPayload(req.user.household_id) });
});

/** Admins can make other roommates admins, or step someone back down (a house always keeps at least one). */
r.post('/household/members/:id/role', requireHousehold, async (req, res) => {
  const hid = req.user.household_id;
  if (!(await isAdmin(hid, req.user.id))) return adminOnly(res, 'change who is an admin');
  const role = req.body.role === 'admin' ? 'admin' : 'member';
  const target = await q.get('SELECT u.id, u.name, m.role FROM users u JOIN household_members m ON m.user_id = u.id WHERE u.id = ? AND m.household_id = ? AND m.left_at IS NULL', Number(req.params.id), hid);
  if (!target) return res.status(404).json({ error: 'That person is not in your house' });
  if (role === 'member' && target.role === 'admin') {
    const admins = await q.get("SELECT COUNT(*)::int AS n FROM household_members WHERE household_id = ? AND left_at IS NULL AND role = 'admin'", hid);
    if (admins.n <= 1) return res.status(409).json({ error: 'A house needs at least one admin. Make someone else an admin first.' });
  }
  await q.run('UPDATE household_members SET role = ? WHERE household_id = ? AND user_id = ?', role, hid, target.id);
  if (role !== target.role) {
    await logActivity(hid, req.user.id, 'member.role', role === 'admin' ? `${req.user.name} made ${target.name} an admin` : `${target.name} is no longer an admin`);
    if (target.id !== req.user.id)
      await notify([target.id], {
        type: 'member',
        title: role === 'admin' ? `${req.user.name} made you an admin` : `You're no longer an admin`,
        body: role === 'admin' ? "You can now manage the house's settings, remove roommates and fix anyone's bills." : '',
        link: '/settings?s=house',
        householdId: hid,
      });
  }
  res.json({ household: await householdPayload(hid) });
});

export default r;
