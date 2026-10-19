import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Bot,
  Check,
  CheckCheck,
  ChevronDown,
  Clock3,
  FileCheck2,
  LockKeyhole,
  Link2,
  Trash2,
  MessageSquare,
  Play,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import {
  priorities,
  type User,
  type TicketDetail,
  type Message,
  type Agent,
  type Priority,
  type AiMode,
} from '@relaydesk/contracts';
import { api, post } from './api';
import {
  AgentIcon,
  Avatar,
  Empty,
  Modal,
  PriorityBadge,
  Spinner,
  StatusBadge,
  fullDate,
  relative,
  priorityLabels,
} from './components';
export function TicketConversation({
  detail,
  user,
  agents,
  mode,
  busy,
  onBack,
  onUpdate,
  onReview,
  onRun,
  onReopen,
  onSent,
}: {
  detail: TicketDetail;
  user: User;
  agents: Agent[];
  mode: AiMode;
  busy: boolean;
  onBack: () => void;
  onUpdate: (body: Record<string, unknown>) => void;
  onReview: (decision: 'approve' | 'revise', feedback: string) => void;
  onRun: () => void;
  onReopen: () => void;
  onSent: () => void;
}) {
  const { ticket, messages, activities, runs, review, draft } = detail,
    staff = user.role !== 'customer';
  const [tab, setTab] = useState<'conversation' | 'execution' | 'activity'>('conversation'),
    [body, setBody] = useState(''),
    [internal, setInternal] = useState(staff),
    [sendError, setSendError] = useState(''),
    [sending, setSending] = useState(false),
    [revisionOpen, setRevisionOpen] = useState(false),
    [feedback, setFeedback] = useState('');
  const [pending, setPending] = useState<
      { id: string; body: string; internal: boolean; failed: boolean }[]
    >([]),
    end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages.length, pending.length]);
  useEffect(() => {
    setPending((items) =>
      items.filter((item) => !messages.some((m) => m.clientMessageId === item.id)),
    );
  }, [messages]);
  async function send(item: { id: string; body: string; internal: boolean; failed: boolean }) {
    setSending(true);
    setSendError('');
    setPending((items) => [...items.filter((i) => i.id !== item.id), { ...item, failed: false }]);
    try {
      await post<Message>(`/tickets/${ticket.id}/messages`, {
        body: item.body,
        internal: item.internal,
        clientMessageId: item.id,
      });
      setPending((items) => items.filter((i) => i.id !== item.id));
      onSent();
    } catch (e) {
      setSendError((e as Error).message);
      setPending((items) => items.map((i) => (i.id === item.id ? { ...i, failed: true } : i)));
    } finally {
      setSending(false);
    }
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim() || sending) return;
    const text = body;
    setBody('');
    void send({ id: crypto.randomUUID(), body: text, internal, failed: false });
  }
  const [draftBody, setDraftBody] = useState(''),
    [draftSending, setDraftSending] = useState(false),
    [draftError, setDraftError] = useState('');
  useEffect(() => {
    setDraftBody(draft?.body || '');
    setDraftError('');
  }, [draft?.id]);
  async function decideDraft(decision: 'send' | 'discard') {
    if (!draft || draftSending) return;
    setDraftSending(true);
    setDraftError('');
    try {
      await post('/tickets/' + ticket.id + '/response-draft', {
        draftId: draft.id,
        expectedRevision: ticket.revision,
        decision,
        note: draftNote,
        ...(decision === 'send' ? { body: draftBody } : {}),
      });
      onSent();
    } catch (error) {
      setDraftError((error as Error).message);
    } finally {
      setDraftSending(false);
    }
  }
  const [linkStatus, setLinkStatus] = useState('');
  async function copyTicketLink() {
    try {
      await navigator.clipboard.writeText(window.location.origin + '/tickets/' + ticket.id);
      setLinkStatus('Ticket link copied.');
    } catch {
      setLinkStatus('Copy this link: ' + window.location.origin + '/tickets/' + ticket.id);
    }
  }
  const [approvalNote, setApprovalNote] = useState(''),
    [draftNote, setDraftNote] = useState('');
  useEffect(() => {
    setApprovalNote('');
  }, [review?.id]);
  useEffect(() => {
    setDraftNote('');
  }, [draft?.id]);
  const [deleteOpen, setDeleteOpen] = useState(false),
    [deleteNote, setDeleteNote] = useState(''),
    [deleteError, setDeleteError] = useState(''),
    [deleting, setDeleting] = useState(false);
  async function removeTicket(e: FormEvent) {
    e.preventDefault();
    setDeleting(true);
    setDeleteError('');
    try {
      await api('/tickets/' + ticket.id, {
        method: 'DELETE',
        body: JSON.stringify({ expectedRevision: ticket.revision, note: deleteNote }),
      });
      setDeleteOpen(false);
      onBack();
      onSent();
    } catch (e) {
      setDeleteError((e as Error).message);
    } finally {
      setDeleting(false);
    }
  }
  const pendingReview =
    staff &&
    review?.state === 'pending' &&
    review.revision === ticket.revision &&
    ticket.status === 'review';
  return (
    <div className="detail-page">
      <button className="back-link" onClick={onBack}>
        <ArrowLeft size={15} />
        Back to workspace
      </button>
      <div className="detail-heading">
        <div>
          <div className="detail-reference">
            <span>#{String(ticket.number).padStart(4, '0')}</span>
            <i />
            <span>Opened {fullDate(ticket.createdAt)}</span>
          </div>
          <h1>{ticket.subject}</h1>
          <div className="detail-badges">
            <StatusBadge status={ticket.status} />
            <PriorityBadge priority={ticket.priority} />
            {ticket.assigneeName && (
              <span className="agent-cell">
                <AgentIcon slug={ticket.agentSlug} small />
                {ticket.assigneeName}
              </span>
            )}
          </div>
        </div>
        <button className="button secondary copy-ticket-link" onClick={() => void copyTicketLink()}>
          <Link2 size={16} />
          Copy ticket link
        </button>
        {staff && ticket.status === 'resolved' && (
          <button className="button secondary" onClick={onReopen} disabled={busy}>
            <RefreshCw size={16} />
            Reopen ticket
          </button>
        )}
      </div>
      {linkStatus && (
        <p className="ticket-link-status" role="status">
          {linkStatus}
        </p>
      )}
      {deleteOpen && (
        <Modal title="Delete ticket" onClose={() => !deleting && setDeleteOpen(false)}>
          <form className="stack-form" onSubmit={removeTicket}>
            <p className="form-note">
              Remove ticket #{String(ticket.number).padStart(4, '0')} from the workspace and stop
              its AI work. Admins can restore it from People & access → Deleted tickets.
            </p>
            {deleteError && (
              <p className="draft-error" role="alert">
                {deleteError}
              </p>
            )}
            <label>
              Reason for deletion
              <textarea
                value={deleteNote}
                onChange={(e) => setDeleteNote(e.target.value)}
                required
                minLength={5}
                maxLength={1000}
              />
            </label>
            <button className="button danger" disabled={deleting}>
              {deleting ? <Spinner /> : <Trash2 size={16} />}Delete ticket
            </button>
          </form>
        </Modal>
      )}
      <div className="detail-grid">
        <div className="detail-main">
          {staff && draft && (
            <section className="response-draft-card" aria-labelledby="response-draft-heading">
              <div className="response-draft-title">
                <span className="draft-symbol">
                  <ShieldCheck size={23} />
                </span>
                <div>
                  <span className="section-kicker">PRIVATE DRAFT · NOT SENT</span>
                  <h2 id="response-draft-heading">Review before sending.</h2>
                </div>
              </div>
              <p>
                {draft.agentName} prepared this response. Edit it if needed, then send it to{' '}
                {ticket.customerName}. Closing the ticket remains a separate decision.
              </p>
              {draft.action.type === 'update_address' && (
                <div className="draft-action-note">
                  <TriangleAlert size={18} />
                  <div>
                    <strong>Proposed action: update {draft.action.orderId}</strong>
                    <p>
                      Sending will update the delivery address to {draft.action.address}, after the
                      backend checks eligibility again. No order data has changed yet.
                    </p>
                  </div>
                </div>
              )}
              <label htmlFor="draft-response">Response to customer</label>
              <textarea
                id="draft-response"
                rows={8}
                value={draftBody}
                onChange={(e) => setDraftBody(e.target.value)}
                maxLength={5000}
                disabled={draftSending}
              />
              {draftError && (
                <p className="draft-error" role="alert">
                  {draftError}
                </p>
              )}
              <label className="approval-note">
                Approval note {user.role === 'support' ? '(required)' : '(optional)'}
                <textarea
                  aria-label="Response approval note"
                  rows={2}
                  maxLength={2000}
                  value={draftNote}
                  onChange={(e) => setDraftNote(e.target.value)}
                  placeholder="Record what you checked and why this response is approved."
                />
              </label>
              <div className="draft-actions">
                <span>
                  <LockKeyhole size={14} />
                  Only support staff can see this draft.
                </span>
                <button
                  className="button secondary"
                  disabled={busy || draftSending}
                  onClick={() => void decideDraft('discard')}
                >
                  Discard draft
                </button>
                <button
                  className="button primary"
                  disabled={
                    busy ||
                    draftSending ||
                    !draftBody.trim() ||
                    (user.role === 'support' && draftNote.trim().length < 5)
                  }
                  onClick={() => void decideDraft('send')}
                >
                  {draftSending ? <Spinner /> : <Send size={16} />}Confirm & send response
                </button>
              </div>
            </section>
          )}
          {staff &&
            !draft &&
            runs[0]?.requiresApproval &&
            runs[0].revision === ticket.revision &&
            ['queued', 'running'].includes(runs[0].status) && (
              <div className="draft-generating" role="status">
                <Spinner />
                <span>
                  Preparing a private response draft. You’ll review it before anything is sent or
                  changed.
                </span>
              </div>
            )}
          {pendingReview && (
            <section className="resolution-card">
              <div className="resolution-card-heading">
                <span>
                  <FileCheck2 size={23} />
                </span>
                <div>
                  <span className="section-kicker">READY FOR YOUR FINAL SAY</span>
                  <h2>Resolution proposed.</h2>
                </div>
                <span className="pill">Admin approval required</span>
              </div>
              <p className="resolution-summary">{review.summary}</p>
              {review.evidence.length > 0 && (
                <ul className="evidence-list">
                  {review.evidence.map((item, i) => (
                    <li key={i}>
                      <Check size={15} />
                      {item}
                    </li>
                  ))}
                </ul>
              )}
              {review.sources.length > 0 && (
                <div className="resolution-sources">
                  <BookOpen size={14} />
                  <span>Sources: {review.sources.map((s) => s.title).join(' · ')}</span>
                </div>
              )}
              <label className="approval-note">
                Approval note {user.role === 'support' ? '(required)' : '(optional)'}
                <textarea
                  aria-label="Resolution approval note"
                  rows={2}
                  maxLength={2000}
                  value={approvalNote}
                  onChange={(e) => setApprovalNote(e.target.value)}
                  placeholder="What did you verify before approving this resolution?"
                />
              </label>
              <div className="resolution-actions">
                <span>
                  <ShieldCheck size={14} />
                  Review the conversation and evidence before closing.
                </span>
                <div>
                  <button
                    className="button secondary"
                    onClick={() => setRevisionOpen(!revisionOpen)}
                    disabled={busy}
                  >
                    Request more work
                  </button>
                  <button
                    className="button primary"
                    onClick={() => onReview('approve', approvalNote)}
                    disabled={busy || (user.role === 'support' && approvalNote.trim().length < 5)}
                  >
                    {busy ? <Spinner /> : <CheckCheck size={16} />}Approve & close
                  </button>
                </div>
              </div>
              {revisionOpen && (
                <form
                  className="revision-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    onReview('revise', feedback);
                    setRevisionOpen(false);
                    setFeedback('');
                  }}
                >
                  <label>
                    What should the AI revisit?
                    <textarea
                      value={feedback}
                      onChange={(e) => setFeedback(e.target.value)}
                      minLength={5}
                      maxLength={2000}
                      required
                      placeholder="Explain what is missing or what needs to change…"
                    />
                  </label>
                  <button className="button primary" disabled={busy}>
                    {busy ? <Spinner /> : <ArrowRight size={15} />}Send revision
                  </button>
                </form>
              )}
            </section>
          )}
          {staff && ticket.status === 'blocked' && (
            <div className="blocked-banner">
              <TriangleAlert size={22} />
              <span>
                <strong>This ticket needs your judgment.</strong>
                <p>
                  {runs[0]?.error ||
                    runs[0]?.steps.at(-1)?.detail ||
                    'Review the conversation, add guidance, or choose another specialist.'}
                </p>
              </span>
              {ticket.assigneeId && (
                <button className="button secondary" disabled={busy} onClick={onRun}>
                  <RefreshCw size={15} />
                  Retry run
                </button>
              )}
            </div>
          )}
          {ticket.status === 'resolved' && (
            <div className="closed-banner">
              <ShieldCheck size={21} />
              <span>
                <strong>Reviewed. Approved. Closed.</strong>
                <p>
                  {staff && review?.reviewerName ? `Approved by ${review.reviewerName}. ` : ''}This
                  conversation has been closed by support staff.
                </p>
              </span>
            </div>
          )}
          <section className="panel conversation-panel">
            <div className="conversation-tabs">
              <button
                className={tab === 'conversation' ? 'active' : ''}
                onClick={() => setTab('conversation')}
              >
                <MessageSquare size={16} />
                Conversation<span>{messages.length + 1}</span>
              </button>
              {staff && (
                <>
                  <button
                    className={tab === 'execution' ? 'active' : ''}
                    onClick={() => setTab('execution')}
                  >
                    <Bot size={16} />
                    Execution log<span>{runs.length}</span>
                  </button>
                  <button
                    className={tab === 'activity' ? 'active' : ''}
                    onClick={() => setTab('activity')}
                  >
                    <Activity size={16} />
                    Activity
                  </button>
                </>
              )}
            </div>
            {tab === 'conversation' ? (
              <>
                <div className="message-list">
                  <div className="conversation-start">
                    <i />
                    Conversation started {fullDate(ticket.createdAt)}
                    <i />
                  </div>
                  <MessageBubble
                    name={ticket.customerName}
                    role="customer"
                    time={ticket.createdAt}
                    body={ticket.description}
                  />
                  {messages.map((m) => (
                    <MessageBubble
                      key={m.id}
                      name={m.authorName}
                      role={m.authorRole}
                      time={m.createdAt}
                      body={m.body}
                      internal={m.internal}
                      slug={ticket.agentSlug}
                    />
                  ))}
                  {pending
                    .filter((p) => !messages.some((m) => m.clientMessageId === p.id))
                    .map((p) => (
                      <div className="pending-message" key={p.id}>
                        <MessageBubble
                          name={user.name}
                          role={user.role}
                          time={new Date().toISOString()}
                          body={p.body}
                          internal={p.internal}
                        />
                        <div className={`send-state ${p.failed ? 'failed' : ''}`}>
                          {p.failed ? (
                            <>
                              <span>Couldn’t send this message.</span>
                              <button disabled={sending} onClick={() => void send(p)}>
                                Retry
                              </button>
                            </>
                          ) : (
                            <>
                              <Spinner />
                              Sending…
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  {ticket.status === 'in_progress' && (
                    <div className="ai-working-note">
                      <span className="working-orb">
                        <Bot size={16} />
                      </span>
                      <span>
                        {ticket.assigneeName || 'Your AI specialist'} is working on this ticket…
                      </span>
                      {mode === 'demo' && <span className="pill">Scripted demo</span>}
                    </div>
                  )}
                  <div ref={end} />
                </div>
                {ticket.status !== 'resolved' && (
                  <form
                    className={`composer ${internal ? 'internal-composer' : ''}`}
                    onSubmit={submit}
                  >
                    <div className="composer-tabs">
                      <button
                        type="button"
                        className={!internal ? 'active' : ''}
                        onClick={() => setInternal(false)}
                      >
                        <MessageSquare size={14} />
                        {staff ? 'Reply to customer' : 'Your reply'}
                      </button>
                      {staff && (
                        <button
                          type="button"
                          className={internal ? 'active' : ''}
                          onClick={() => setInternal(true)}
                        >
                          <LockKeyhole size={13} />
                          Internal note
                        </button>
                      )}
                    </div>
                    <label className="sr-only" htmlFor="reply">
                      {internal ? 'Internal note' : 'Your reply'}
                    </label>
                    <textarea
                      id="reply"
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      placeholder={
                        internal
                          ? 'Leave context for your team. Use “Request more work” to instruct the AI.'
                          : staff
                            ? 'Add a helpful update for the customer…'
                            : 'Add more details or answer your specialist’s question…'
                      }
                      maxLength={5000}
                      required
                    />
                    {sendError && (
                      <p role="alert" className="composer-error">
                        {sendError}
                      </p>
                    )}
                    <div className="composer-footer">
                      <span>
                        {internal ? <LockKeyhole size={13} /> : <ShieldCheck size={13} />}{' '}
                        {internal
                          ? 'Visible to administrators only'
                          : staff
                            ? 'Visible to the customer'
                            : 'Shared with the support workspace'}
                      </span>
                      <button className="button primary" disabled={sending || !body.trim()}>
                        {sending ? <Spinner /> : <Send size={15} />}{' '}
                        {internal ? 'Save note' : 'Send reply'}
                      </button>
                    </div>
                  </form>
                )}
              </>
            ) : tab === 'execution' ? (
              <div className="execution-list">
                {runs.length ? (
                  runs.map((run, i) => (
                    <details className="execution-run" key={run.id} open={i === 0}>
                      <summary>
                        <span className={`run-state ${run.status}`}>
                          <Bot size={17} />
                        </span>
                        <span>
                          <strong>
                            {run.agentName}
                            <span className={`run-mode ${run.mode}`}>
                              {run.mode === 'demo'
                                ? 'Scripted demo'
                                : run.mode === 'live'
                                  ? 'Live model'
                                  : 'Not configured'}
                            </span>
                          </strong>
                          <small>
                            {fullDate(run.createdAt)} · Revision {run.revision}
                          </small>
                        </span>
                        <span className="run-status-label">{run.status}</span>
                        <ChevronDown size={15} />
                      </summary>
                      <div className="execution-steps">
                        {run.steps.map((step, j) => (
                          <div key={j} className={`execution-step ${step.status}`}>
                            <span>
                              {step.status === 'blocked' ? (
                                <TriangleAlert size={15} />
                              ) : (
                                <Check size={15} />
                              )}
                            </span>
                            <div>
                              <strong>{step.name}</strong>
                              <p>{step.detail}</p>
                            </div>
                          </div>
                        ))}
                        {!run.steps.length && (
                          <p className="muted">
                            {run.status === 'cancelled'
                              ? 'This run was cancelled before publishing a response.'
                              : 'The run is queued or still processing.'}
                          </p>
                        )}
                        {run.error && <div className="error-banner">{run.error}</div>}
                        <div className="execution-usage">
                          <ZapIcon /> {run.inputTokens + run.outputTokens} model tokens ·{' '}
                          {run.mode === 'demo' ? 'No model call' : 'Provider usage'}
                        </div>
                      </div>
                    </details>
                  ))
                ) : (
                  <Empty title="No AI runs yet">Assign a specialist to start the first run.</Empty>
                )}
              </div>
            ) : (
              <div className="activity-list">
                {activities.length ? (
                  activities.map((a) => (
                    <div className="activity-item" key={a.id}>
                      <span />
                      <div>
                        <p>
                          <strong>{a.actorName}</strong> {a.detail}
                        </p>
                        <small>{fullDate(a.createdAt)}</small>
                      </div>
                    </div>
                  ))
                ) : (
                  <Empty title="A fresh conversation">
                    Activity will appear as this ticket moves forward.
                  </Empty>
                )}
              </div>
            )}
          </section>
        </div>
        <aside className="ticket-properties">
          <section className="panel properties-card">
            <h3>Ticket details</h3>
            <label>
              Status
              <StatusBadge status={ticket.status} />
            </label>
            <label>
              Assigned AI
              {staff && ticket.status !== 'resolved' ? (
                <select
                  aria-label="Assigned AI agent"
                  value={ticket.assigneeId || ''}
                  disabled={busy}
                  onChange={(e) => onUpdate({ agentId: e.target.value || null })}
                >
                  <option value="">Choose a specialist</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id} disabled={!a.enabled}>
                      {a.name}
                      {!a.enabled ? ' · Paused' : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <span>{ticket.assigneeName || 'Awaiting assignment'}</span>
              )}
            </label>
            <label>
              Priority
              {staff && ticket.status !== 'resolved' ? (
                <select
                  aria-label="Ticket priority"
                  disabled={busy}
                  value={ticket.priority}
                  onChange={(e) => onUpdate({ priority: e.target.value })}
                >
                  {priorities.map((p) => (
                    <option key={p} value={p}>
                      {priorityLabels[p]}
                    </option>
                  ))}
                </select>
              ) : (
                <PriorityBadge priority={ticket.priority} />
              )}
            </label>
            {staff && ticket.assigneeId && ticket.status !== 'resolved' && (
              <button
                className="button secondary full"
                onClick={onRun}
                disabled={busy || draftSending || !!draft || ticket.status === 'in_progress'}
              >
                {busy ? <Spinner /> : <Play size={14} />}
                {draft ? 'Response awaiting approval' : 'Run specialist again'}
              </button>
            )}
            {staff && ticket.assigneeId && ticket.status !== 'resolved' && (
              <p className="run-approval-note">Reruns create a private draft for your approval.</p>
            )}
            {user.role === 'admin' && (
              <button
                className="button danger full"
                onClick={() => setDeleteOpen(true)}
                disabled={busy}
              >
                <Trash2 size={15} />
                Delete ticket
              </button>
            )}
            <div className={`deadline-box ${ticket.overdue ? 'overdue' : ''}`}>
              <Clock3 size={17} />
              <div>
                <strong>
                  {ticket.firstResponseAt
                    ? 'First response sent'
                    : ticket.overdue
                      ? 'First response overdue'
                      : 'First response due'}
                </strong>
                <span>{fullDate(ticket.firstResponseAt || ticket.responseDueAt)}</span>
              </div>
            </div>
          </section>
          <section className="panel properties-card customer-card">
            <h3>{staff ? 'Customer' : 'Your details'}</h3>
            <div>
              <Avatar name={ticket.customerName} />
              <span>
                <strong>{ticket.customerName}</strong>
                <small>{ticket.customerEmail}</small>
              </span>
            </div>
          </section>
          {staff && (
            <section className="panel approval-principle">
              <ShieldCheck size={23} />
              <h3>Your final say.</h3>
              <p>
                The AI investigates and proposes a resolution. Only you can approve and close the
                ticket.
              </p>
              <span>
                <LockKeyhole size={12} />
                Enforced by the API
              </span>
            </section>
          )}
          {mode === 'demo' && (
            <div className="detail-demo-note">
              <Sparkles size={14} />
              <p>This workspace uses scripted agent responses and local sample orders.</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
function ZapIcon() {
  return <Sparkles size={13} />;
}
function MessageBubble({
  name,
  role,
  time,
  body,
  internal = false,
  slug,
}: {
  name: string;
  role: 'admin' | 'support' | 'customer' | 'ai';
  time: string;
  body: string;
  internal?: boolean;
  slug?: string | null;
}) {
  return (
    <article
      className={`message ${role === 'ai' ? 'ai-message' : role === 'customer' ? 'customer-message' : 'admin-message'} ${internal ? 'internal-message' : ''}`}
    >
      {role === 'ai' ? <AgentIcon slug={slug} small /> : <Avatar name={name} small />}
      <div className="message-content">
        <div className="message-meta">
          <strong>{name}</strong>
          {internal ? (
            <span>
              <LockKeyhole size={11} />
              Internal
            </span>
          ) : role === 'ai' ? (
            <span className="ai-label">AI agent</span>
          ) : (
            <span>
              {role === 'admin' ? 'Administrator' : role === 'support' ? 'Support' : 'Customer'}
            </span>
          )}
          <time dateTime={time}>{fullDate(time)}</time>
        </div>
        <div className="message-body">{body}</div>
      </div>
    </article>
  );
}
export function NewTicket({
  user,
  users,
  agents,
  onClose,
  onCreated,
}: {
  user: User;
  users: User[];
  agents: Agent[];
  onClose: () => void;
  onCreated: (detail: TicketDetail) => void;
}) {
  const [subject, setSubject] = useState(''),
    [description, setDescription] = useState(''),
    [priority, setPriority] = useState<Priority>('normal'),
    [customerId, setCustomerId] = useState(''),
    [agentId, setAgentId] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onCreated(
        await post<TicketDetail>('/tickets', {
          subject,
          description,
          priority,
          ...(user.role !== 'customer' ? { customerId, ...(agentId ? { agentId } : {}) } : {}),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Start a new conversation" onClose={onClose}>
      <p className="modal-intro">A clear question is the start of a useful answer.</p>
      <form className="stack-form" onSubmit={submit}>
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
        {user.role !== 'customer' && (
          <label>
            Customer
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
              <option value="">Choose a customer</option>
              {users
                .filter((u) => u.role === 'customer')
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} · {u.email}
                  </option>
                ))}
            </select>
          </label>
        )}
        <label>
          Subject
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="What can we help with?"
            minLength={5}
            maxLength={160}
            required
          />
        </label>
        <label>
          Tell us a little more
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the issue, your order reference if relevant, and what you’ve already tried…"
            minLength={10}
            maxLength={10000}
            required
            rows={5}
          />
        </label>
        <div className="form-grid">
          <label>
            Priority
            <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
              {priorities.map((p) => (
                <option key={p} value={p}>
                  {priorityLabels[p]}
                </option>
              ))}
            </select>
          </label>
          {user.role !== 'customer' && (
            <label>
              AI specialist
              <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                <option value="">Assign later</option>
                {agents
                  .filter((a) => a.enabled)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
        </div>
        <div className="form-note">
          <ShieldCheck size={14} />
          Support staff review every proposed resolution.
        </div>
        <div className="modal-actions">
          <button className="button secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? <Spinner /> : <Plus size={16} />}Create ticket
          </button>
        </div>
      </form>
    </Modal>
  );
}
