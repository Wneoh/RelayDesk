import { createDatabase } from './db.js';
import { createApp } from './app.js';
import { config } from './config.js';
const db = createDatabase();
await db.query('SELECT 1');
const { server, io, stopBackground } = createApp(db);
server.listen(config.port, process.env.HOST || '127.0.0.1', () =>
  console.log(`RelayDesk API http://localhost:${config.port}`),
);
async function shutdown() {
  await stopBackground();
  await new Promise<void>((resolve) => io.close(() => resolve()));

  await db.close();
  process.exit(0);
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
