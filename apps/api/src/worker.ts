import type { Database } from './db.js';
import { createDatabase } from './db.js';
import { pathToFileURL } from 'node:url';
export async function checkDeadlines(db: Database) {
  return db.transaction(async (tx) => {
    const result = await tx.query(`INSERT INTO notifications(ticket_id,user_id,kind,body)
      SELECT t.id,u.id,'first_response_overdue','Ticket #'||t.number||' is waiting for its first response: '||t.subject
      FROM tickets t JOIN users u ON u.role IN ('support','admin')
      WHERE t.deleted_at IS NULL AND t.first_response_at IS NULL AND t.status<>'resolved' AND t.response_due_at<now()
      ON CONFLICT(ticket_id,user_id,kind) DO NOTHING RETURNING id`);
    await tx.query('DELETE FROM sessions WHERE expires_at<now()');
    return result.rows.length;
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = createDatabase();
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const n = await checkDeadlines(db);
      if (n) console.log(`Created ${n} overdue alerts.`);
    } catch (error) {
      console.error('Deadline scan failed:', error);
    } finally {
      running = false;
    }
  };
  await tick();
  const timer = setInterval(tick, 60000);
  console.log('RelayDesk deadline worker running (60-second scans).');
  const stop = async () => {
    clearInterval(timer);
    await db.close();
    process.exit(0);
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
