import nodemailer from 'nodemailer';
import { q } from './db.js';

let transport = null;
if (process.env.SMTP_HOST) {
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === '1',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
}
const FROM = process.env.MAIL_FROM || 'Hearth <no-reply@hearth.local>';
export const APP_URL =
  process.env.APP_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:5173');

export const emailEnabled = () => !!transport;

/**
 * Save an in-app notification for each recipient and email those who opted in.
 * Email failures never fail the request: the in-app copy is the source of truth.
 * Emails are awaited (with a timeout) because serverless functions freeze once they respond.
 */
export async function notify(userIds, { type, title, body = '', link = null }) {
  const unique = [...new Set(userIds)];
  if (!unique.length) return;
  const insert = 'INSERT INTO notifications (user_id, type, title, body, link) VALUES (?, ?, ?, ?, ?)';
  for (const uid of unique) await q.run(insert, uid, type, title, body, link);

  const users = await q.all('SELECT id, email, name, email_notifications FROM users WHERE id = ANY(?::int[])', unique);
  const recipients = users.filter((u) => u.email_notifications);

  await Promise.allSettled(
    recipients.map((r) => {
      const text = `Hi ${r.name},\n\n${title}\n${body}\n\nOpen Hearth: ${APP_URL}${link || ''}`;
      if (!transport) {
        if (process.env.NODE_ENV !== 'test') console.log(`[email:dev] to=${r.email} subject="${title}"`);
        return null;
      }
      const send = transport.sendMail({ from: FROM, to: r.email, subject: title, text, html: emailHtml(r.name, title, body, `${APP_URL}${link || ''}`) });
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timed out')), 4000));
      return Promise.race([send, timeout]).catch((err) => console.error('[email] failed for', r.email, err.message));
    })
  );
}

export async function logActivity(householdId, userId, action, summary) {
  await q.run('INSERT INTO activity (household_id, user_id, action, summary) VALUES (?, ?, ?, ?)', householdId, userId, action, summary);
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function emailHtml(name, title, body, url) {
  return `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;padding:24px;color:#1d1b26">
  <p style="color:#6b6880;margin:0 0 8px">Hi ${esc(name)},</p>
  <h2 style="margin:0 0 8px;font-size:20px">${esc(title)}</h2>
  <p style="margin:0 0 20px;line-height:1.5">${esc(body)}</p>
  <a href="${esc(url)}" style="display:inline-block;background:#6d5efc;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:600">Open Hearth</a>
</div>`;
}
