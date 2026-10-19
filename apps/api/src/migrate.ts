import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createDatabase, type Database } from './db.js';
export async function migrate(db: Database) {
  await db.query(
    'CREATE TABLE IF NOT EXISTS migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())',
  );
  const directory = fileURLToPath(new URL('../../../database/migrations/', import.meta.url));
  for (const name of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) {
    await db.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(872901)');
      if ((await tx.query('SELECT name FROM migrations WHERE name=$1', [name])).rows.length) return;
      await tx.query(await readFile(`${directory}/${name}`, 'utf8'));
      await tx.query('INSERT INTO migrations(name) VALUES($1)', [name]);
    });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = createDatabase();
  try {
    await migrate(db);
    console.log('Database migrations applied.');
  } finally {
    await db.close();
  }
}
