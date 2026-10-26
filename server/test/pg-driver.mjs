// Runs the API test suite through the node-postgres driver (the code path used on Vercel/Neon),
// against PGlite exposed as a real Postgres server on a local socket.
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { spawn } from 'node:child_process';

const db = await PGlite.create();
const server = new PGLiteSocketServer({ db, port: 54329, host: '127.0.0.1' });
await server.start();
const child = spawn(process.execPath, ['--no-warnings', '--test', 'test/api.test.js'], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: 'postgres://postgres:postgres@127.0.0.1:54329/postgres', PG_POOL_MAX: '1', DB_MEMORY: '' },
});
child.on('exit', async (code) => {
  await server.stop();
  await db.close();
  process.exit(code);
});
