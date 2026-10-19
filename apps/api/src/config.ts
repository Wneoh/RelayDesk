import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
export const config = {
  port: Number(process.env.PORT || 3001),
  origin: process.env.WEB_ORIGIN || 'http://localhost:5173',
  databaseUrl:
    process.env.DATABASE_URL || 'postgres://relaydesk:relaydesk@localhost:5432/relaydesk',
  production: process.env.NODE_ENV === 'production',
  demo: process.env.DEMO_MODE === 'true',
  aiMode: (process.env.AI_MODE || (process.env.OPENAI_API_KEY ? 'live' : 'unavailable')) as
    'demo' | 'live' | 'unavailable',
  openaiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
  sessionSecret: process.env.SESSION_SECRET || 'relaydesk-local-development-secret-only',
};
if (
  config.production &&
  (!process.env.SESSION_SECRET ||
    config.sessionSecret.length < 32 ||
    config.sessionSecret.includes('change-this'))
) {
  throw new Error('Set SESSION_SECRET to at least 32 random characters in production.');
}
