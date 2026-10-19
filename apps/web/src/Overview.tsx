import { useState, type FormEvent } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Bot,
  Check,
  CheckCheck,
  ChevronRight,
  Clock3,
  FileCheck2,
  FileText,
  Layers,
  LockKeyhole,
  MessageSquare,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Zap,
} from 'lucide-react';
import type { Agent, Article, Report, Ticket, AiMode } from '@relaydesk/contracts';
import {
  AgentIcon,
  Avatar,
  Empty,
  Modal,
  PriorityBadge,
  Spinner,
  StatusBadge,
  duration,
  relative,
} from './components';
export function CommandCenter({
  report,
  agents,
  tickets,
  mode,
  onOpen,
  onNavigate,
  onNew,
}: {
  report: Report;
  agents: Agent[];
  tickets: Ticket[];
  mode: AiMode;
  onOpen: (id: string) => void;
  onNavigate: (
    view: 'overview' | 'inbox' | 'review' | 'agents' | 'knowledge' | 'rules' | 'analytics',
    filter?: string,
    agent?: string,
  ) => void;
  onNew: () => void;
}) {
  const attention = tickets
    .filter((t) => t.status === 'review' || t.status === 'blocked')
    .sort((a, b) => Number(b.status === 'review') - Number(a.status === 'review'))
    .slice(0, 5);
  return (
    <>
      <div className="page-heading dashboard-heading">
        <div>
          <span className="eyebrow">
            <span className="eyebrow-line" />A SMALL TEAM. A BIGGER REACH.
          </span>
          <h1>
            Less to handle.
            <br className="mobile-break" /> More under control<span className="heading-dot">.</span>
          </h1>
          <p>Your AI specialists move things forward. You make the decisions that matter.</p>
        </div>
        <button className="button primary" onClick={onNew}>
          <Plus size={17} />
          New ticket
        </button>
      </div>
      <div className="metric-grid">
        {[
          {
            label: 'Ready for review',
            value: report.review,
            detail: 'Your final say is needed',
            icon: FileCheck2,
            tone: 'indigo',
            view: 'review',
            filter: 'all',
          },
          {
            label: 'AI working',
            value: report.working,
            detail: 'Specialists on the case',
            icon: Bot,
            tone: 'cyan',
            view: 'inbox',
            filter: 'in_progress',
          },
          {
            label: 'Needs a decision',
            value: report.blocked,
            detail: 'A little human judgment',
            icon: TriangleAlert,
            tone: 'amber',
            view: 'inbox',
            filter: 'blocked',
          },
          {
            label: 'Closed with approval',
            value: report.resolved,
            detail: 'Verified. Reviewed. Done.',
            icon: CheckCheck,
            tone: 'mint',
            view: 'inbox',
            filter: 'resolved',
          },
        ].map((m) => (
          <button
            key={m.label}
            className={`metric-card ${m.tone}`}
            onClick={() => onNavigate(m.view as 'review' | 'inbox', m.filter)}
          >
            <div>
              <span>{m.label}</span>
              <span className="metric-icon">
                <m.icon size={19} />
              </span>
            </div>
            <strong>{String(m.value).padStart(2, '0')}</strong>
            <p>
              <span className="metric-dot" />
              {m.detail}
              <ArrowUpRight size={14} />
            </p>
          </button>
        ))}
      </div>
      <div className="dashboard-grid">
        <section className="panel attention-panel">
          <div className="section-heading">
            <div>
              <span className="section-kicker">HUMAN IN THE LOOP</span>
              <h2>A little attention goes a long way.</h2>
            </div>
            <button className="text-button" onClick={() => onNavigate('review')}>
              Review queue
              <ArrowRight size={15} />
            </button>
          </div>
          {attention.length ? (
            <div className="attention-list">
              {attention.map((t) => (
                <button key={t.id} className="attention-row" onClick={() => onOpen(t.id)}>
                  <span className={`attention-icon ${t.status === 'blocked' ? 'amber' : 'indigo'}`}>
                    {t.status === 'blocked' ? (
                      <TriangleAlert size={19} />
                    ) : (
                      <FileCheck2 size={19} />
                    )}
                  </span>
                  <span className="attention-main">
                    <strong>{t.subject}</strong>
                    <span>
                      <span>#{String(t.number).padStart(4, '0')}</span>
                      <i />
                      {t.assigneeName || 'Unassigned'}
                      <i />
                      {t.customerName}
                    </span>
                  </span>
                  <span className="attention-status">
                    <StatusBadge status={t.status} />
                    <small>{relative(t.updatedAt)}</small>
                  </span>
                  <ChevronRight size={17} />
                </button>
              ))}
            </div>
          ) : (
            <Empty title="A clear runway">
              Your AI team will bring completed work and blocked requests here for review.
            </Empty>
          )}
          <div className="panel-footer">
            <span>
              <ShieldCheck size={14} />
              Nothing closes without your approval
            </span>
            <button className="text-button" onClick={() => onNavigate('inbox')}>
              All tickets
              <ArrowRight size={14} />
            </button>
          </div>
        </section>
        <section className="panel team-live">
          <div className="section-heading">
            <div>
              <span className="section-kicker">YOUR SPECIALISTS</span>
              <h2>Meet the team.</h2>
            </div>
            <span className="team-total">{agents.length} agents</span>
          </div>
          {agents.map((a) => (
            <button
              key={a.id}
              className="team-live-agent"
              onClick={() => onNavigate('inbox', 'active', a.id)}
            >
              <AgentIcon slug={a.slug} />
              <span>
                <strong>
                  {a.name}
                  <i className={a.enabled ? 'live-dot' : 'offline-dot'} />
                </strong>
                <small>{a.specialty}</small>
                <span>
                  {a.open} active<span>·</span>
                  {a.review} for review
                </span>
              </span>
              <ChevronRight size={16} />
            </button>
          ))}
          <button className="team-manage" onClick={() => onNavigate('agents')}>
            <Settings2 size={15} />
            Manage AI agents
            <ArrowRight size={15} />
          </button>
        </section>
      </div>
      <div className="dashboard-bottom">
        <section className="workflow-strip">
          <span className="workflow-strip-icon">
            <Layers size={23} />
          </span>
          <div>
            <strong>Designed for trust, not just speed.</strong>
            <p>
              Every resolution comes with a summary, supporting sources, and a clear record of what
              happened.
            </p>
          </div>
          <div className="workflow-mini">
            <span>
              <MessageSquare size={14} />
              Ticket
            </span>
            <ChevronRight size={13} />
            <span>
              <Bot size={14} />
              AI
            </span>
            <ChevronRight size={13} />
            <span className="last">
              <ShieldCheck size={14} />
              You
            </span>
          </div>
        </section>
      </div>
      {mode !== 'live' && (
        <div className="demo-disclosure">
          <Sparkles size={15} />
          <span>
            {mode === 'demo'
              ? 'You’re exploring a scripted demo. Sample order actions update local records; generated model replies require a live AI connection.'
              : 'AI is not connected. Configure the server connection to enable specialist replies.'}
          </span>
          <button className="text-button" onClick={() => onNavigate('rules')}>
            View connection
            <ArrowUpRight size={13} />
          </button>
        </div>
      )}
    </>
  );
}
export function AgentsPage({
  canManage = true,
  agents,
  mode,
  onSave,
  onView,
}: {
  canManage?: boolean;
  agents: Agent[];
  mode: AiMode;
  onSave: (id: string, body: unknown) => Promise<void>;
  onView: (id: string) => void;
}) {
  const [editing, setEditing] = useState<Agent | null>(null),
    [instructions, setInstructions] = useState(''),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(''),
    [toggling, setToggling] = useState<string | null>(null);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    setError('');
    try {
      await onSave(editing.id, { instructions });
      setEditing(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">SPECIALISTS, NOT GENERAL GUESSWORK.</span>
          <h1>A team built to help.</h1>
          <p>Give every agent a clear purpose, approved knowledge, and a defined set of actions.</p>
        </div>
        <span className="outline-pill">
          <span className="live-dot" />
          {agents.filter((a) => a.enabled).length} of {agents.length} enabled
        </span>
      </div>
      {error && !editing && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <div className="agent-grid">
        {agents.map((a) => (
          <article className={`agent-card ${!a.enabled ? 'paused' : ''}`} key={a.id}>
            <div className="agent-card-top">
              <AgentIcon slug={a.slug} />
              <span className={`agent-state ${a.enabled ? 'enabled' : ''}`}>
                <i />
                {a.enabled ? 'Enabled' : 'Inactive'}
              </span>
            </div>
            <h2>{a.name}</h2>
            <span className="specialty">{a.specialty}</span>
            <p>{a.description}</p>
            <div className="agent-card-stats">
              <div>
                <strong>{a.open}</strong>
                <span>Active tickets</span>
              </div>
              <div>
                <strong>{a.review}</strong>
                <span>For review</span>
              </div>
              <div>
                <strong>{a.closed}</strong>
                <span>Closed</span>
              </div>
            </div>
            <div className="agent-capabilities">
              <span>
                <BookOpen size={14} />
                {a.articles} approved sources
              </span>
              <span>
                <ShieldCheck size={14} />
                {a.slug === 'orders'
                  ? 'Order lookup + eligible address changes'
                  : 'Knowledge-based guidance'}
              </span>
            </div>
            <div className="agent-card-actions">
              {canManage && (
                <>
                  <button
                    className="button secondary"
                    onClick={() => {
                      setEditing(a);
                      setInstructions(a.instructions);
                      setError('');
                    }}
                  >
                    <Settings2 size={15} />
                    Configure
                  </button>
                  <button
                    className="icon-button bordered"
                    disabled={toggling === a.id}
                    aria-label={`${a.enabled ? 'Deactivate' : 'Enable'} ${a.name}`}
                    onClick={async () => {
                      setToggling(a.id);
                      try {
                        await onSave(a.id, { enabled: !a.enabled });
                      } finally {
                        setToggling(null);
                      }
                    }}
                  >
                    {toggling === a.id ? (
                      <Spinner />
                    ) : a.enabled ? (
                      <Pause size={16} />
                    ) : (
                      <Play size={16} />
                    )}
                  </button>
                </>
              )}
              <button
                className="icon-button"
                aria-label={`View ${a.name} tickets`}
                onClick={() => onView(a.id)}
              >
                <ArrowUpRight size={18} />
              </button>
            </div>
          </article>
        ))}
      </div>
      <div className="agent-principles">
        <div>
          <LockKeyhole size={22} />
          <strong>Bounded by design</strong>
          <p>Each specialist can use only its assigned knowledge and backend-approved actions.</p>
        </div>
        <div>
          <FileCheck2 size={22} />
          <strong>Review comes standard</strong>
          <p>
            AI proposes a resolution. A Support reviewer or Admin checks the evidence and closes the
            ticket.
          </p>
        </div>
        <div>
          <Zap size={22} />
          <strong>One clear owner</strong>
          <p>One agent handles each ticket at a time. Reassignment cancels stale work.</p>
        </div>
      </div>
      <div className="info-banner">
        <Sparkles size={17} />
        <span>
          {mode === 'demo'
            ? 'Runtime: scripted demo. Instructions are saved for live runs; scripted examples follow fixed rules.'
            : mode === 'live'
              ? 'Live runtime: specialist instructions are applied to each model request.'
              : 'Live runtime is not configured. Agent runs will report a visible setup error.'}
        </span>
      </div>
      {editing && (
        <Modal title={`Configure ${editing.name}`} onClose={() => setEditing(null)}>
          <form className="stack-form" onSubmit={save}>
            <div className="info-banner">
              Changing instructions stops in-flight work so outdated guidance cannot be published.
              Rerun affected tickets afterward.
            </div>
            <label>
              Agent instructions
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                minLength={20}
                maxLength={4000}
                required
                rows={7}
              />
            </label>
            {error && (
              <div className="error-banner" role="alert">
                {error}
              </div>
            )}
            <div className="modal-actions">
              <button className="button secondary" type="button" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="button primary" disabled={saving}>
                {saving ? <Spinner /> : <Check size={16} />}Save instructions
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
export function KnowledgePage({
  articles,
  agents,
  onSave,
}: {
  articles: Article[];
  agents: Agent[];
  onSave: (id: string | null, body: unknown) => Promise<void>;
}) {
  const [search, setSearch] = useState(''),
    [agentId, setAgentId] = useState('all'),
    [editing, setEditing] = useState<Article | null | undefined>(undefined),
    [title, setTitle] = useState(''),
    [content, setContent] = useState(''),
    [owner, setOwner] = useState(''),
    [enabled, setEnabled] = useState(true),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const shown = articles.filter(
    (a) =>
      (agentId === 'all' || a.agentId === agentId) &&
      [a.title, a.content].some((v) => v.toLowerCase().includes(search.toLowerCase())),
  );
  function open(article: Article | null) {
    setEditing(article);
    setTitle(article?.title || '');
    setContent(article?.content || '');
    setOwner(article?.agentId || agents[0]?.id || '');
    setEnabled(article?.enabled ?? true);
    setError('');
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSave(editing?.id || null, { agentId: owner, title, content, enabled });
      setEditing(undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">BETTER SOURCES. BETTER SUPPORT.</span>
          <h1>Give your AI solid ground.</h1>
          <p>Approved guidance for each specialist. Clear sources behind every answer.</p>
        </div>
        <button className="button primary" onClick={() => open(null)}>
          <Plus size={17} />
          New article
        </button>
      </div>
      <section className="panel knowledge-panel">
        <div className="table-toolbar">
          <div className="search-field">
            <Search size={17} />
            <input
              aria-label="Search knowledge"
              placeholder="Search your knowledge base…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            aria-label="Filter knowledge by agent"
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
          >
            <option value="all">All specialists</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        {shown.length ? (
          shown.map((a) => (
            <button className="article-row" key={a.id} onClick={() => open(a)}>
              <span className="article-icon">
                <FileText size={22} />
              </span>
              <span>
                <strong>{a.title}</strong>
                <p>{a.content}</p>
                <small>
                  {a.agentName}
                  <i />
                  Updated {relative(a.updatedAt)}
                </small>
              </span>
              <span className={`article-status ${a.enabled ? 'enabled' : ''}`}>
                {a.enabled ? 'Approved' : 'Disabled'}
              </span>
              <ChevronRight size={17} />
            </button>
          ))
        ) : (
          <Empty title="No matching articles">Add an article or choose a different search.</Empty>
        )}
        <div className="panel-footer">
          <span>
            <BookOpen size={14} />
            {articles.filter((a) => a.enabled).length} enabled sources
          </span>
          <span>Changes apply to future AI runs</span>
        </div>
      </section>
      {editing !== undefined && (
        <Modal
          title={editing ? 'Edit knowledge article' : 'Add a knowledge article'}
          onClose={() => setEditing(undefined)}
        >
          <form className="stack-form" onSubmit={save}>
            <label>
              Title
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                minLength={3}
                maxLength={160}
                required
              />
            </label>
            <label>
              Assigned specialist
              <select value={owner} onChange={(e) => setOwner(e.target.value)}>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Approved guidance
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                minLength={20}
                maxLength={12000}
                rows={9}
                required
              />
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              Available to this specialist
            </label>
            {error && (
              <div className="error-banner" role="alert">
                {error}
              </div>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => setEditing(undefined)}
              >
                Cancel
              </button>
              <button className="button primary" disabled={busy}>
                {busy ? <Spinner /> : <Check size={16} />}Save article
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
export function RulesPage({ mode }: { mode: AiMode }) {
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">POWERFUL WITHIN CLEAR BOUNDARIES.</span>
          <h1>Capability, with accountability.</h1>
          <p>
            The backend validates every action. The AI never gets to change its own permissions.
          </p>
        </div>
        <span className="outline-pill">
          <ShieldCheck size={15} />
          Server-enforced policies
        </span>
      </div>
      <div className="rules-grid">
        {[
          {
            name: 'Approved knowledge',
            icon: BookOpen,
            agent: 'All specialists',
            text: 'Search enabled articles assigned to the current specialist. Responses include source references for administrator review.',
            rules: [
              'Agent-specific source access',
              'Disabled articles excluded from new runs',
              'Unsupported answers move to Needs decision',
            ],
          },
          {
            name: 'Customer order lookup',
            icon: Search,
            agent: 'Relay Orders',
            text: 'Read order records belonging to the ticket’s customer. Ownership comes from the authenticated ticket, never a model-supplied customer ID.',
            rules: [
              'Customer ownership checked',
              'Status and tracking retrieved from the database',
              'No access to another customer’s orders',
            ],
          },
          {
            name: 'Delivery address update',
            icon: Settings2,
            agent: 'Relay Orders',
            text: 'Update a preparing order when the customer explicitly provides a complete replacement address. Changes are verified after saving.',
            rules: [
              'Preparing orders only',
              'Customer must use “New address: …”',
              'Shipped orders require an admin decision',
            ],
          },
          {
            name: 'Ticket closure',
            icon: ShieldCheck,
            agent: 'Support & Admin',
            text: 'Approve a current AI resolution proposal and record the reviewer and approval note. The model has no ticket-closing capability.',
            rules: [
              'Current conversation version required',
              'Only one approval can succeed',
              'New customer replies invalidate stale proposals',
            ],
          },
        ].map((p) => (
          <section className="panel policy-card" key={p.name}>
            <span className="policy-icon">
              <p.icon size={22} />
            </span>
            <span className="pill">{p.agent}</span>
            <h2>{p.name}</h2>
            <p>{p.text}</p>
            <ul>
              {p.rules.map((r) => (
                <li key={r}>
                  <Check size={14} />
                  {r}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <section className="panel connection-panel">
        <div>
          <span className="section-kicker">AI CONNECTION</span>
          <h2>
            {mode === 'live'
              ? 'Live model runtime is configured'
              : mode === 'demo'
                ? 'You’re exploring the scripted demo'
                : 'Connect your AI runtime'}
          </h2>
          <p>
            {mode === 'demo'
              ? 'The demo runs fixed, transparent scenarios and writes to the local sample store. It does not call a model or incur model usage.'
              : 'Provider credentials stay on the server and never enter the browser.'}
          </p>
        </div>
        <span className={`mode-pill ${mode}`}>
          <i />
          {mode === 'live' ? 'Live AI' : mode === 'demo' ? 'Scripted demo' : 'Not connected'}
        </span>
        <div className="connection-instructions">
          <strong>Enable live generation locally</strong>
          <p>
            Set <code>OPENAI_API_KEY</code> and <code>AI_MODE=live</code> in the repository’s
            ignored <code>.env</code>, then restart the API. <code>OPENAI_MODEL</code> selects the
            model. Never paste a key into a ticket or knowledge article.
          </p>
        </div>
      </section>
    </>
  );
}
