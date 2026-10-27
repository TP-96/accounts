// The Express app, shared by the local server (index.js) and Vercel (/api/index.js).
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { q, init } from './db.js';
import { loadUser, requireUser, requireHousehold, downloadToken } from './auth.js';
import accountRoutes from './routes/account.js';
import codeRoutes from './routes/codes.js';
import moneyRoutes from './routes/money.js';
import extraRoutes from './routes/extras.js';
import { runRecurring } from './recurring.js';
import { buildWorkbook } from './export.js';

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

/*
 * CORS for the iOS/Android apps. Capacitor serves the app from these local
 * origins and talks to the hosted API with a Bearer token (no cookies).
 * Extra origins can be added with CORS_ORIGINS="https://a.com,https://b.com".
 */
const ALLOWED_ORIGINS = new Set([
  'capacitor://localhost',
  'ionic://localhost',
  'https://localhost',
  'http://localhost',
  ...(process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
]);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

const api = express.Router();
api.use(async (_req, res, next) => {
  try {
    await init(); // connect + create tables on cold start
  } catch (err) {
    console.error('[db] connection failed:', err.message);
    const missing = process.env.VERCEL && !process.env.DATABASE_URL && !process.env.POSTGRES_URL;
    return res.status(503).json({
      error: missing
        ? 'Database not connected yet. In Vercel, open Storage, add a Neon Postgres database to this project, then redeploy.'
        : "Can't reach the database right now. Try again in a moment.",
    });
  }
  next();
});
api.use(loadUser);
api.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

api.get('/health', async (_req, res) => {
  await q.get('SELECT 1 AS ok');
  res.json({ ok: true });
});

// Vercel Cron calls this daily (see vercel.json). Protected by CRON_SECRET when set.
api.get('/cron/recurring', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });
  res.json({ created: await runRecurring() });
});

api.use(accountRoutes);
api.use(codeRoutes);

api.get('/notifications', requireUser, async (req, res) => {
  const rows = await q.all('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 100', req.user.id);
  const { n } = await q.get('SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', req.user.id);
  res.json({
    unread: n,
    notifications: rows.map((x) => ({ id: x.id, type: x.type, title: x.title, body: x.body, link: x.link, read: !!x.read_at, createdAt: x.created_at })),
  });
});
api.post('/notifications/read', requireUser, async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : null;
  if (ids?.length) {
    await q.run('UPDATE notifications SET read_at = now_iso() WHERE id = ANY(?::int[]) AND user_id = ? AND read_at IS NULL', ids, req.user.id);
  } else {
    await q.run('UPDATE notifications SET read_at = now_iso() WHERE user_id = ? AND read_at IS NULL', req.user.id);
  }
  res.json({ ok: true });
});

// The mobile app can't attach its token to a plain download, so it asks for a 2-minute link.
api.post('/export-link', requireHousehold, (req, res) => {
  res.json({ path: `/api/export.xlsx?dl=${encodeURIComponent(downloadToken(req.user.id))}` });
});

api.get('/export.xlsx', requireHousehold, async (req, res) => {
  const wb = await buildWorkbook(req.user.household_id, req.user.id);
  const stamp = new Date().toISOString().slice(0, 10);
  const buffer = await wb.xlsx.writeBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="hearth-transactions-${stamp}.xlsx"`);
  res.send(Buffer.from(buffer));
});

api.use(extraRoutes); // before moneyRoutes so /bills-deleted etc. aren't read as a bill id
api.use(moneyRoutes);
api.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use('/api', api);

// Serve the built web app when running as a normal Node server (Vercel serves it from its CDN instead).
const here = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(here, '../../client/dist');
if (!process.env.VERCEL && fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our end' });
});

export default app;
