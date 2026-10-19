import { PGlite } from '@electric-sql/pglite';
import type { Database, Queryable } from './db.js';
// An actual PostgreSQL engine in WASM for the local demo and fast integration tests.
// Production and CI's concurrent-claim test use a PostgreSQL server through node-postgres.
export async function embeddedDatabase(path?: string): Promise<Database> {
  const pg = new PGlite(path);
  await pg.waitReady;
  const adapt = (client: { query: Function }): Queryable => ({
    query: async (text, values) => {
      // PostgreSQL advisory locks are unnecessary in a single-process embedded engine.
      if (text.startsWith('SELECT pg_advisory_xact_lock')) return { rows: [], rowCount: 0 };
      // PGlite's extended protocol accepts one statement; migrations use exec for batches.
      if (!values && text.includes(';')) {
        await (client as any).exec(text);
        return { rows: [], rowCount: 0 };
      }
      const result = await client.query(text, values);
      return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
    },
  });
  return {
    ...adapt(pg),
    transaction: (fn) => pg.transaction((tx) => fn(adapt(tx))),
    close: () => pg.close(),
  };
}
