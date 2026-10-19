import type { Database, Queryable } from './db.js';
import type {
  User,
  Ticket,
  Message,
  TicketDetail,
  Report,
  Agent,
  Article,
} from '@relaydesk/contracts';
import { AppError, accessTicket, requireStaff } from './auth.js';
import {
  createTicketSchema,
  messageSchema,
  updateTicketSchema,
  reviewSchema,
} from '@relaydesk/contracts';
import { enqueueTx } from './ai.js';
import { config } from './config.js';
const iso = (v: any) => (v ? new Date(v).toISOString() : null);
const selectTicket = `SELECT t.*,c.name customer_name,c.email customer_email,a.name assignee_name,a.slug agent_slug,
  (t.first_response_at IS NULL AND t.status<>'resolved' AND t.response_due_at<now()) overdue
  FROM tickets t JOIN users c ON c.id=t.customer_id LEFT JOIN ai_agents a ON a.id=t.ai_agent_id`;
export const ticketView = (r: any): Ticket => ({
  id: r.id,
  number: r.number,
  subject: r.subject,
  description: r.description,
  priority: r.priority,
  status: r.status,
  customerId: r.customer_id,
  customerName: r.customer_name,
  customerEmail: r.customer_email,
  assigneeId: r.ai_agent_id,
  assigneeName: r.assignee_name,
  agentSlug: r.agent_slug,
  createdAt: iso(r.created_at)!,
  updatedAt: iso(r.updated_at)!,
  firstResponseAt: iso(r.first_response_at),
  resolvedAt: iso(r.resolved_at),
  responseDueAt: iso(r.response_due_at)!,
  overdue: r.overdue,
  revision: r.revision,
  reviewedBy: r.reviewed_by,
  closureReason: r.closure_reason,
});
const selectMessage = `SELECT m.*,COALESCE(a.name,u.name) author_name,CASE WHEN m.ai_agent_id IS NOT NULL THEN 'ai' WHEN u.role IN ('customer','support') THEN u.role ELSE 'admin' END author_role FROM messages m LEFT JOIN users u ON u.id=m.author_id LEFT JOIN ai_agents a ON a.id=m.ai_agent_id`;
export const messageView = (r: any): Message => ({
  id: r.id,
  ticketId: r.ticket_id,
  authorId: r.author_id || r.ai_agent_id,
  authorName: r.author_name,
  authorRole: r.author_role,
  body: r.body,
  internal: r.internal,
  createdAt: iso(r.created_at)!,
  clientMessageId: r.client_message_id,
});
export async function logActivity(
  tx: Queryable,
  id: string,
  user: User,
  kind: string,
  detail: string,
) {
  await tx.query('INSERT INTO activities(ticket_id,actor_id,kind,detail) VALUES($1,$2,$3,$4)', [
    id,
    user.id,
    kind,
    detail,
  ]);
}
export async function listTickets(db: Queryable, user: User): Promise<Ticket[]> {
  return (
    await db.query(
      `${selectTicket} WHERE t.deleted_at IS NULL ${user.role === 'customer' ? 'AND t.customer_id=$1' : ''} ORDER BY t.updated_at DESC,t.number DESC`,
      user.role === 'customer' ? [user.id] : [],
    )
  ).rows.map((r) => {
    const view = ticketView(r);
    if (user.role === 'customer') {
      view.closureReason = null;
      view.reviewedBy = null;
    }
    return view;
  });
}
export async function detail(db: Queryable, id: string, user: User): Promise<TicketDetail> {
  await accessTicket(db, id, user);
  const ticket = ticketView((await db.query(`${selectTicket} WHERE t.id=$1`, [id])).rows[0]);
  const messages = (
    await db.query(
      `${selectMessage} WHERE m.ticket_id=$1 ${user.role === 'customer' ? 'AND NOT m.internal' : ''} ORDER BY m.created_at,m.id`,
      [id],
    )
  ).rows.map(messageView);
  if (user.role === 'customer') {
    ticket.closureReason = null;
    ticket.reviewedBy = null;
    return { ticket, messages, activities: [], runs: [], review: null, draft: null };
  }
  const activities = (
    await db.query(
      `SELECT x.*,COALESCE(u.name,a.name) actor_name FROM activities x LEFT JOIN users u ON u.id=x.actor_id LEFT JOIN ai_agents a ON a.id=x.ai_agent_id WHERE ticket_id=$1 ORDER BY x.created_at DESC,x.id`,
      [id],
    )
  ).rows.map((r) => ({
    id: r.id,
    actorName: r.actor_name || 'RelayDesk',
    kind: r.kind,
    detail: r.detail,
    createdAt: iso(r.created_at)!,
  }));
  const runs = (
    await db.query(
      'SELECT r.*,a.name agent_name FROM ai_runs r JOIN ai_agents a ON a.id=r.agent_id WHERE ticket_id=$1 ORDER BY r.created_at DESC LIMIT 12',
      [id],
    )
  ).rows.map((r) => ({
    id: r.id,
    agentName: r.agent_name,
    requiresApproval: r.requires_approval,
    status: r.status,
    mode: r.mode,
    revision: r.revision,
    steps: r.steps,
    error: r.error,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    createdAt: iso(r.created_at)!,
    completedAt: iso(r.completed_at),
  }));
  const row = (
    await db.query(
      'SELECT r.*,u.name reviewer_name FROM resolution_reviews r LEFT JOIN users u ON u.id=r.reviewed_by WHERE ticket_id=$1 ORDER BY r.created_at DESC LIMIT 1',
      [id],
    )
  ).rows[0];
  const review = row
    ? {
        id: row.id,
        revision: row.revision,
        state: row.state,
        summary: row.summary,
        evidence: row.evidence,
        sources: row.sources,
        createdAt: iso(row.created_at)!,
        reviewerName: row.reviewer_name,
        feedback: row.feedback,
      }
    : null;
  const draftRow = (
    await db.query(
      "SELECT d.*,a.name agent_name FROM ai_response_drafts d JOIN ai_agents a ON a.id=d.agent_id WHERE d.ticket_id=$1 AND d.state='pending' AND d.revision=$2",
      [id, ticket.revision],
    )
  ).rows[0];
  const draft = draftRow
    ? {
        id: draftRow.id,
        runId: draftRow.run_id,
        agentName: draftRow.agent_name,
        body: draftRow.body,
        createdAt: iso(draftRow.created_at)!,
        action: draftRow.outcome.action,
      }
    : null;
  return { ticket, messages, activities, runs, review, draft };
}
export async function listAgents(db: Queryable): Promise<Agent[]> {
  return (
    await db.query(
      `SELECT a.*, (SELECT count(*)::int FROM tickets WHERE deleted_at IS NULL AND ai_agent_id=a.id AND status<>'resolved') open,(SELECT count(*)::int FROM tickets WHERE deleted_at IS NULL AND ai_agent_id=a.id AND status='review') review,(SELECT count(*)::int FROM tickets WHERE deleted_at IS NULL AND ai_agent_id=a.id AND status='resolved') closed,(SELECT count(*)::int FROM knowledge_articles WHERE agent_id=a.id AND enabled) articles FROM ai_agents a ORDER BY a.slug DESC`,
    )
  ).rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    specialty: r.specialty,
    description: r.description,
    instructions: r.instructions,
    enabled: r.enabled,
    color: r.color,
    open: r.open,
    review: r.review,
    closed: r.closed,
    articles: r.articles,
  }));
}
export async function listArticles(db: Queryable): Promise<Article[]> {
  return (
    await db.query(
      'SELECT k.*,a.name agent_name FROM knowledge_articles k JOIN ai_agents a ON a.id=k.agent_id ORDER BY k.updated_at DESC',
    )
  ).rows.map((r) => ({
    id: r.id,
    agentId: r.agent_id,
    title: r.title,
    content: r.content,
    enabled: r.enabled,
    updatedAt: iso(r.updated_at)!,
    agentName: r.agent_name,
    requiresApproval: r.requires_approval,
  }));
}
export async function createTicket(db: Database, user: User, input: unknown) {
  const data = createTicketSchema.parse(input),
    customerId = user.role === 'customer' ? user.id : data.customerId;
  if (
    !customerId ||
    !(await db.query("SELECT id FROM users WHERE id=$1 AND role='customer'", [customerId])).rows
      .length
  )
    throw new AppError(400, 'Choose a valid customer.');
  return db.transaction(async (tx) => {
    if (data.agentId) {
      requireStaff(user);
      if (
        !(await tx.query('SELECT id FROM ai_agents WHERE id=$1 AND enabled', [data.agentId])).rows
          .length
      )
        throw new AppError(400, 'Choose an enabled AI agent.');
    }
    const hours = { low: 48, normal: 24, high: 8, urgent: 2 }[data.priority];
    const { rows } = await tx.query(
      "INSERT INTO tickets(subject,description,customer_id,priority,response_due_at,ai_agent_id) VALUES($1,$2,$3,$4,now()+$5*interval '1 hour',$6) RETURNING id",
      [data.subject, data.description, customerId, data.priority, hours, data.agentId || null],
    );
    const id = rows[0].id;
    await logActivity(tx, id, user, 'created', 'created this ticket');
    if (data.agentId) await enqueueTx(tx, id);
    return id as string;
  });
}
export async function updateTicket(db: Database, id: string, user: User, input: unknown) {
  requireStaff(user);
  const data = updateTicketSchema.strict().parse(input);
  await db.transaction(async (tx) => {
    await tx.query('SELECT id FROM tickets WHERE deleted_at IS NULL AND id=$1 FOR UPDATE', [id]);
    const current = await accessTicket(tx, id, user);
    if (current.revision !== data.expectedRevision)
      throw new AppError(409, 'This ticket changed. Refresh it before making another update.');
    if (current.status === 'resolved')
      throw new AppError(409, 'Reopen the closed ticket before changing it.');
    if (data.agentId !== undefined) {
      if (
        data.agentId &&
        !(await tx.query('SELECT id FROM ai_agents WHERE id=$1 AND enabled', [data.agentId])).rows
          .length
      )
        throw new AppError(409, 'That AI agent is paused or unavailable.');
      await tx.query('UPDATE tickets SET ai_agent_id=$2,assignee_id=NULL WHERE id=$1', [
        id,
        data.agentId,
      ]);
      await logActivity(
        tx,
        id,
        user,
        'assigned',
        data.agentId
          ? 'assigned the ticket to an AI specialist'
          : 'returned the ticket to the unassigned queue',
      );
      await enqueueTx(tx, id);
    }
    if (data.priority !== undefined) {
      const hours = { low: 48, normal: 24, high: 8, urgent: 2 }[data.priority];
      await tx.query(
        "UPDATE tickets SET priority=$2,response_due_at=created_at+$3*interval '1 hour',updated_at=now() WHERE id=$1",
        [id, data.priority, hours],
      );
      await logActivity(tx, id, user, 'priority', `set priority to ${data.priority}`);
    }
  });
}
export async function sendMessage(db: Database, id: string, user: User, input: unknown) {
  const data = messageSchema.parse(input);
  if (data.internal && user.role === 'customer')
    throw new AppError(403, 'Only support staff can write internal notes.');
  return db.transaction(async (tx) => {
    await tx.query('SELECT id FROM tickets WHERE deleted_at IS NULL AND id=$1 FOR UPDATE', [id]);
    const ticket = await accessTicket(tx, id, user);
    const existing = (
      await tx.query(
        `${selectMessage} WHERE m.ticket_id=$1 AND m.author_id=$2 AND m.client_message_id=$3`,
        [id, user.id, data.clientMessageId],
      )
    ).rows[0];
    if (existing) {
      if (existing.body !== data.body || existing.internal !== data.internal)
        throw new AppError(409, 'This message ID was already used.');
      return { message: messageView(existing), created: false };
    }
    if (ticket.status === 'resolved')
      throw new AppError(409, 'This ticket is closed. Ask an administrator to reopen it.');
    const { rows } = await tx.query(
      'INSERT INTO messages(ticket_id,author_id,body,internal,client_message_id) VALUES($1,$2,$3,$4,$5) RETURNING id',
      [id, user.id, data.body, data.internal, data.clientMessageId],
    );
    if (!data.internal) {
      await enqueueTx(tx, id);
      if (user.role !== 'customer')
        await tx.query(
          'UPDATE tickets SET first_response_at=COALESCE(first_response_at,now()) WHERE id=$1',
          [id],
        );
    } else await tx.query('UPDATE tickets SET updated_at=now() WHERE id=$1', [id]);
    return {
      message: messageView(
        (await tx.query(`${selectMessage} WHERE m.id=$1`, [rows[0].id])).rows[0],
      ),
      created: true,
    };
  });
}
export async function reviewTicket(db: Database, id: string, user: User, input: unknown) {
  requireStaff(user);
  const data = reviewSchema.parse(input);
  if (user.role === 'support' && data.decision === 'approve' && data.feedback.trim().length < 5)
    throw new AppError(400, 'Add an approval note of at least 5 characters.');
  await db.transaction(async (tx) => {
    await tx.query('SELECT id FROM tickets WHERE deleted_at IS NULL AND id=$1 FOR UPDATE', [id]);
    const ticket = await accessTicket(tx, id, user);
    const review = (
      await tx.query('SELECT * FROM resolution_reviews WHERE id=$1 AND ticket_id=$2 FOR UPDATE', [
        data.reviewId,
        id,
      ])
    ).rows[0];
    if (
      !review ||
      review.state !== 'pending' ||
      ticket.status !== 'review' ||
      review.revision !== ticket.revision ||
      data.expectedRevision !== ticket.revision
    )
      throw new AppError(
        409,
        'This resolution is no longer current. Review the latest conversation.',
      );
    if (data.decision === 'revise' && !data.feedback.trim())
      throw new AppError(400, 'Tell the AI what needs more work.');
    await tx.query(
      'UPDATE resolution_reviews SET state=$2,reviewed_by=$3,reviewed_at=now(),feedback=$4 WHERE id=$1',
      [review.id, data.decision === 'approve' ? 'approved' : 'rejected', user.id, data.feedback],
    );
    if (data.decision === 'approve') {
      await tx.query(
        "UPDATE tickets SET status='resolved',resolved_at=now(),reviewed_by=$2,closure_reason=$3,updated_at=now(),revision=revision+1 WHERE id=$1",
        [id, user.id, data.feedback || review.summary],
      );
      await logActivity(
        tx,
        id,
        user,
        'closed',
        'approved the AI resolution and closed this ticket',
      );
    } else {
      await tx.query(
        'INSERT INTO messages(ticket_id,author_id,body,internal,client_message_id) VALUES($1,$2,$3,true,gen_random_uuid())',
        [id, user.id, data.feedback],
      );
      await logActivity(tx, id, user, 'revision', 'requested more work from the AI');
      await enqueueTx(tx, id);
    }
  });
}
export async function retryTicket(db: Database, id: string, user: User, revision: number) {
  requireStaff(user);
  await db.transaction(async (tx) => {
    await tx.query('SELECT id FROM tickets WHERE deleted_at IS NULL AND id=$1 FOR UPDATE', [id]);
    const t = await accessTicket(tx, id, user);
    if (t.revision !== revision)
      throw new AppError(409, 'This ticket changed. Refresh and try again.');
    if (!t.ai_agent_id) throw new AppError(400, 'Assign an AI agent first.');
    if (t.status === 'resolved') throw new AppError(409, 'Reopen the ticket first.');
    const a = (await tx.query('SELECT enabled FROM ai_agents WHERE id=$1', [t.ai_agent_id]))
      .rows[0];
    if (!a?.enabled) throw new AppError(409, 'Enable the assigned agent first.');
    await enqueueTx(tx, id, config.aiMode, true);
    await logActivity(tx, id, user, 'run', 'requested a private AI response draft for approval');
  });
}
export async function reopenTicket(db: Database, id: string, user: User) {
  requireStaff(user);
  await db.transaction(async (tx) => {
    await tx.query('SELECT id FROM tickets WHERE deleted_at IS NULL AND id=$1 FOR UPDATE', [id]);
    const t = await accessTicket(tx, id, user);
    if (t.status !== 'resolved') throw new AppError(409, 'This ticket is already open.');
    await tx.query(
      'UPDATE tickets SET resolved_at=NULL,reviewed_by=NULL,closure_reason=NULL WHERE id=$1',
      [id],
    );
    await enqueueTx(tx, id);
    await logActivity(tx, id, user, 'reopened', 'reopened this ticket');
  });
}
export async function report(db: Queryable, user: User): Promise<Report> {
  requireStaff(user);
  const s = (
    await db.query(
      `SELECT count(*) FILTER(WHERE status<>'resolved')::int open,count(*) FILTER(WHERE ai_agent_id IS NULL AND status<>'resolved')::int unassigned,count(*) FILTER(WHERE first_response_at IS NULL AND status<>'resolved' AND response_due_at<now())::int overdue,count(*) FILTER(WHERE status='resolved')::int resolved,count(*) FILTER(WHERE status='review')::int review,count(*) FILTER(WHERE status='blocked')::int blocked,count(*) FILTER(WHERE status='in_progress')::int working,count(*) FILTER(WHERE status='waiting')::int waiting,avg(extract(epoch from(first_response_at-created_at))/60) first_response,avg(extract(epoch from(resolved_at-created_at))/60) closure FROM tickets WHERE deleted_at IS NULL`,
    )
  ).rows[0];
  const reviews = (
    await db.query(
      "SELECT count(*) FILTER(WHERE state IN ('approved','rejected'))::int reviewed,count(*) FILTER(WHERE state='approved')::int approved FROM resolution_reviews",
    )
  ).rows[0];
  const proposal = (
    await db.query(
      'SELECT avg(extract(epoch from(r.created_at-t.created_at))/60) minutes FROM resolution_reviews r JOIN tickets t ON t.id=r.ticket_id',
    )
  ).rows[0];
  const usage = (
    await db.query(
      'SELECT COALESCE(sum(input_tokens),0)::int input,COALESCE(sum(output_tokens),0)::int output FROM ai_runs',
    )
  ).rows[0];
  const workload = (await listAgents(db)).map((a) => ({
    id: a.id,
    name: a.name,
    open: a.open,
    resolved: a.closed,
    review: a.review,
  }));
  const trend = (
    await db.query(
      `SELECT to_char(d,'YYYY-MM-DD') AS "day",(SELECT count(*)::int FROM tickets WHERE deleted_at IS NULL AND created_at>=d AND created_at<d+interval '1 day') created,(SELECT count(*)::int FROM tickets WHERE deleted_at IS NULL AND resolved_at>=d AND resolved_at<d+interval '1 day') resolved FROM generate_series(date_trunc('day',now())-interval '6 days',date_trunc('day',now()),interval '1 day') d`,
    )
  ).rows;
  const numeric = (v: any) => (v === null ? null : Number(v));
  return {
    open: s.open,
    unassigned: s.unassigned,
    overdue: s.overdue,
    resolved: s.resolved,
    review: s.review,
    blocked: s.blocked,
    working: s.working,
    waiting: s.waiting,
    avgFirstResponseMinutes: numeric(s.first_response),
    avgResolutionMinutes: numeric(s.closure),
    avgProposalMinutes: numeric(proposal.minutes),
    reviewed: reviews.reviewed,
    approved: reviews.approved,
    inputTokens: usage.input,
    outputTokens: usage.output,
    workload,
    trend,
  };
}
