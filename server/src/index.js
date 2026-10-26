// Local / self-hosted entry point: `npm start`. On Vercel, /api/index.js imports app.js instead.
import app from './app.js';
import { init } from './db.js';
import { runRecurring } from './recurring.js';

await init();
await runRecurring().catch((e) => console.error('[recurring]', e));
setInterval(() => runRecurring().catch((e) => console.error('[recurring]', e)), 60 * 60 * 1000).unref();

const PORT = Number(process.env.PORT || 3001);
app.listen(PORT, () => console.log(`Hearth listening on http://localhost:${PORT}`));
