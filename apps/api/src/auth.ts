import type { User } from '@relaydesk/contracts';
import type { Queryable } from './db.js';
import type { Request } from 'express';
import { createHmac, randomBytes } from 'node:crypto';
import { config } from './config.js';
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
declare global {
  namespace Express {
    interface Request {
      user: User;
    }
  }
}
export type AuthRequest = Request;
export const publicUser = (row: any): User => ({
  id: row.id,
  name: row.name,
  email: row.email,
  role: row.role,
});
export const sessionHash = (token: string) =>
  createHmac('sha256', config.sessionSecret).update(token).digest('hex');
export async function findSession(db: Queryable, token?: string): Promise<User | null> {
  if (!token || token.length > 128) return null;
  const { rows } = await db.query(
    "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.role IN ('customer','support','admin')",
    [sessionHash(token)],
  );
  return rows[0] ? publicUser(rows[0]) : null;
}
export async function newSession(db: Queryable, userId: string) {
  const token = randomBytes(32).toString('hex');
  await db.query(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '7 days')",
    [sessionHash(token), userId],
  );
  return token;
}
export function requireStaff(user: User) {
  if (user.role !== 'admin' && user.role !== 'support')
    throw new AppError(403, 'This action is for support staff.');
}
export function requireAdmin(user: User) {
  if (user.role !== 'admin') throw new AppError(403, 'Administrator access required.');
}
export async function accessTicket(db: Queryable, id: string, user: User) {
  const row = (await db.query('SELECT * FROM tickets WHERE id=$1 AND deleted_at IS NULL', [id]))
    .rows[0];
  if (!row || (user.role === 'customer' && row.customer_id !== user.id))
    throw new AppError(404, 'Ticket not found.');
  return row;
}
