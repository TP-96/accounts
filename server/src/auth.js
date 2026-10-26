import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, DATABASE_URL, q } from './db.js';

/**
 * Signing secret, in order of preference:
 *  1. JWT_SECRET env var
 *  2. derived from DATABASE_URL (already secret, unique per deployment, so Vercel needs no extra setup)
 *  3. random secret saved under DATA_DIR (local dev)
 */
function loadSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (DATABASE_URL) return crypto.createHash('sha256').update(`hearth-session:${DATABASE_URL}`).digest('hex');
  const file = path.join(DATA_DIR, '.jwt-secret');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(48).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(file, 'utf8').trim();
}
const SECRET = loadSecret();
const COOKIE = 'hearth_session';
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;

export const sessionToken = (userId) => jwt.sign({ uid: userId }, SECRET, { expiresIn: '30d' });

/**
 * Web: httpOnly cookie. Native apps: they read the returned token and send it as
 * `Authorization: Bearer <token>` (cookies don't work across the app/API origins).
 */
export function setSession(res, userId) {
  const token = sessionToken(userId);
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: !!res.req?.secure, // true behind HTTPS (Vercel), false on http://<LAN-IP> at home
    maxAge: MAX_AGE_MS,
  });
  return token;
}

export function clearSession(res) {
  res.clearCookie(COOKIE);
}

/**
 * One-time password reset link token, made by a roommate. It embeds a fingerprint of
 * the current password hash, so it stops working the moment the password changes.
 */
const fingerprint = (hash) => crypto.createHash('sha256').update(hash).digest('hex').slice(0, 16);
export const resetToken = (user) => jwt.sign({ uid: user.id, purpose: 'reset', fp: fingerprint(user.password_hash) }, SECRET, { expiresIn: '3d' });
export function verifyResetToken(token, user) {
  try {
    const p = jwt.verify(token, SECRET);
    return p.purpose === 'reset' && p.uid === user?.id && p.fp === fingerprint(user.password_hash);
  } catch {
    return false;
  }
}
export function resetTokenUserId(token) {
  try {
    const p = jwt.decode(token);
    return p?.purpose === 'reset' ? p.uid : null;
  } catch {
    return null;
  }
}

/** Short-lived token for a one-off download link (Excel export from the mobile app). */
export const downloadToken = (userId) => jwt.sign({ uid: userId, purpose: 'export' }, SECRET, { expiresIn: '2m' });

export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    color: u.color,
    householdId: u.household_id,
    emailNotifications: !!u.email_notifications,
    etransfer: u.etransfer || '',
  };
}

/** Attaches req.user from a Bearer token, a ?dl= download token, or the session cookie. */
export async function loadUser(req, _res, next) {
  req.user = null;
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
  const download = typeof req.query?.dl === 'string' ? req.query.dl : null;
  const token = bearer || req.cookies?.[COOKIE];
  try {
    let uid = null;
    if (download) {
      const p = jwt.verify(download, SECRET);
      if (p.purpose === 'export') uid = p.uid;
    } else if (token) {
      const p = jwt.verify(token, SECRET);
      if (!p.purpose) uid = p.uid;
    }
    if (uid) req.user = (await q.get('SELECT * FROM users WHERE id = ?', uid)) || null;
  } catch {
    req.user = null;
  }
  next();
}

export function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in' });
  next();
}

export function requireHousehold(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in' });
  if (!req.user.household_id) return res.status(409).json({ error: 'Join or create a household first' });
  next();
}
