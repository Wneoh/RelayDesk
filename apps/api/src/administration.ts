import type { Database } from './db.js';
import { AppError, publicUser, requireAdmin } from './auth.js';
import { createUserSchema, type User } from '@relaydesk/contracts';
import { hash } from 'bcryptjs';
import { z } from 'zod';
export async function createWorkspaceUser(db: Database, user: User, input: unknown) {
  requireAdmin(user);
  const data = createUserSchema.parse(input);
  const passwordHash = await hash(data.password, 12);
  try {
    return publicUser(
      (
        await db.query(
          'INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,name,email,role',
          [data.name, data.email, passwordHash, data.role],
        )
      ).rows[0],
    );
  } catch (error) {
    if ((error as { code?: string }).code === '23505')
      throw new AppError(409, 'An account with this email already exists.');
    throw error;
  }
}
export async function deleteTicket(db: Database, user: User, id: string, input: unknown) {
  requireAdmin(user);
  const data = z
    .object({
      expectedRevision: z.number().int().nonnegative(),
      note: z.string().trim().min(5).max(1000),
    })
    .parse(input);
  await db.transaction(async (tx) => {
    const ticket = (await tx.query('SELECT * FROM tickets WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!ticket || ticket.deleted_at) throw new AppError(404, 'Ticket not found.');
    if (ticket.revision !== data.expectedRevision)
      throw new AppError(409, 'This ticket changed. Refresh it before deleting.');
    await tx.query(
      'UPDATE tickets SET deleted_at=now(),deleted_by=$2,deletion_note=$3,revision=revision+1,updated_at=now() WHERE id=$1',
      [id, user.id, data.note],
    );
    await tx.query(
      "UPDATE ai_runs SET status='cancelled',completed_at=now() WHERE ticket_id=$1 AND status IN ('queued','running')",
      [id],
    );
    await tx.query(
      "UPDATE ai_response_drafts SET state='stale' WHERE ticket_id=$1 AND state='pending'",
      [id],
    );
    await tx.query(
      "UPDATE resolution_reviews SET state='stale' WHERE ticket_id=$1 AND state='pending'",
      [id],
    );
    await tx.query('DELETE FROM notifications WHERE ticket_id=$1', [id]);
  });
}
export async function restoreTicket(db: Database, user: User, id: string) {
  requireAdmin(user);
  const result = await db.query(
    "UPDATE tickets SET deleted_at=NULL,deleted_by=NULL,deletion_note=NULL,status=CASE WHEN resolved_at IS NOT NULL THEN 'resolved' ELSE 'blocked' END,revision=revision+1,updated_at=now() WHERE id=$1 AND deleted_at IS NOT NULL RETURNING id",
    [id],
  );
  if (!result.rows.length) throw new AppError(404, 'Deleted ticket not found.');
}
