import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { embeddedDatabase } from './embedded.js';
import { migrate } from './migrate.js';
import { seed } from './seed.js';
import { createApp } from './app.js';
import { checkDeadlines } from './worker.js';
import { config } from './config.js';
if (config.production)
  throw new Error(
    'The embedded demo is for local development only. Use PostgreSQL and npm start in production.',
  );
config.demo = true;
if (!process.env.AI_MODE && !config.openaiKey) config.aiMode = 'demo';
const directory = fileURLToPath(new URL('../../../.local/ai-postgres', import.meta.url));
await mkdir(directory, { recursive: true });
const db = await embeddedDatabase(directory).catch((error) => {
  console.error('Embedded database startup failed:', error.message);
  process.exit(1);
});
await migrate(db);
await seed(db);
await checkDeadlines(db);
const { server, io, stopBackground } = createApp(db);
server.listen(config.port, '127.0.0.1', () =>
  console.log(`RelayDesk local demo API http://localhost:${config.port}`),
);
const timer = setInterval(() => {
  void checkDeadlines(db).catch(console.error);
}, 60000);
const stop = async () => {
  clearInterval(timer);
  await stopBackground();
  await new Promise<void>((resolve) => io.close(() => resolve()));

  await db.close();
  process.exit(0);
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
