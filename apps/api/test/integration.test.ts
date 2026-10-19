import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { hash } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { io as connect, type Socket } from 'socket.io-client';
import { createApp } from '../src/app.js';
import { createDatabase, type Database } from '../src/db.js';
import { embeddedDatabase } from '../src/embedded.js';
import { migrate } from '../src/migrate.js';
import { config } from '../src/config.js';
import { demoProvider, processNextRun, type Provider } from '../src/ai.js';
import { checkDeadlines } from '../src/worker.js';
let db: Database, service: ReturnType<typeof createApp>, base: string, passwordHash: string;
let ids: Record<string, string> = {},
  agents: Record<string, string> = {};
const sockets: Socket[] = [];
const password = 'test-password-123';
beforeAll(async () => {
  config.demo = false;
  config.aiMode = 'demo';
  db = process.env.TEST_DATABASE_URL
    ? createDatabase(process.env.TEST_DATABASE_URL)
    : await embeddedDatabase();
  await migrate(db);
  passwordHash = await hash(password, 10);
  service = createApp(db, { background: false, rateLimits: false });
  await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
  const address = service.server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});
beforeEach(async () => {
  for (const socket of sockets) socket.disconnect();
  sockets.length = 0;
  await db.query(
    'TRUNCATE notifications,activities,resolution_reviews,ai_runs,messages,tickets,store_orders,sessions,users,knowledge_articles RESTART IDENTITY CASCADE',
  );
  await db.query('UPDATE ai_agents SET enabled=true');
  ids = {};
  agents = {};
  for (const [key, name, role] of [
    ['customer', 'Jamie Parker', 'customer'],
    ['other', 'Olivia Brooks', 'customer'],
    ['admin', 'Maya Chen', 'admin'],
    ['second', 'Alex Morgan', 'admin'],
    ['legacy', 'Sam Rivera', 'agent'],
  ])
    ids[key] = (
      await db.query(
        'INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id',
        [name, `${key}@example.com`, passwordHash, role],
      )
    ).rows[0].id;
  for (const row of (await db.query('SELECT id,slug FROM ai_agents')).rows)
    agents[row.slug] = row.id;
  await db.query(
    "INSERT INTO knowledge_articles(agent_id,title,content) VALUES($1,'Reset your password','To reset your password, open account settings and choose Reset password. Follow the email link. Contact an administrator if your account email is unavailable.'),($2,'Delivery address policy','Delivery address changes require a preparing order and a complete new address explicitly supplied by the customer.'),($3,'Download invoice','Open Billing and Invoice history to download your monthly invoice PDF.')",
    [agents.support, agents.orders, agents.billing],
  );
  await db.query(
    "INSERT INTO store_orders(id,customer_id,status,address,total_cents) VALUES('RD-2048',$1,'preparing','12 Old Road, Kuala Lumpur 50450',12000),('RD-2049',$1,'shipped','12 Old Road, Kuala Lumpur 50450',12000),('RD-2050',$2,'preparing','30 Other Road, Kuala Lumpur 50450',12000)",
    [ids.customer, ids.other],
  );
});
afterAll(async () => {
  for (const socket of sockets) socket.disconnect();
  await new Promise<void>((resolve) => service.io.close(() => resolve()));
  await db.close();
});
async function login(key: string) {
  const r = await request(service.app)
    .post('/api/auth/login')
    .send({ email: `${key}@example.com`, password });
  expect(r.status).toBe(200);
  return String(r.headers['set-cookie'][0]).split(';')[0];
}
async function ticket(
  description = 'I forgot my password. Please explain how I can reset my password.',
  subject = 'Help resetting my password',
  customer = 'customer',
) {
  return (
    await db.query(
      "INSERT INTO tickets(subject,description,customer_id,response_due_at) VALUES($1,$2,$3,now()+interval '24 hours') RETURNING id",
      [subject, description, ids[customer]],
    )
  ).rows[0].id as string;
}
async function assign(id: string, slug = 'support', cookie?: string, revision = 0) {
  return request(service.app)
    .patch(`/api/tickets/${id}`)
    .set('Cookie', cookie || (await login('admin')))
    .send({ agentId: agents[slug], expectedRevision: revision });
}
async function ready(id: string, slug = 'support') {
  const cookie = await login('admin');
  await assign(id, slug, cookie);
  await processNextRun(db);
  return {
    cookie,
    detail: (await request(service.app).get(`/api/tickets/${id}`).set('Cookie', cookie)).body,
  };
}
async function socketFor(cookie: string) {
  const socket = connect(base, {
    extraHeaders: { Cookie: cookie },
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', reject);
  });
  return socket;
}
describe('identity and permissions', () => {
  it('requires login and revokes logged-out sessions', async () => {
    await request(service.app).get('/api/tickets').expect(401);
    const cookie = await login('admin');
    expect((await db.query('SELECT token_hash FROM sessions')).rows[0].token_hash).not.toBe(
      cookie.split('=')[1],
    );
    await request(service.app).post('/api/auth/logout').set('Cookie', cookie).expect(204);
    await request(service.app).get('/api/auth/me').set('Cookie', cookie).expect(401);
  });
  it('registers customers only and disables legacy human agent login', async () => {
    const r = await request(service.app)
      .post('/api/auth/register')
      .send({ name: 'New Person', email: 'new@example.com', password, role: 'admin' });
    expect(r.status).toBe(201);
    expect(r.body.user.role).toBe('customer');
    await request(service.app)
      .post('/api/auth/login')
      .send({ email: 'legacy@example.com', password })
      .expect(401);
  });
  it('limits customers to their own tickets and blocks admin endpoints', async () => {
    const own = await ticket(),
      other = await ticket(undefined, undefined, 'other'),
      cookie = await login('customer');
    const r = await request(service.app).get('/api/tickets').set('Cookie', cookie);
    expect(r.body.tickets.map((t: any) => t.id)).toEqual([own]);
    await request(service.app).get(`/api/tickets/${other}`).set('Cookie', cookie).expect(404);
    for (const path of ['/api/agents', '/api/knowledge', '/api/reports', '/api/users'])
      await request(service.app).get(path).set('Cookie', cookie).expect(403);
    await request(service.app)
      .patch(`/api/tickets/${own}`)
      .set('Cookie', cookie)
      .send({ agentId: agents.support, expectedRevision: 0 })
      .expect(403);
  });
  it('derives ticket ownership and message authorship from the customer session', async () => {
    const cookie = await login('customer');
    const r = await request(service.app).post('/api/tickets').set('Cookie', cookie).send({
      subject: 'Account settings question',
      description: 'Please help with my account settings.',
      customerId: ids.other,
    });
    expect(r.status).toBe(201);
    expect(r.body.ticket.customerId).toBe(ids.customer);
    const message = await request(service.app)
      .post(`/api/tickets/${r.body.ticket.id}/messages`)
      .set('Cookie', cookie)
      .send({
        body: 'Here is another detail.',
        clientMessageId: randomUUID(),
        authorId: ids.admin,
      });
    expect(message.body.authorId).toBe(ids.customer);
  });
  it('filters internal notes and execution records from customer responses', async () => {
    const id = await ticket(),
      admin = await login('admin'),
      customer = await login('customer');
    await request(service.app)
      .post(`/api/tickets/${id}/messages`)
      .set('Cookie', admin)
      .send({
        body: 'Private administrator instruction.',
        internal: true,
        clientMessageId: randomUUID(),
      })
      .expect(201);
    const view = (await request(service.app).get(`/api/tickets/${id}`).set('Cookie', customer))
      .body;
    expect(view.messages).toHaveLength(0);
    expect(view.activities).toHaveLength(0);
    expect(view.runs).toHaveLength(0);
    expect(view.review).toBeNull();
    await request(service.app)
      .post(`/api/tickets/${id}/messages`)
      .set('Cookie', customer)
      .send({ body: 'Not allowed', internal: true, clientMessageId: randomUUID() })
      .expect(403);
  });
  it('rejects cross-origin mutations', async () => {
    await request(service.app)
      .post('/api/auth/logout')
      .set('Cookie', await login('admin'))
      .set('Origin', 'https://untrusted.example')
      .expect(403);
  });
});
describe('AI assignment and execution', () => {
  it('allows one concurrent assignment for a ticket revision', async () => {
    const id = await ticket(),
      a = await login('admin'),
      b = await login('second');
    const results = await Promise.all([assign(id, 'support', a), assign(id, 'billing', b)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      Number((await db.query('SELECT count(*) n FROM ai_runs WHERE ticket_id=$1', [id])).rows[0].n),
    ).toBe(1);
  });
  it('rejects a paused specialist', async () => {
    const id = await ticket();
    await db.query('UPDATE ai_agents SET enabled=false WHERE id=$1', [agents.support]);
    expect((await assign(id)).status).toBe(409);
  });
  it('executes an eligible address change and submits a verified proposal', async () => {
    const id = await ticket(
      'Please update my delivery address. New address: 24 Cedar Avenue, Kuala Lumpur 50480',
      'Change order RD-2048 address',
    );
    const r = await ready(id, 'orders');
    expect(r.detail.ticket.status).toBe('review');
    expect(r.detail.review.state).toBe('pending');
    expect(r.detail.runs[0].mode).toBe('demo');
    expect(
      (await db.query("SELECT address FROM store_orders WHERE id='RD-2048'")).rows[0].address,
    ).toBe('24 Cedar Avenue, Kuala Lumpur 50480');
    expect(r.detail.review.evidence.some((s: string) => s.includes('Saved and verified'))).toBe(
      true,
    );
  });
  it('refuses to change a shipped order', async () => {
    const id = await ticket(
      'Please update my delivery address. New address: 24 Cedar Avenue, Kuala Lumpur 50480',
      'Change order RD-2049 address',
    );
    const r = await ready(id, 'orders');
    expect(r.detail.ticket.status).toBe('blocked');
    expect(r.detail.review).toBeNull();
    expect(
      (await db.query("SELECT address FROM store_orders WHERE id='RD-2049'")).rows[0].address,
    ).toContain('Old Road');
  });
  it('enforces ownership even when a model proposes another customer’s order', async () => {
    const id = await ticket(
      'Please update RD-2050. New address: 24 Cedar Avenue, Kuala Lumpur 50480',
      'Change order delivery address',
    );
    await assign(id, 'orders');
    await processNextRun(db, undefined, async () => ({
      outcome: {
        reply: 'Done',
        summary: 'Change requested',
        outcome: 'review',
        evidence: [],
        sourceIds: [],
        action: {
          type: 'update_address',
          orderId: 'RD-2050',
          address: '24 Cedar Avenue, Kuala Lumpur 50480',
        },
      },
      inputTokens: 10,
      outputTokens: 10,
    }));
    expect(
      (await db.query("SELECT address FROM store_orders WHERE id='RD-2050'")).rows[0].address,
    ).toContain('Other Road');
    expect((await db.query('SELECT status FROM tickets WHERE id=$1', [id])).rows[0].status).toBe(
      'blocked',
    );
  });
  it('discards generated work after reassignment', async () => {
    const id = await ticket(),
      cookie = await login('admin');
    await assign(id, 'support', cookie);
    await processNextRun(db, undefined, async (context) => {
      await assign(id, 'billing', cookie, 1);
      return demoProvider(context);
    });
    expect(
      Number(
        (await db.query('SELECT count(*) n FROM messages WHERE ticket_id=$1', [id])).rows[0].n,
      ),
    ).toBe(0);
    expect(
      (
        await db.query('SELECT status FROM ai_runs WHERE ticket_id=$1 ORDER BY revision', [id])
      ).rows.map((r) => r.status),
    ).toEqual(['cancelled', 'queued']);
  });
  it('only supplies the assigned specialist’s knowledge to generation', async () => {
    const id = await ticket();
    await assign(id);
    let captured: string[] = [];
    await processNextRun(db, undefined, async (context) => {
      captured = context.articles.map((a) => a.title);
      return demoProvider(context);
    });
    expect(captured).toEqual(['Reset your password']);
  });
  it('shows a recoverable blocker when the provider fails', async () => {
    const id = await ticket();
    await assign(id);
    await processNextRun(db, undefined, async () => {
      throw new Error('Provider unavailable');
    });
    expect((await db.query('SELECT status FROM tickets WHERE id=$1', [id])).rows[0].status).toBe(
      'blocked',
    );
    expect(
      (await db.query('SELECT error FROM ai_runs WHERE ticket_id=$1', [id])).rows[0].error,
    ).toBe('Provider unavailable');
  });
});
describe('administrator review', () => {
  it('requires a current review and reserves closure for administrators', async () => {
    const id = await ticket(),
      r = await ready(id),
      customer = await login('customer');
    await request(service.app)
      .post(`/api/tickets/${id}/review`)
      .set('Cookie', customer)
      .send({ reviewId: r.detail.review.id, expectedRevision: 1, decision: 'approve' })
      .expect(403);
    await request(service.app)
      .patch(`/api/tickets/${id}`)
      .set('Cookie', r.cookie)
      .send({ status: 'resolved', expectedRevision: 1 })
      .expect(400);
    await request(service.app)
      .post(`/api/tickets/${id}/review`)
      .set('Cookie', r.cookie)
      .send({ reviewId: r.detail.review.id, expectedRevision: 1, decision: 'approve' })
      .expect(200);
    const row = (await db.query('SELECT status,reviewed_by FROM tickets WHERE id=$1', [id]))
      .rows[0];
    expect(row).toMatchObject({ status: 'resolved', reviewed_by: ids.admin });
  });
  it('rejects stale approval after a new customer reply', async () => {
    const id = await ticket(),
      r = await ready(id);
    await request(service.app)
      .post(`/api/tickets/${id}/messages`)
      .set('Cookie', await login('customer'))
      .send({ body: 'The reset instructions did not help.', clientMessageId: randomUUID() })
      .expect(201);
    await request(service.app)
      .post(`/api/tickets/${id}/review`)
      .set('Cookie', r.cookie)
      .send({ reviewId: r.detail.review.id, expectedRevision: 1, decision: 'approve' })
      .expect(409);
    expect(
      (await db.query('SELECT state FROM resolution_reviews WHERE id=$1', [r.detail.review.id]))
        .rows[0].state,
    ).toBe('stale');
  });
  it('creates one closure when two admins approve simultaneously', async () => {
    const id = await ticket(),
      r = await ready(id),
      other = await login('second');
    const body = { reviewId: r.detail.review.id, expectedRevision: 1, decision: 'approve' };
    const responses = await Promise.all([
      request(service.app).post(`/api/tickets/${id}/review`).set('Cookie', r.cookie).send(body),
      request(service.app).post(`/api/tickets/${id}/review`).set('Cookie', other).send(body),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      Number(
        (
          await db.query("SELECT count(*) n FROM activities WHERE ticket_id=$1 AND kind='closed'", [
            id,
          ])
        ).rows[0].n,
      ),
    ).toBe(1);
  });
  it('returns a resolution to the AI with private revision feedback', async () => {
    const id = await ticket(),
      r = await ready(id);
    await request(service.app)
      .post(`/api/tickets/${id}/review`)
      .set('Cookie', r.cookie)
      .send({
        reviewId: r.detail.review.id,
        expectedRevision: 1,
        decision: 'revise',
        feedback: 'Check whether the customer still has access to the email.',
      })
      .expect(200);
    expect(
      (await db.query('SELECT state FROM resolution_reviews WHERE id=$1', [r.detail.review.id]))
        .rows[0].state,
    ).toBe('rejected');
    expect(
      (await db.query('SELECT status,revision FROM tickets WHERE id=$1', [id])).rows[0],
    ).toMatchObject({ status: 'in_progress', revision: 2 });
    const view = (
      await request(service.app)
        .get(`/api/tickets/${id}`)
        .set('Cookie', await login('customer'))
    ).body;
    expect(view.messages.some((m: any) => m.internal)).toBe(false);
  });
  it('deduplicates message retries without invalidating a review twice', async () => {
    const id = await ticket(),
      cookie = await login('customer'),
      body = { body: 'More details about the issue.', clientMessageId: randomUUID() };
    const a = await request(service.app)
        .post(`/api/tickets/${id}/messages`)
        .set('Cookie', cookie)
        .send(body),
      b = await request(service.app)
        .post(`/api/tickets/${id}/messages`)
        .set('Cookie', cookie)
        .send(body);
    expect([a.status, b.status]).toEqual([201, 200]);
    expect(a.body.id).toBe(b.body.id);
    expect(
      (await db.query('SELECT revision FROM tickets WHERE id=$1', [id])).rows[0].revision,
    ).toBe(1);
  });
});
describe('reporting and realtime', () => {
  it('reports proposal and closure separately and scans overdue alerts idempotently', async () => {
    const id = await ticket(),
      r = await ready(id),
      report = (await request(service.app).get('/api/reports').set('Cookie', r.cookie)).body;
    expect(report.review).toBe(1);
    expect(report.resolved).toBe(0);
    expect(report.avgProposalMinutes).not.toBeNull();
    expect(report.trend).toHaveLength(7);
    const overdue = await ticket();
    await db.query("UPDATE tickets SET response_due_at=now()-interval '1 hour' WHERE id=$1", [
      overdue,
    ]);
    expect(await checkDeadlines(db)).toBe(2);
    expect(await checkDeadlines(db)).toBe(0);
  });
  it('authorizes room subscriptions and keeps private updates out of customer sockets', async () => {
    const id = await ticket(),
      other = await ticket(undefined, undefined, 'other'),
      cookie = await login('customer'),
      admin = await login('admin'),
      customerSocket = await socketFor(cookie),
      adminSocket = await socketFor(admin);
    expect((await customerSocket.emitWithAck('ticket:join', other)).ok).toBe(false);
    expect((await customerSocket.emitWithAck('ticket:join', id)).ok).toBe(true);
    const updates: any[] = [];
    customerSocket.on('ticket:updated', (e) => updates.push(e));
    const seen = new Promise<void>((resolve) =>
      adminSocket.once('ticket:updated', () => resolve()),
    );
    await request(service.app)
      .post(`/api/tickets/${id}/messages`)
      .set('Cookie', admin)
      .send({
        body: 'Private note for administrators.',
        internal: true,
        clientMessageId: randomUUID(),
      })
      .expect(201);
    await seen;
    expect(updates).toHaveLength(0);
  });
});

describe('worker leases and private review metadata', () => {
  it('keeps the reclaimed worker outcome when an older generation finishes later', async () => {
    const id = await ticket();
    await assign(id);
    await processNextRun(db, undefined, async (context) => {
      await db.query(
        "UPDATE ai_runs SET lease_until=now()-interval '1 minute' WHERE ticket_id=$1",
        [id],
      );
      await processNextRun(db, undefined, demoProvider);
      return demoProvider(context);
    });
    expect(
      (await db.query('SELECT status,attempts FROM ai_runs WHERE ticket_id=$1', [id])).rows[0],
    ).toMatchObject({ status: 'completed', attempts: 2 });
    expect(
      Number(
        (await db.query('SELECT count(*) n FROM messages WHERE ticket_id=$1', [id])).rows[0].n,
      ),
    ).toBe(1);
  });
  it('does not expose private closure feedback in customer lists or details', async () => {
    const id = await ticket(),
      r = await ready(id);
    await request(service.app)
      .post(`/api/tickets/${id}/review`)
      .set('Cookie', r.cookie)
      .send({
        reviewId: r.detail.review.id,
        expectedRevision: 1,
        decision: 'approve',
        feedback: 'Private audit detail for administrators.',
      })
      .expect(200);
    const cookie = await login('customer'),
      view = (await request(service.app).get(`/api/tickets/${id}`).set('Cookie', cookie)).body;
    expect(view.ticket.closureReason).toBeNull();
    expect(view.ticket.reviewedBy).toBeNull();
    const list = (await request(service.app).get('/api/tickets').set('Cookie', cookie)).body;
    expect(list.tickets[0].closureReason).toBeNull();
  });
});

describe('performance reporting', () => {
  it('requires an admin, validates filters, and reports empty denominators without invented results', async () => {
    expect((await request(service.app).get('/api/reports/performance')).status).toBe(401);
    expect(
      (
        await request(service.app)
          .get('/api/reports/performance')
          .set('Cookie', await login('customer'))
      ).status,
    ).toBe(403);
    const cookie = await login('admin');
    expect(
      (await request(service.app).get('/api/reports/performance?days=365').set('Cookie', cookie))
        .status,
    ).toBe(400);
    expect(
      (
        await request(service.app)
          .get('/api/reports/performance?mode=invalid')
          .set('Cookie', cookie)
      ).status,
    ).toBe(400);
    const r = await request(service.app)
      .get('/api/reports/performance?days=7&mode=live')
      .set('Cookie', cookie);
    expect(r.status, r.text).toBe(200);
    expect(r.body.window).toMatchObject({ days: 7, mode: 'live' });
    expect(r.body.runs).toMatchObject({
      total: 0,
      completed: 0,
      inputTokens: 0,
      outputTokens: 0,
      duration: { count: 0, average: null, p50: null, p95: null },
    });
    expect(r.body.tickets.firstResponse).toMatchObject({ count: 0, average: null });
    expect(r.body.backlog).toMatchObject({ total: 0, oldestMinutes: null });
    expect(r.body.trend).toHaveLength(7);
    expect(r.body.trend.every((d: any) => d.opened === 0 && d.completed === 0)).toBe(true);
  });
  it('uses event windows, filters AI modes, and credits historical specialists without multiplying counts', async () => {
    const old = await ticket(),
      first = await ticket(),
      second = await ticket(),
      unanswered = await ticket();
    await db.query(
      "UPDATE tickets SET created_at=now()-interval '40 days',first_response_at=now()-interval '39 days',resolved_at=now()-interval '1 hour',status='resolved' WHERE id=$1",
      [old],
    );
    await db.query(
      "UPDATE tickets SET created_at=now()-interval '4 hours',first_response_at=now()-interval '3 hours',response_due_at=now()-interval '2 hours',resolved_at=now()-interval '1 hour',status='resolved' WHERE id=$1",
      [first],
    );
    await db.query(
      "UPDATE tickets SET created_at=now()-interval '5 hours',first_response_at=now()-interval '2 hours',response_due_at=now()-interval '3 hours',ai_agent_id=$2,status='waiting' WHERE id=$1",
      [second, agents.billing],
    );
    await db.query(
      "UPDATE tickets SET created_at=now()-interval '8 days',response_due_at=now()-interval '1 day',priority='urgent' WHERE id=$1",
      [unanswered],
    );
    const run = async (
      ticketId: string,
      revision: number,
      mode: string,
      status: string,
      outcome: string | null,
      age: string,
      durationMinutes: number,
      input = 0,
      output = 0,
    ) =>
      (
        await db.query(
          `INSERT INTO ai_runs(ticket_id,agent_id,revision,mode,status,outcome,created_at,completed_at,input_tokens,output_tokens,steps) VALUES($1,$2,$3,$4,$5,$6,now()-$7::interval,CASE WHEN $5 IN ('queued','running') THEN NULL ELSE now()-$7::interval+$8*interval '1 minute' END,$9,$10,$11) RETURNING id`,
          [
            ticketId,
            agents.support,
            revision,
            mode,
            status,
            outcome,
            age,
            durationMinutes,
            input,
            output,
            JSON.stringify(
              outcome === 'review'
                ? [{ name: 'Updated delivery address', status: 'complete' }]
                : [],
            ),
          ],
        )
      ).rows[0].id;
    const historic = await run(old, 1, 'live', 'completed', 'review', '40 days', 10, 900, 100);
    const live = await run(first, 1, 'live', 'completed', 'review', '3 hours', 10, 100, 20);
    await run(second, 1, 'live', 'completed', 'waiting', '2 hours', 30, 200, 30);
    await run(second, 2, 'live', 'failed', null, '1 hour', 5);
    await run(second, 3, 'live', 'cancelled', null, '1 hour', 1, 10, 0);
    await run(second, 4, 'live', 'queued', null, '30 minutes', 0);
    const demo = await run(second, 5, 'demo', 'completed', 'blocked', '1 hour', 2);
    await db.query(
      `INSERT INTO resolution_reviews(ticket_id,run_id,revision,state,summary,created_at,reviewed_at,reviewed_by) VALUES
      ($1,$2,1,'approved','Old proposal, recent decision',now()-interval '40 days',now()-interval '1 hour',$7),
      ($3,$4,1,'rejected','Needs more work',now()-interval '1 hour',now()-interval '30 minutes',$7),
      ($5,$6,5,'approved','Demo decision',now()-interval '30 minutes',now()-interval '20 minutes',$7)`,
      [old, historic, first, live, second, demo, ids.admin],
    );
    const cookie = await login('admin');
    const response = await request(service.app)
      .get('/api/reports/performance?days=7&mode=live')
      .set('Cookie', cookie);
    expect(response.status, response.text).toBe(200);
    const r = response.body;
    expect(r.tickets).toMatchObject({ opened: 2, closed: 2, responses: 2, onTime: 1, late: 1 });
    expect(r.tickets.firstResponse).toMatchObject({ count: 2, average: 120, p50: 120, p95: 174 });
    expect(r.runs).toMatchObject({
      total: 5,
      completed: 2,
      failed: 1,
      cancelled: 1,
      queued: 1,
      running: 0,
      review: 1,
      waiting: 1,
      blocked: 0,
      inputTokens: 310,
      outputTokens: 50,
      live: 5,
      demo: 0,
      verifiedActions: 1,
    });
    expect(r.runs.duration).toMatchObject({ count: 2, average: 20, p50: 20, p95: 29 });
    expect(r.reviews).toMatchObject({ proposed: 1, approved: 1, rejected: 1, pending: 0 });
    expect(r.backlog).toMatchObject({ total: 2, overdue: 1, unassigned: 1 });
    expect(r.backlog.ages).toContainEqual({ label: '7+ days', count: 1 });
    expect(r.backlog.priorities[0]).toEqual({ priority: 'urgent', count: 1, overdue: 1 });
    const support = r.agents.find((a: any) => a.id === agents.support),
      billing = r.agents.find((a: any) => a.id === agents.billing);
    expect(support).toMatchObject({
      runs: 5,
      completed: 2,
      failed: 1,
      approved: 1,
      rejected: 1,
      active: 0,
      tokens: 360,
    });
    expect(billing).toMatchObject({ active: 1, runs: 0, approved: 0 });
    for (const key of ['completed', 'failed', 'inputTokens', 'outputTokens'])
      expect(r.trend.reduce((sum: number, d: any) => sum + d[key], 0)).toBe(r.runs[key]);
    expect(r.trend.reduce((sum: number, d: any) => sum + d.approved, 0)).toBe(1);
    const all = (
      await request(service.app).get('/api/reports/performance?days=90').set('Cookie', cookie)
    ).body;
    expect(all.trend).toHaveLength(90);
    expect(all.runs).toMatchObject({ total: 7, completed: 4, live: 6, demo: 1 });
    const scripted = (
      await request(service.app).get('/api/reports/performance?mode=demo').set('Cookie', cookie)
    ).body;
    expect(scripted.runs).toMatchObject({ total: 1, blocked: 1, inputTokens: 0, outputTokens: 0 });
    expect(scripted.reviews).toMatchObject({ approved: 1, rejected: 0 });
    expect(scripted.tickets.closed).toBe(2);
    expect(scripted.backlog.total).toBe(2);
  });
});

describe('manual rerun response approval', () => {
  async function rerun(id: string, cookie: string, revision: number) {
    const queued = await request(service.app)
      .post(`/api/tickets/${id}/run`)
      .set('Cookie', cookie)
      .send({ expectedRevision: revision });
    expect(queued.status, queued.text).toBe(202);
    await processNextRun(db);
    return (await request(service.app).get(`/api/tickets/${id}`).set('Cookie', cookie)).body;
  }
  it('keeps rerun replies private until an admin reviews and sends the edited response', async () => {
    const id = await ticket(),
      { cookie, detail: original } = await ready(id);
    const prepared = await rerun(id, cookie, original.ticket.revision);
    expect(prepared.draft.body).toBeTruthy();
    expect(prepared.messages).toHaveLength(original.messages.length);
    const customer = await login('customer');
    const hidden = (await request(service.app).get(`/api/tickets/${id}`).set('Cookie', customer))
      .body;
    expect(hidden.draft).toBeNull();
    expect(hidden.runs).toEqual([]);
    expect(hidden.messages).toHaveLength(original.messages.length);
    const body = {
      draftId: prepared.draft.id,
      expectedRevision: prepared.ticket.revision,
      decision: 'send',
      body: 'I reviewed your request. Please open account settings and choose Reset password.',
    };
    expect(
      (
        await request(service.app)
          .post(`/api/tickets/${id}/response-draft`)
          .set('Cookie', customer)
          .send(body)
      ).status,
    ).toBe(403);
    const sent = await request(service.app)
      .post(`/api/tickets/${id}/response-draft`)
      .set('Cookie', cookie)
      .send(body);
    expect(sent.status, sent.text).toBe(200);
    expect(sent.body.draft).toBeNull();
    expect(sent.body.review.state).toBe('pending');
    expect(sent.body.ticket.status).toBe('review');
    const visible = (await request(service.app).get(`/api/tickets/${id}`).set('Cookie', customer))
      .body;
    expect(visible.messages.at(-1).body).toBe(body.body);
    expect(visible.messages).toHaveLength(original.messages.length + 1);
    expect(
      (
        await request(service.app)
          .post(`/api/tickets/${id}/response-draft`)
          .set('Cookie', cookie)
          .send(body)
      ).status,
    ).toBe(409);
  });
  it('allows only one sender across simultaneous admin approvals', async () => {
    const id = await ticket(),
      { cookie, detail: original } = await ready(id),
      prepared = await rerun(id, cookie, original.ticket.revision);
    const second = await login('second'),
      body = {
        draftId: prepared.draft.id,
        expectedRevision: prepared.ticket.revision,
        decision: 'send',
        body: prepared.draft.body,
      };
    const responses = await Promise.all(
      [cookie, second].map((c) =>
        request(service.app).post(`/api/tickets/${id}/response-draft`).set('Cookie', c).send(body),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      Number(
        (
          await db.query('SELECT count(*) n FROM messages WHERE client_message_id=$1', [
            prepared.draft.runId,
          ])
        ).rows[0].n,
      ),
    ).toBe(1);
  });
  it('rejects stale drafts after a new customer message and discards without sending', async () => {
    const id = await ticket(),
      { cookie, detail: original } = await ready(id),
      prepared = await rerun(id, cookie, original.ticket.revision);
    await request(service.app)
      .post(`/api/tickets/${id}/messages`)
      .set('Cookie', await login('customer'))
      .send({
        body: 'I have another question about the password reset process.',
        clientMessageId: randomUUID(),
      });
    expect(
      (
        await request(service.app)
          .post(`/api/tickets/${id}/response-draft`)
          .set('Cookie', cookie)
          .send({
            draftId: prepared.draft.id,
            expectedRevision: prepared.ticket.revision,
            decision: 'send',
            body: prepared.draft.body,
          })
      ).status,
    ).toBe(409);
    await processNextRun(db);
    const latest = (await request(service.app).get(`/api/tickets/${id}`).set('Cookie', cookie))
      .body;
    const next = await rerun(id, cookie, latest.ticket.revision);
    const discarded = await request(service.app)
      .post(`/api/tickets/${id}/response-draft`)
      .set('Cookie', cookie)
      .send({
        draftId: next.draft.id,
        expectedRevision: next.ticket.revision,
        decision: 'discard',
      });
    expect(discarded.status, discarded.text).toBe(200);
    expect(discarded.body.draft).toBeNull();
    expect(discarded.body.messages).toHaveLength(next.messages.length);
  });
  it('defers address changes until confirmation and rechecks shipment before applying them', async () => {
    const id = await ticket(
      'Please change the delivery address for RD-2048. New address: 45 Forest Avenue, Kuala Lumpur 50480',
      'Update my order delivery address',
    );
    const cookie = await login('admin');
    // Prepare a rerun from an assigned ticket without an automatic first execution.
    await db.query("UPDATE tickets SET ai_agent_id=$2,status='waiting' WHERE id=$1", [
      id,
      agents.orders,
    ]);
    const prepared = await rerun(id, cookie, 0);
    expect(prepared.draft.action.type).toBe('update_address');
    expect(
      (await db.query("SELECT address FROM store_orders WHERE id='RD-2048'")).rows[0].address,
    ).toBe('12 Old Road, Kuala Lumpur 50450');
    expect(prepared.messages).toHaveLength(0);
    expect(prepared.ticket.firstResponseAt).toBeNull();
    await db.query("UPDATE store_orders SET status='shipped' WHERE id='RD-2048'");
    const body = {
      draftId: prepared.draft.id,
      expectedRevision: prepared.ticket.revision,
      decision: 'send',
      body: prepared.draft.body,
    };
    expect(
      (
        await request(service.app)
          .post(`/api/tickets/${id}/response-draft`)
          .set('Cookie', cookie)
          .send(body)
      ).status,
    ).toBe(409);
    expect(
      Number(
        (await db.query('SELECT count(*) n FROM messages WHERE ticket_id=$1', [id])).rows[0].n,
      ),
    ).toBe(0);
    await db.query("UPDATE store_orders SET status='preparing' WHERE id='RD-2048'");
    const sent = await request(service.app)
      .post(`/api/tickets/${id}/response-draft`)
      .set('Cookie', cookie)
      .send(body);
    expect(sent.status, sent.text).toBe(200);
    expect(
      (await db.query("SELECT address FROM store_orders WHERE id='RD-2048'")).rows[0].address,
    ).toBe('45 Forest Avenue, Kuala Lumpur 50480');
    expect(sent.body.messages[0].body).toBe(prepared.draft.body);
    expect(sent.body.runs[0].steps.some((s: any) => s.name === 'Updated delivery address')).toBe(
      true,
    );
  });
});

describe('support role and admin controls', () => {
  async function support() {
    ids.support = (
      await db.query(
        "INSERT INTO users(name,email,password_hash,role) VALUES('Jordan Lee','support@example.com',$1,'support') RETURNING id",
        [passwordHash],
      )
    ).rows[0].id;
    return login('support');
  }
  it('lets admins create Support accounts and protects account and AI management', async () => {
    const admin = await login('admin'),
      customer = await login('customer');
    const input = { name: 'Jordan Lee', email: 'support@example.com', password, role: 'support' };
    expect(
      (await request(service.app).post('/api/users').set('Cookie', customer).send(input)).status,
    ).toBe(403);
    const created = await request(service.app).post('/api/users').set('Cookie', admin).send(input);
    expect(created.status, created.text).toBe(201);
    expect(created.body.user).toMatchObject({ role: 'support', email: 'support@example.com' });
    expect(created.body.user.password_hash).toBeUndefined();
    ids.support = created.body.user.id;
    const staff = await login('support');
    expect(
      (await request(service.app).get('/api/auth/me').set('Cookie', staff)).body.user.role,
    ).toBe('support');
    expect(
      (
        await request(service.app)
          .post('/api/users')
          .set('Cookie', staff)
          .send({ ...input, email: 'another@example.com', role: 'admin' })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(service.app)
          .patch(`/api/agents/${agents.support}`)
          .set('Cookie', staff)
          .send({ enabled: false })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(service.app).post('/api/knowledge').set('Cookie', staff).send({
          agentId: agents.support,
          title: 'Policy update',
          content: 'A Support user cannot replace approved workspace policy.',
        })
      ).status,
    ).toBe(403);
    expect(
      (await request(service.app).get('/api/reports/performance').set('Cookie', staff)).status,
    ).toBe(200);
    const socket = await socketFor(staff);
    expect(service.io.sockets.sockets.get(socket.id!)?.rooms.has('staff')).toBe(true);
    expect(
      (
        await request(service.app)
          .patch(`/api/agents/${agents.support}`)
          .set('Cookie', admin)
          .send({ enabled: false })
      ).status,
    ).toBe(200);
  });
  it('requires private notes for Support response approval and final closure', async () => {
    const staff = await support(),
      id = await ticket(),
      { detail: original } = await ready(id);
    const queued = await request(service.app)
      .post(`/api/tickets/${id}/run`)
      .set('Cookie', staff)
      .send({ expectedRevision: original.ticket.revision });
    expect(queued.status).toBe(202);
    await processNextRun(db);
    const prepared = (await request(service.app).get(`/api/tickets/${id}`).set('Cookie', staff))
      .body;
    const body = {
      draftId: prepared.draft.id,
      expectedRevision: prepared.ticket.revision,
      decision: 'send',
      body: prepared.draft.body,
    };
    expect(
      (
        await request(service.app)
          .post(`/api/tickets/${id}/response-draft`)
          .set('Cookie', staff)
          .send(body)
      ).status,
    ).toBe(400);
    const note = 'Checked the reset policy and confirmed the customer can follow these steps.';
    const sent = await request(service.app)
      .post(`/api/tickets/${id}/response-draft`)
      .set('Cookie', staff)
      .send({ ...body, note });
    expect(sent.status, sent.text).toBe(200);
    expect(
      (
        await db.query('SELECT approval_note FROM ai_response_drafts WHERE id=$1', [
          prepared.draft.id,
        ])
      ).rows[0].approval_note,
    ).toBe(note);
    const close = {
      reviewId: sent.body.review.id,
      expectedRevision: sent.body.ticket.revision,
      decision: 'approve',
    };
    expect(
      (
        await request(service.app)
          .post(`/api/tickets/${id}/review`)
          .set('Cookie', staff)
          .send(close)
      ).status,
    ).toBe(400);
    const closed = await request(service.app)
      .post(`/api/tickets/${id}/review`)
      .set('Cookie', staff)
      .send({ ...close, feedback: note });
    expect(closed.status, closed.text).toBe(200);
    expect(closed.body.ticket.status).toBe('resolved');
    const customer = (
      await request(service.app)
        .get(`/api/tickets/${id}`)
        .set('Cookie', await login('customer'))
    ).body;
    expect(customer.ticket.closureReason).toBeNull();
    expect(customer.review).toBeNull();
    expect(customer.draft).toBeNull();
    expect(JSON.stringify(customer)).not.toContain(note);
  });
  it('restricts deletion and recovery to admins and excludes deleted tickets from active work', async () => {
    const staff = await support(),
      admin = await login('admin'),
      id = await ticket();
    await assign(id, 'support', admin);
    expect(
      (
        await request(service.app)
          .delete(`/api/tickets/${id}`)
          .set('Cookie', staff)
          .send({ expectedRevision: 1, note: 'Duplicate customer request' })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(service.app)
          .delete(`/api/tickets/${id}`)
          .set('Cookie', admin)
          .send({ expectedRevision: 0, note: 'Duplicate customer request' })
      ).status,
    ).toBe(409);
    const removed = await request(service.app)
      .delete(`/api/tickets/${id}`)
      .set('Cookie', admin)
      .send({ expectedRevision: 1, note: 'Duplicate customer request' });
    expect(removed.status, removed.text).toBe(204);
    expect((await request(service.app).get(`/api/tickets/${id}`).set('Cookie', admin)).status).toBe(
      404,
    );
    expect(
      (await request(service.app).get('/api/tickets').set('Cookie', staff)).body.tickets,
    ).toHaveLength(0);
    expect(
      (await request(service.app).get('/api/reports/performance').set('Cookie', admin)).body.backlog
        .total,
    ).toBe(0);
    expect(
      (await db.query('SELECT status FROM ai_runs WHERE ticket_id=$1', [id])).rows[0].status,
    ).toBe('cancelled');
    expect(
      (await request(service.app).get('/api/deleted-tickets').set('Cookie', staff)).status,
    ).toBe(403);
    expect(
      (await request(service.app).get('/api/deleted-tickets').set('Cookie', admin)).body.tickets[0],
    ).toMatchObject({ id, note: 'Duplicate customer request' });
    expect(
      (await request(service.app).post(`/api/deleted-tickets/${id}/restore`).set('Cookie', staff))
        .status,
    ).toBe(403);
    const restored = await request(service.app)
      .post(`/api/deleted-tickets/${id}/restore`)
      .set('Cookie', admin);
    expect(restored.status, restored.text).toBe(200);
    expect(restored.body.ticket.status).toBe('blocked');
    expect(
      (await request(service.app).get('/api/tickets').set('Cookie', staff)).body.tickets,
    ).toHaveLength(1);
  });
  it('discards in-flight AI work when an admin deletes the ticket', async () => {
    const admin = await login('admin'),
      id = await ticket();
    await assign(id, 'support', admin);
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>((r) => (release = r)),
      ready = new Promise<void>((r) => (started = r));
    const run = processNextRun(
      db,
      async () => {},
      async (context) => {
        started();
        await gate;
        return demoProvider(context);
      },
    );
    await ready;
    const deleted = await request(service.app)
      .delete(`/api/tickets/${id}`)
      .set('Cookie', admin)
      .send({ expectedRevision: 1, note: 'Duplicate ticket received' });
    expect(deleted.status).toBe(204);
    release();
    await run;
    expect(
      Number(
        (await db.query('SELECT count(*) n FROM messages WHERE ticket_id=$1', [id])).rows[0].n,
      ),
    ).toBe(0);
    expect(
      (await db.query('SELECT status FROM ai_runs WHERE ticket_id=$1', [id])).rows[0].status,
    ).toBe('cancelled');
  });
});
