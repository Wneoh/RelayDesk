import express, { type ErrorRequestHandler } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { compare, hash } from 'bcryptjs';
import { z, ZodError } from 'zod';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'node:url';
import type { Database } from './db.js';
import { config } from './config.js';
import {
  AppError,
  findSession,
  newSession,
  publicUser,
  sessionHash,
  requireAdmin,
  requireStaff,
  accessTicket,
} from './auth.js';
import {
  loginSchema,
  registerSchema,
  uuidSchema,
  agentSchema,
  articleSchema,
  type User,
} from '@relaydesk/contracts';
import {
  listTickets,
  detail,
  createTicket,
  updateTicket,
  sendMessage,
  report,
  listAgents,
  listArticles,
  reviewTicket,
  retryTicket,
  reopenTicket,
} from './tickets.js';
import { processNextRun } from './ai.js';
import { performance } from './performance.js';
import { decideResponseDraft } from './responseDrafts.js';
import { createWorkspaceUser, deleteTicket, restoreTicket } from './administration.js';
export function createApp(
  db: Database,
  options: { background?: boolean; rateLimits?: boolean } = {},
) {
  const app = express(),
    server = createServer(app),
    io = new Server(server, {
      cors: { origin: config.origin, credentials: true },
      maxHttpBufferSize: 20000,
    });
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: config.origin, credentials: true }));
  app.use(express.json({ limit: '40kb' }));
  app.use(cookieParser());
  app.use((req, res, next) => {
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.headers.origin &&
      req.headers.origin !== config.origin
    )
      return void res.status(403).json({ error: 'Request origin is not allowed.' });
    next();
  });
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    skip: () => options.rateLimits === false,
    limit: config.demo ? 100 : 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many attempts. Please try again later.' },
  });
  const cookieOptions = {
    httpOnly: true,
    secure: config.production,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
  app.get('/api/health', async (_req, res) => {
    await db.query('SELECT 1');
    res.json({ status: 'ok', service: 'relaydesk' });
  });
  app.get('/api/config', (_req, res) =>
    res.json({
      demoMode: config.demo,
      aiMode: config.aiMode,
      model: config.aiMode === 'live' ? config.openaiModel : null,
    }),
  );
  app.post('/api/auth/register', authLimiter, async (req, res) => {
    if (config.demo)
      throw new AppError(403, 'Registration is disabled in this demo. Use a demo account.');
    const data = registerSchema.parse(req.body);
    let user: User;
    try {
      user = publicUser(
        (
          await db.query(
            "INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'customer') RETURNING *",
            [data.name, data.email.toLowerCase(), await hash(data.password, 12)],
          )
        ).rows[0],
      );
    } catch (error: any) {
      if (error.code === '23505')
        throw new AppError(409, 'An account with that email already exists.');
      throw error;
    }
    res
      .cookie('relaydesk_session', await newSession(db, user.id), cookieOptions)
      .status(201)
      .json({ user });
  });
  app.post('/api/auth/login', authLimiter, async (req, res) => {
    const data = loginSchema.parse(req.body),
      row = (await db.query('SELECT * FROM users WHERE email=$1', [data.email.toLowerCase()]))
        .rows[0];
    const valid = await compare(
      data.password,
      row?.password_hash || '$2b$12$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
    );
    if (!row || !valid || !['customer', 'support', 'admin'].includes(row.role))
      throw new AppError(401, 'Email or password is incorrect.');
    if (req.cookies.relaydesk_session)
      await db.query('DELETE FROM sessions WHERE token_hash=$1', [
        sessionHash(req.cookies.relaydesk_session),
      ]);
    const user = publicUser(row);
    res.cookie('relaydesk_session', await newSession(db, user.id), cookieOptions).json({ user });
  });
  app.use('/api', async (req, _res, next) => {
    const user = await findSession(db, req.cookies.relaydesk_session);
    if (!user) throw new AppError(401, 'Please sign in to continue.');
    req.user = user;
    next();
  });
  const mutationLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    skip: () => options.rateLimits === false,
    limit: config.demo ? 300 : 80,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many changes. Please wait a few minutes.' },
  });
  app.use('/api', (req, res, next) => {
    if (['POST', 'PATCH', 'DELETE'].includes(req.method)) return mutationLimiter(req, res, next);
    next();
  });
  app.get('/api/auth/me', (req, res) => res.json({ user: req.user }));
  app.post('/api/auth/logout', async (req, res) => {
    await db.query('DELETE FROM sessions WHERE token_hash=$1', [
      sessionHash(req.cookies.relaydesk_session),
    ]);
    io.in(`user:${req.user.id}`).disconnectSockets();
    res
      .clearCookie('relaydesk_session', {
        httpOnly: true,
        secure: config.production,
        sameSite: 'lax',
        path: '/',
      })
      .status(204)
      .end();
  });
  const id = (value: unknown) => uuidSchema.parse(value);
  async function publish(ticketId: string, internal = false) {
    const row = (await db.query('SELECT customer_id FROM tickets WHERE id=$1', [ticketId])).rows[0];
    if (!row) return;
    const rooms = ['staff'];
    if (!internal) rooms.push(`user:${row.customer_id}`);
    io.to(rooms).emit('ticket:updated', { ticketId });
  }
  app.get('/api/tickets', async (req, res) =>
    res.json({ tickets: await listTickets(db, req.user) }),
  );
  app.post('/api/tickets', async (req, res) => {
    const ticketId = await createTicket(db, req.user, req.body);
    await publish(ticketId);
    res.status(201).json(await detail(db, ticketId, req.user));
  });
  app.get('/api/tickets/:id', async (req, res) =>
    res.json(await detail(db, id(req.params.id), req.user)),
  );
  app.patch('/api/tickets/:id', async (req, res) => {
    const ticketId = id(req.params.id);
    await updateTicket(db, ticketId, req.user, req.body);
    await publish(ticketId);
    res.json(await detail(db, ticketId, req.user));
  });
  app.post('/api/tickets/:id/review', async (req, res) => {
    const ticketId = id(req.params.id);
    await reviewTicket(db, ticketId, req.user, req.body);
    await publish(ticketId);
    res.json(await detail(db, ticketId, req.user));
  });
  app.post('/api/tickets/:id/run', async (req, res) => {
    const ticketId = id(req.params.id),
      { expectedRevision } = z
        .object({ expectedRevision: z.number().int().nonnegative() })
        .parse(req.body);
    await retryTicket(db, ticketId, req.user, expectedRevision);
    await publish(ticketId);
    res.status(202).json(await detail(db, ticketId, req.user));
  });
  app.post('/api/tickets/:id/response-draft', async (req, res) => {
    const ticketId = id(req.params.id);
    await decideResponseDraft(db, ticketId, req.user, req.body);
    await publish(ticketId, req.body.decision === 'discard');
    res.json(await detail(db, ticketId, req.user));
  });
  app.post('/api/tickets/:id/reopen', async (req, res) => {
    const ticketId = id(req.params.id);
    await reopenTicket(db, ticketId, req.user);
    await publish(ticketId);
    res.json(await detail(db, ticketId, req.user));
  });
  app.post('/api/tickets/:id/messages', async (req, res) => {
    const ticketId = id(req.params.id),
      result = await sendMessage(db, ticketId, req.user, req.body);
    if (result.created) await publish(ticketId, result.message.internal);
    res.status(result.created ? 201 : 200).json(result.message);
  });
  app.get('/api/reports/performance', async (req, res) =>
    res.json(await performance(db, req.user, req.query)),
  );
  app.get('/api/reports', async (req, res) => res.json(await report(db, req.user)));
  app.get('/api/agents', async (req, res) => {
    requireStaff(req.user);
    res.json({ agents: await listAgents(db) });
  });
  app.patch('/api/agents/:id', async (req, res) => {
    requireAdmin(req.user);
    const agentId = id(req.params.id),
      data = agentSchema.strict().parse(req.body);
    if (data.enabled === undefined && data.instructions === undefined)
      throw new AppError(400, 'Choose a setting to change.');
    await db.transaction(async (tx) => {
      const tickets = (
        await tx.query(
          "SELECT id FROM tickets WHERE ai_agent_id=$1 AND status='in_progress' ORDER BY id FOR UPDATE",
          [agentId],
        )
      ).rows;
      const agent = (await tx.query('SELECT * FROM ai_agents WHERE id=$1 FOR UPDATE', [agentId]))
        .rows[0];
      if (!agent) throw new AppError(404, 'AI agent not found.');
      await tx.query('UPDATE ai_agents SET enabled=$2,instructions=$3 WHERE id=$1', [
        agentId,
        data.enabled ?? agent.enabled,
        data.instructions ?? agent.instructions,
      ]);
      for (const ticket of tickets) {
        await tx.query(
          "UPDATE ai_runs SET status='cancelled',completed_at=now() WHERE ticket_id=$1 AND status IN ('queued','running')",
          [ticket.id],
        );
        await tx.query(
          "UPDATE tickets SET status='blocked',revision=revision+1,updated_at=now() WHERE id=$1",
          [ticket.id],
        );
      }
    });
    io.to('staff').emit('workspace:updated');
    res.json({ agents: await listAgents(db) });
  });
  app.get('/api/knowledge', async (req, res) => {
    requireStaff(req.user);
    res.json({ articles: await listArticles(db) });
  });
  app.post('/api/knowledge', async (req, res) => {
    requireAdmin(req.user);
    const d = articleSchema.parse(req.body);
    if (!(await db.query('SELECT id FROM ai_agents WHERE id=$1', [d.agentId])).rows.length)
      throw new AppError(400, 'Choose a valid agent.');
    const { rows } = await db.query(
      'INSERT INTO knowledge_articles(agent_id,title,content,enabled) VALUES($1,$2,$3,$4) RETURNING id',
      [d.agentId, d.title, d.content, d.enabled],
    );
    io.to('staff').emit('workspace:updated');
    res.status(201).json({ id: rows[0].id });
  });
  app.patch('/api/knowledge/:id', async (req, res) => {
    requireAdmin(req.user);
    const d = articleSchema.parse(req.body);
    if (!(await db.query('SELECT id FROM ai_agents WHERE id=$1', [d.agentId])).rows.length)
      throw new AppError(400, 'Choose a valid agent.');
    const result = await db.query(
      'UPDATE knowledge_articles SET agent_id=$2,title=$3,content=$4,enabled=$5,updated_at=now() WHERE id=$1 RETURNING id',
      [id(req.params.id), d.agentId, d.title, d.content, d.enabled],
    );
    if (!result.rows.length) throw new AppError(404, 'Article not found.');
    io.to('staff').emit('workspace:updated');
    res.json({ success: true });
  });
  app.get('/api/users', async (req, res) => {
    requireStaff(req.user);
    res.json({
      users: (
        await db.query(
          "SELECT id,name,email,role FROM users WHERE role IN ('admin','support','customer') ORDER BY name",
        )
      ).rows,
    });
  });
  app.post('/api/users', async (req, res) => {
    const user = await createWorkspaceUser(db, req.user, req.body);
    io.to('staff').emit('workspace:updated');
    res.status(201).json({ user });
  });
  app.delete('/api/tickets/:id', async (req, res) => {
    const ticketId = id(req.params.id);
    await deleteTicket(db, req.user, ticketId, req.body);
    await publish(ticketId);
    res.status(204).end();
  });
  app.get('/api/deleted-tickets', async (req, res) => {
    requireAdmin(req.user);
    res.json({
      tickets: (
        await db.query(
          'SELECT t.id,t.number,t.subject,t.deleted_at AS "deletedAt",t.deletion_note AS "note",u.name AS "deletedBy" FROM tickets t LEFT JOIN users u ON u.id=t.deleted_by WHERE t.deleted_at IS NOT NULL ORDER BY t.deleted_at DESC LIMIT 100',
        )
      ).rows,
    });
  });
  app.post('/api/deleted-tickets/:id/restore', async (req, res) => {
    const ticketId = id(req.params.id);
    await restoreTicket(db, req.user, ticketId);
    await publish(ticketId);
    res.json(await detail(db, ticketId, req.user));
  });
  app.get('/api/orders', async (req, res) => {
    const filter = req.user.role === 'customer' ? 'WHERE customer_id=$1' : '';
    res.json({
      orders: (
        await db.query(
          `SELECT id,status,address,tracking,customer_id AS "customerId" FROM store_orders ${filter} ORDER BY id`,
          req.user.role === 'customer' ? [req.user.id] : [],
        )
      ).rows,
    });
  });
  app.get('/api/notifications', async (req, res) => {
    requireStaff(req.user);
    res.json({
      notifications: (
        await db.query(
          'SELECT id,ticket_id AS "ticketId",body,read_at AS "readAt",created_at AS "createdAt" FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50',
          [req.user.id],
        )
      ).rows,
    });
  });
  app.patch('/api/notifications/read', async (req, res) => {
    requireStaff(req.user);
    await db.query('UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL', [
      req.user.id,
    ]);
    res.status(204).end();
  });
  if (config.production) {
    const directory = fileURLToPath(new URL('../../web/dist/', import.meta.url));
    app.use(express.static(directory));
    app.get(
      [
        '/',
        '/tickets',
        '/tickets/:ticketId',
        '/review',
        '/agents',
        '/knowledge',
        '/rules',
        '/performance',
        '/team',
      ],
      (_req, res) => res.sendFile(directory + 'index.html'),
    );
  }
  app.use((_req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof ZodError)
      return void res.status(400).json({ error: error.issues[0]?.message || 'Invalid input.' });
    if (error instanceof AppError)
      return void res.status(error.status).json({ error: error.message });
    if (error.type === 'entity.parse.failed')
      return void res.status(400).json({ error: 'Invalid JSON body.' });
    if (error.type === 'entity.too.large')
      return void res.status(413).json({ error: 'Request is too large.' });
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  };
  app.use(errors);
  const socketToken = (cookie?: string) =>
    cookie
      ?.split(';')
      .map((p) => p.trim())
      .find((p) => p.startsWith('relaydesk_session='))
      ?.slice('relaydesk_session='.length);
  io.use(async (socket, next) => {
    try {
      const origin = socket.handshake.headers.origin;
      if (origin && origin !== config.origin) return next(new Error('Origin is not allowed.'));
      const token = socketToken(socket.handshake.headers.cookie),
        user = await findSession(db, token);
      if (!user) return next(new Error('Please sign in.'));
      socket.data.user = user;
      socket.data.token = token;
      next();
    } catch {
      next(new Error('Unable to authenticate.'));
    }
  });
  io.on('connection', async (socket) => {
    const user: User = socket.data.user;
    await socket.join(`user:${user.id}`);
    if (user.role !== 'customer') await socket.join('staff');
    socket.on('ticket:join', async (input: unknown, ack?: (response: unknown) => void) => {
      try {
        const current = await findSession(db, socket.data.token);
        if (!current) throw new AppError(401, 'Session expired.');
        const ticketId = id(input);
        await accessTicket(db, ticketId, current);
        await socket.join(`ticket:${ticketId}:public`);
        if (current.role !== 'customer') await socket.join(`ticket:${ticketId}:staff`);
        ack?.({ ok: true });
      } catch (error) {
        ack?.({
          ok: false,
          error: error instanceof AppError ? error.message : 'Cannot open this conversation.',
        });
      }
    });
    socket.on('ticket:leave', (input: unknown) => {
      const parsed = uuidSchema.safeParse(input);
      if (parsed.success) {
        void socket.leave(`ticket:${parsed.data}:public`);
        void socket.leave(`ticket:${parsed.data}:staff`);
      }
    });
    const expiry = setInterval(async () => {
      try {
        if (!(await findSession(db, socket.data.token))) socket.disconnect(true);
      } catch {
        socket.disconnect(true);
      }
    }, 30000);
    socket.on('disconnect', () => clearInterval(expiry));
  });
  let timer: ReturnType<typeof setInterval> | undefined;
  let running: Promise<unknown> | null = null;
  server.on('listening', () => {
    if (options.background === false) return;
    timer = setInterval(() => {
      if (running) return;
      running = processNextRun(db, publish)
        .catch((error) => console.error('AI worker:', error))
        .finally(() => {
          running = null;
        });
    }, 750);
    timer.unref();
  });
  server.on('close', () => {
    if (timer) clearInterval(timer);
  });
  async function stopBackground() {
    if (timer) clearInterval(timer);
    await running;
  }
  return { app, server, io, stopBackground };
}
