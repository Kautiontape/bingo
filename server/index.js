import { serve } from '@hono/node-server';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createBoards } from './boards.js';
import { createHub } from './events.js';
import { createApp } from './routes.js';

const port = Number(process.env.PORT ?? 3000);
const dbFile = process.env.DATABASE_URL ?? fileURLToPath(new URL('../data/bingo.db', import.meta.url));
const publicDir = fileURLToPath(new URL('../public', import.meta.url));

const db = openDb(dbFile);
const hub = createHub();
const boards = createBoards(db, { publish: hub.publish });
const app = createApp({ boards, hub, publicDir, publicUrl: process.env.PUBLIC_URL ?? '' });

const housekeeping = () => {
  const gone = boards.sweep();
  if (gone) console.log(`swept ${gone} idle board(s)`);
  app.prune();
};
housekeeping();
setInterval(housekeeping, 3_600_000).unref();

const server = serve({ fetch: app.fetch, port }, (info) => console.log(`bingo listening on :${info.port}`));

// Open event streams would hold server.close() forever, so exit once the database is closed.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close();
    db.close();
    process.exit(0);
  });
}
