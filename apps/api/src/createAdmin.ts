import { hash } from 'bcryptjs';
import { z } from 'zod';
import { createDatabase } from './db.js';
import { migrate } from './migrate.js';
const schema = z.object({
  email: z.email(),
  name: z.string().min(2).max(80),
  password: z.string().min(12).max(128),
});
const input = schema.parse({
  email: process.env.BOOTSTRAP_ADMIN_EMAIL,
  name: process.env.BOOTSTRAP_ADMIN_NAME || 'Administrator',
  password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
});
const db = createDatabase();
try {
  await migrate(db);
  const email = input.email.toLowerCase(),
    existing = (await db.query('SELECT role FROM users WHERE email=$1', [email])).rows[0];
  if (existing) {
    if (existing.role !== 'admin')
      throw new Error(
        'That email belongs to a non-admin account. Choose another email; this command never promotes existing accounts.',
      );
    console.log('Administrator already exists; no account was changed.');
  } else {
    await db.query("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'admin')", [
      input.name,
      email,
      await hash(input.password, 12),
    ]);
    console.log(
      'Administrator created. Remove bootstrap credentials from your environment after setup.',
    );
  }
} finally {
  await db.close();
}
