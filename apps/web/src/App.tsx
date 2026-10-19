import { TeamPage } from './Team';
import { useRoute, goRoute, readRoute, viewPaths, type View } from './routes';
import { Appearance } from './Appearance';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  Bot,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Command,
  FileCheck2,
  HelpCircle,
  Inbox,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import type {
  User,
  Ticket,
  TicketDetail,
  Agent,
  Article,
  Report,
  AiMode,
  Status,
} from '@relaydesk/contracts';
import { ApiError, api, post, patch } from './api';
import {
  AgentIcon,
  Avatar,
  Brand,
  Empty,
  Modal,
  PriorityBadge,
  Spinner,
  StatusBadge,
  relative,
} from './components';
import { Login } from './Login';
import { TicketConversation, NewTicket } from './TicketConversation';
import { AgentsPage, KnowledgePage, RulesPage, CommandCenter } from './Overview';
const Performance = lazy(() => import('./Performance').then((m) => ({ default: m.Performance })));

type Alert = {
  id: string;
  ticketId: string;
  body: string;
  readAt: string | null;
  createdAt: string;
};
const titles: Record<View, string> = {
  overview: 'Command center',
  inbox: 'All tickets',
  review: 'Review queue',
  agents: 'AI agents',
  knowledge: 'Knowledge base',
  rules: 'Actions & rules',
  analytics: 'Performance',
  team: 'People & access',
};
export default function App() {
  const [user, setUser] = useState<User | null>(null),
    [boot, setBoot] = useState(true),
    [demo, setDemo] = useState(false),
    [mode, setMode] = useState<AiMode>('unavailable');
  const route = useRoute(),
    view = route.view,
    selected = route.ticketId;
  const [tickets, setTickets] = useState<Ticket[]>([]),
    [agents, setAgents] = useState<Agent[]>([]),
    [articles, setArticles] = useState<Article[]>([]),
    [report, setReport] = useState<Report | null>(null),
    [users, setUsers] = useState<User[]>([]),
    [alerts, setAlerts] = useState<Alert[]>([]);
  const [detail, setDetail] = useState<TicketDetail | null>(null),
    [detailLoading, setDetailLoading] = useState(false),
    [dataLoading, setDataLoading] = useState(true);
  const [search, setSearch] = useState(''),
    [status, setStatus] = useState('all'),
    [agentFilter, setAgentFilter] = useState('all'),
    [connected, setConnected] = useState(false);
  const [error, setError] = useState(''),
    [toast, setToast] = useState(''),
    [newOpen, setNewOpen] = useState(false),
    [helpOpen, setHelpOpen] = useState(false),
    [alertsOpen, setAlertsOpen] = useState(false),
    [mobileOpen, setMobileOpen] = useState(false),
    [busy, setBusy] = useState(false);
  const selectedRef = useRef(selected),
    detailVersion = useRef(0),
    refreshVersion = useRef(0),
    socket = useRef<Socket | null>(null),
    searchInput = useRef<HTMLInputElement>(null),
    alertsWrap = useRef<HTMLDivElement>(null);
  selectedRef.current = selected;
  const staff = !!user && user.role !== 'customer',
    canAdmin = user?.role === 'admin';
  const refreshDetail = useCallback(async (id: string) => {
    const version = ++detailVersion.current;
    try {
      const next = await api<TicketDetail>(`/tickets/${id}`);
      if (selectedRef.current === id && detailVersion.current === version) setDetail(next);
    } catch (e) {
      if (selectedRef.current === id) {
        setError((e as Error).message);
        if (e instanceof ApiError && (e.status === 404 || e.status === 403)) setDetail(null);
      }
    } finally {
      if (selectedRef.current === id && detailVersion.current === version) setDetailLoading(false);
    }
  }, []);
  const refresh = useCallback(async () => {
    if (!user) return;
    const version = ++refreshVersion.current;
    try {
      const list = await api<{ tickets: Ticket[] }>('/tickets');
      if (version !== refreshVersion.current) return;
      setTickets(list.tickets);
      if (user.role !== 'customer') {
        const [a, k, r, u, n] = await Promise.all([
          api<{ agents: Agent[] }>('/agents'),
          api<{ articles: Article[] }>('/knowledge'),
          api<Report>('/reports'),
          api<{ users: User[] }>('/users'),
          api<{ notifications: Alert[] }>('/notifications'),
        ]);
        if (version !== refreshVersion.current) return;
        setAgents(a.agents);
        setArticles(k.articles);
        setReport(r);
        setUsers(u.users);
        setAlerts(n.notifications);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (version === refreshVersion.current) setDataLoading(false);
    }
  }, [user]);
  useEffect(() => {
    let active = true;
    void Promise.all([
      api<{ demoMode: boolean; aiMode: AiMode }>('/config').then((r) => {
        if (active) {
          setDemo(r.demoMode);
          setMode(r.aiMode);
        }
      }),
      api<{ user: User }>('/auth/me')
        .then((r) => {
          if (active) {
            setUser(r.user);
            if (r.user.role === 'customer' && !readRoute().ticketId && !readRoute().notFound)
              goRoute('/tickets', true);
          }
        })
        .catch(() => {}),
    ]).finally(() => {
      if (active) setBoot(false);
    });
    const logout = () => {
      setUser(null);
      setDetail(null);
    };
    const shortcut = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchInput.current?.focus();
      }
    };
    window.addEventListener('relaydesk:unauthorized', logout);
    window.addEventListener('keydown', shortcut);
    return () => {
      active = false;
      window.removeEventListener('relaydesk:unauthorized', logout);
      window.removeEventListener('keydown', shortcut);
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!user) return;
    setDataLoading(true);
    void refresh();
    const client = io({ withCredentials: true });
    socket.current = client;
    const update = () => {
      void refresh();
      if (selectedRef.current) void refreshDetail(selectedRef.current);
    };
    client.on('connect', () => {
      setConnected(true);
      update();
      if (selectedRef.current)
        client.emit('ticket:join', selectedRef.current, () => {
          if (selectedRef.current) void refreshDetail(selectedRef.current);
        });
    });
    client.on('disconnect', () => setConnected(false));
    client.on('connect_error', () => setConnected(false));
    client.on('ticket:updated', update);
    client.on('workspace:updated', update);
    const timer = setInterval(update, 10000);
    window.addEventListener('focus', update);
    return () => {
      clearInterval(timer);
      client.disconnect();
      socket.current = null;
      window.removeEventListener('focus', update);
    };
  }, [user, refresh, refreshDetail]);
  useEffect(() => {
    if (!selected || !user) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    setDetail(null);
    void refreshDetail(selected);
    socket.current?.emit('ticket:join', selected, (r: { ok: boolean }) => {
      if (r.ok) void refreshDetail(selected);
    });
    return () => {
      socket.current?.emit('ticket:leave', selected);
    };
  }, [selected, user, refreshDetail]);
  function navigate(next: View, filter = 'all', agent = 'all') {
    const query = new URLSearchParams();
    if (filter !== 'all') query.set('status', filter);
    if (agent !== 'all') query.set('agent', agent);
    goRoute(viewPaths[next] + (query.size ? '?' + query.toString() : ''));
    setStatus(filter);
    setAgentFilter(agent);
    setError('');
    setMobileOpen(false);
    setSearch('');
    setAlertsOpen(false);
  }
  function openTicket(id: string) {
    goRoute('/tickets/' + id);
    setError('');
    setAlertsOpen(false);
  }
  useEffect(() => {
    if (!alertsOpen) return;
    const outside = (e: PointerEvent) => {
      if (!alertsWrap.current?.contains(e.target as Node)) setAlertsOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAlertsOpen(false);
        alertsWrap.current?.querySelector<HTMLButtonElement>('button')?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [alertsOpen]);
  useEffect(() => {
    setAlertsOpen(false);
    setMobileOpen(false);
    setError('');
    const q = new URLSearchParams(window.location.search);
    setStatus(q.get('status') || 'all');
    setAgentFilter(q.get('agent') || 'all');
  }, [route.location]);
  async function mutate(
    path: string,
    body: unknown = {},
    method: 'post' | 'patch' = 'patch',
    message = 'Changes saved.',
  ) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await (method === 'post' ? post : patch)(path, body);
      setToast(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      await refresh();
      if (selectedRef.current) await refreshDetail(selectedRef.current);
      setBusy(false);
    }
  }
  async function logout() {
    try {
      await post('/auth/logout');
      setUser(null);
      goRoute('/', true);
      setTickets([]);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (boot)
    return (
      <div className="boot">
        <Brand />
        <Spinner />
        <p>Preparing your workspace…</p>
      </div>
    );
  if (!user)
    return (
      <Login
        demo={demo}
        mode={mode}
        onLogin={(u) => {
          setUser(u);
          if (u.role === 'customer' && !readRoute().ticketId && !readRoute().notFound)
            goRoute('/tickets', true);
          setStatus('all');
          setSearch('');
          setError('');
        }}
      />
    );
  const reviewCount = tickets.filter((t) => t.status === 'review').length,
    active = tickets.filter((t) => t.status !== 'resolved').length;
  let filtered = tickets.filter(
    (t) =>
      (view !== 'review' || t.status === 'review') &&
      (status === 'all' ||
        (status === 'active'
          ? t.status !== 'resolved'
          : status === 'unassigned'
            ? !t.assigneeId && t.status !== 'resolved'
            : t.status === status)) &&
      (agentFilter === 'all' || t.assigneeId === agentFilter),
  );
  if (search.trim()) {
    const q = search.trim().toLowerCase();
    filtered = filtered.filter((t) =>
      [t.subject, t.customerName, t.assigneeName || '', String(t.number), t.description].some((v) =>
        v.toLowerCase().includes(q),
      ),
    );
  }
  const nav = [
    { id: 'overview' as View, label: 'Command center', icon: LayoutDashboard },
    { id: 'inbox' as View, label: 'All tickets', icon: Inbox, count: active },
    { id: 'review' as View, label: 'Review queue', icon: FileCheck2, count: reviewCount },
    { id: 'agents' as View, label: 'AI agents', icon: Bot },
  ];
  return (
    <div className="workspace">
      <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
        <Brand />
        <div className="workspace-switch">
          <span className="workspace-letter">R</span>
          <div>
            <strong>Relay workspace</strong>
            <small>
              {canAdmin ? 'Admin workspace' : staff ? 'Support workspace' : 'Customer portal'}
            </small>
          </div>
          <ChevronDown size={14} />
        </div>
        <span className="nav-label">{staff ? 'WORKSPACE' : 'YOUR SUPPORT'}</span>
        <nav>
          {(staff
            ? nav
            : [{ id: 'inbox' as View, label: 'My tickets', icon: Inbox, count: active }]
          ).map((item) => (
            <button
              key={item.id}
              className={`nav-item ${view === item.id ? 'active' : ''}`}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={19} />
              {item.label}
              {'count' in item && item.count !== undefined && item.count > 0 && (
                <span className={item.id === 'review' ? 'nav-count highlight' : 'nav-count'}>
                  {item.count}
                </span>
              )}
            </button>
          ))}
        </nav>
        {staff && (
          <>
            <span className="nav-label second">INTELLIGENCE</span>
            <nav>
              {canAdmin && (
                <>
                  <button
                    className={`nav-item ${view === 'knowledge' ? 'active' : ''}`}
                    onClick={() => navigate('knowledge')}
                  >
                    <BookOpen size={19} />
                    Knowledge base
                  </button>
                  <button
                    className={`nav-item ${view === 'rules' ? 'active' : ''}`}
                    onClick={() => navigate('rules')}
                  >
                    <SlidersHorizontal size={19} />
                    Actions & rules
                  </button>
                </>
              )}
              <button
                className={`nav-item ${view === 'analytics' ? 'active' : ''}`}
                onClick={() => navigate('analytics')}
              >
                <Activity size={19} />
                Performance
              </button>
              {canAdmin && (
                <button
                  className={`nav-item ${view === 'team' ? 'active' : ''}`}
                  onClick={() => navigate('team')}
                >
                  <ShieldCheck size={19} />
                  People & access
                </button>
              )}
            </nav>
            <div className="sidebar-agents">
              <div>
                <span>YOUR AI TEAM</span>
                <span>{agents.filter((a) => a.enabled).length} active</span>
              </div>
              {agents.map((a) => (
                <button key={a.id} onClick={() => navigate('inbox', 'active', a.id)}>
                  <AgentIcon slug={a.slug} small />
                  <span>{a.name}</span>
                  <i className={a.enabled ? 'enabled' : ''} />
                </button>
              ))}
            </div>
          </>
        )}
        <div className="sidebar-bottom">
          <div className="sidebar-promise">
            <ShieldCheck size={17} />
            <span>
              AI does the work.
              <br />
              <strong>You make the final call.</strong>
            </span>
          </div>
          <button className="nav-item guide-link" onClick={() => setHelpOpen(true)}>
            <HelpCircle size={18} />
            Workspace guide
            <ArrowUpRight size={14} />
          </button>
          <div className="profile">
            <Avatar name={user.name} />
            <span>
              <strong>{user.name}</strong>
              <small>{canAdmin ? 'Administrator' : staff ? 'Support' : 'Customer'}</small>
            </span>
            <button className="icon-button" onClick={() => void logout()} aria-label="Sign out">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>
      {mobileOpen && (
        <button
          className="sidebar-overlay"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation"
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
            >
              <Menu size={20} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{selected ? 'Ticket detail' : staff ? titles[view] : 'My tickets'}</strong>
          </div>
          <div className="header-search">
            <Search size={16} />
            <input
              ref={searchInput}
              aria-label="Find a ticket"
              placeholder="Find a ticket…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                goRoute('/tickets');
                setStatus('all');
              }}
            />
            <kbd>⌘ K</kbd>
          </div>
          <div className="topbar-actions">
            <Appearance />
            <span className={`mode-pill ${mode}`}>
              <i />
              {mode === 'live' ? 'Live AI' : mode === 'demo' ? 'Scripted demo' : 'AI not connected'}
            </span>
            {staff && (
              <div className="alerts-wrap" ref={alertsWrap}>
                <button
                  className="icon-button"
                  aria-label="Notifications"
                  aria-expanded={alertsOpen}
                  aria-controls="notification-popover"
                  onClick={() => {
                    setAlertsOpen(!alertsOpen);
                    if (!alertsOpen)
                      void patch('/notifications/read', {})
                        .then(() =>
                          setAlerts((n) =>
                            n.map((x) => ({ ...x, readAt: new Date().toISOString() })),
                          ),
                        )
                        .catch((e) => setError(e.message));
                  }}
                >
                  <Bell size={19} />
                  {alerts.some((n) => !n.readAt) && <span className="notification-dot" />}
                </button>
                {alertsOpen && (
                  <div
                    className="alerts-popover"
                    id="notification-popover"
                    role="region"
                    aria-label="Notifications"
                  >
                    <h3>Notifications</h3>
                    {alerts.length ? (
                      alerts.map((n) => (
                        <button key={n.id} onClick={() => openTicket(n.ticketId)}>
                          <span>
                            {n.body}
                            <small>{relative(n.createdAt)}</small>
                          </span>
                          <ChevronRight size={14} />
                        </button>
                      ))
                    ) : (
                      <p>No deadline alerts. You’re all caught up.</p>
                    )}
                  </div>
                )}
              </div>
            )}
            <Avatar name={user.name} small />
          </div>
        </header>
        <main className="main-content">
          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button onClick={() => setError('')} aria-label="Dismiss error">
                <X size={17} />
              </button>
            </div>
          )}
          {!canAdmin && ['knowledge', 'rules', 'team'].includes(view) ? (
            <Empty title="Administrator access required">
              Ask an administrator to manage workspace settings.
            </Empty>
          ) : route.notFound ? (
            <Empty title="Page not found">
              <p>This workspace link does not exist.</p>
              <button
                className="button secondary"
                onClick={() => navigate(staff ? 'overview' : 'inbox')}
              >
                Back to workspace
              </button>
            </Empty>
          ) : selected ? (
            detailLoading ? (
              <div className="loading">
                <Spinner />
                Opening conversation…
              </div>
            ) : !detail ? (
              <Empty title="Ticket unavailable">
                <p>This ticket may not exist or your account may not have access.</p>
                <button className="button secondary" onClick={() => navigate('inbox')}>
                  Back to tickets
                </button>
              </Empty>
            ) : (
              <TicketConversation
                detail={detail}
                user={user}
                agents={agents}
                mode={mode}
                busy={busy}
                onBack={() => navigate('inbox')}
                onUpdate={(body) =>
                  void mutate(`/tickets/${selected}`, {
                    ...body,
                    expectedRevision: detail.ticket.revision,
                  })
                }
                onReview={(decision, feedback) =>
                  void mutate(
                    `/tickets/${selected}/review`,
                    {
                      reviewId: detail.review?.id,
                      expectedRevision: detail.ticket.revision,
                      decision,
                      feedback,
                    },
                    'post',
                    decision === 'approve'
                      ? 'Resolution approved. Ticket closed.'
                      : 'Revision sent to the AI agent.',
                  )
                }
                onRun={() =>
                  void mutate(
                    `/tickets/${selected}/run`,
                    { expectedRevision: detail.ticket.revision },
                    'post',
                    'Preparing a private response draft. Review it before sending.',
                  )
                }
                onReopen={() =>
                  void mutate(`/tickets/${selected}/reopen`, {}, 'post', 'Ticket reopened.')
                }
                onSent={() => {
                  void refresh();
                  void refreshDetail(selected);
                }}
              />
            )
          ) : dataLoading ? (
            <div className="loading">
              <Spinner />
              Syncing your workspace…
            </div>
          ) : staff && view === 'overview' && report ? (
            <CommandCenter
              report={report}
              agents={agents}
              tickets={tickets}
              mode={mode}
              onOpen={openTicket}
              onNavigate={navigate}
              onNew={() => setNewOpen(true)}
            />
          ) : canAdmin && view === 'team' ? (
            <TeamPage users={users} onChanged={() => void refresh()} />
          ) : staff && view === 'agents' ? (
            <AgentsPage
              canManage={canAdmin}
              agents={agents}
              mode={mode}
              onSave={async (id, body) => {
                await patch(`/agents/${id}`, body);
                await refresh();
                setToast('AI agent settings saved.');
              }}
              onView={(id) => navigate('inbox', 'active', id)}
            />
          ) : staff && view === 'knowledge' ? (
            <KnowledgePage
              articles={articles}
              agents={agents}
              onSave={async (id, body) => {
                await (id ? patch(`/knowledge/${id}`, body) : post('/knowledge', body));
                await refresh();
                setToast('Knowledge saved. Future runs will use the updated article.');
              }}
            />
          ) : staff && view === 'rules' ? (
            <RulesPage mode={mode} />
          ) : staff && view === 'analytics' && report ? (
            <Suspense
              fallback={
                <div
                  className="report-loading"
                  role="status"
                  aria-label="Loading performance reports"
                >
                  <Spinner />
                </div>
              }
            >
              <Performance />
            </Suspense>
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">
                    {staff
                      ? view === 'review'
                        ? 'HUMAN JUDGMENT. AI MOMENTUM.'
                        : 'EVERY CONVERSATION, ACCOUNTED FOR.'
                      : 'YOUR CONVERSATION STARTS HERE.'}
                  </span>
                  <h1>
                    {staff
                      ? view === 'review'
                        ? 'Ready for your final say.'
                        : 'Every ticket. One clear view.'
                      : 'A little help, a lot less waiting.'}
                  </h1>
                  <p>
                    {staff
                      ? view === 'review'
                        ? 'Review the evidence, request a revision, or approve and close.'
                        : 'Follow the work from first question to your final approval.'
                      : 'Tell us what’s happening. Our support team will take it from here.'}
                  </p>
                </div>
                <button className="button primary" onClick={() => setNewOpen(true)}>
                  <Plus size={17} />
                  {staff ? 'New ticket' : 'Submit a ticket'}
                </button>
              </div>
              <section className="panel ticket-panel">
                <div className="ticket-tabs">
                  {(view === 'review'
                    ? [{ id: 'all', label: 'Awaiting review', count: reviewCount }]
                    : [
                        { id: 'all', label: 'All tickets', count: tickets.length },
                        { id: 'review', label: 'For review', count: reviewCount },
                        {
                          id: 'in_progress',
                          label: 'AI working',
                          count: tickets.filter((t) => t.status === 'in_progress').length,
                        },
                        {
                          id: 'blocked',
                          label: 'Needs decision',
                          count: tickets.filter((t) => t.status === 'blocked').length,
                        },
                        {
                          id: 'resolved',
                          label: 'Closed',
                          count: tickets.filter((t) => t.status === 'resolved').length,
                        },
                      ]
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      className={status === tab.id ? 'active' : ''}
                      onClick={() => setStatus(tab.id)}
                    >
                      {tab.label}
                      <span>{tab.count}</span>
                    </button>
                  ))}
                </div>
                <div className="table-toolbar">
                  <div className="search-field">
                    <Search size={16} />
                    <input
                      aria-label="Search tickets"
                      placeholder="Search conversations, customers, or ticket number…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  {staff && (
                    <select
                      aria-label="Filter by AI agent"
                      value={agentFilter}
                      onChange={(e) => setAgentFilter(e.target.value)}
                    >
                      <option value="all">All AI agents</option>
                      {agents.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                {filtered.length ? (
                  <div className="table-scroll">
                    <table className="ticket-table">
                      <thead>
                        <tr>
                          <th>TICKET</th>
                          <th>CONVERSATION</th>
                          <th>STATUS</th>
                          {staff && <th>AI AGENT</th>}
                          <th>PRIORITY</th>
                          <th>UPDATED</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((t) => (
                          <tr key={t.id} onClick={() => openTicket(t.id)}>
                            <td className="ticket-number">#{String(t.number).padStart(4, '0')}</td>
                            <td className="subject-cell">
                              <a
                                className="ticket-subject-link"
                                href={'/tickets/' + t.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
                                    e.preventDefault();
                                    openTicket(t.id);
                                  }
                                }}
                              >
                                {t.subject}
                              </a>
                              <div>
                                {staff && <Avatar name={t.customerName} small />}
                                <span>{staff ? t.customerName : t.description}</span>
                                {t.overdue && <span className="overdue-text">Overdue</span>}
                              </div>
                            </td>
                            <td>
                              <StatusBadge status={t.status} />
                            </td>
                            {staff && (
                              <td>
                                {t.assigneeName ? (
                                  <span className="agent-cell">
                                    <AgentIcon slug={t.agentSlug} small />
                                    {t.assigneeName}
                                  </span>
                                ) : (
                                  <span className="unassigned">Unassigned</span>
                                )}
                              </td>
                            )}
                            <td>
                              <PriorityBadge priority={t.priority} />
                            </td>
                            <td className="time-cell">{relative(t.updatedAt)}</td>
                            <td>
                              <ChevronRight size={16} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty
                    title={
                      search
                        ? 'No matching conversations'
                        : view === 'review'
                          ? 'Your review queue is clear'
                          : 'Nothing in this view yet'
                    }
                  >
                    {search
                      ? 'Try a different search or AI agent filter.'
                      : view === 'review'
                        ? 'AI-proposed resolutions will appear here when they are ready for your decision.'
                        : 'Submit a ticket or choose another filter to get started.'}
                  </Empty>
                )}
                <div className="panel-footer">
                  <span>
                    <i className={connected ? 'live-dot' : 'offline-dot'} />
                    {connected
                      ? 'Connected · updates arrive live'
                      : 'Reconnecting · updates will resume'}
                  </span>
                  <span>{filtered.length} conversations</span>
                </div>
              </section>
              {mode === 'demo' && (
                <div className="demo-disclosure">
                  <Sparkles size={15} />
                  <span>
                    Interactive demo: agent replies follow scripted examples. Order changes persist
                    in the local sample store. Live AI connects separately.
                  </span>
                </div>
              )}
            </>
          )}
        </main>
        <footer className="workspace-footer">
          <span>
            <span className="footer-square" />
            RELAYDESK <span>/</span> INTELLIGENT SUPPORT, ACCOUNTABLE BY DESIGN.
          </span>
          <span>
            <ShieldCheck size={13} />
            Every closure is approved by an admin
          </span>
        </footer>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          <span>{toast}</span>
          <button aria-label="Dismiss notification" onClick={() => setToast('')}>
            <X size={16} />
          </button>
        </div>
      )}
      {newOpen && (
        <NewTicket
          user={user}
          users={users}
          agents={agents}
          onClose={() => setNewOpen(false)}
          onCreated={(d) => {
            setNewOpen(false);
            void refresh();
            openTicket(d.ticket.id);
            setToast('Ticket created.');
          }}
        />
      )}
      {helpOpen && (
        <Modal title="Your AI team. Your final say." onClose={() => setHelpOpen(false)}>
          <div className="guide-list">
            <div>
              <Bot />
              <span>
                <strong>Assign a specialist</strong>
                <p>
                  Choose Relay Support, Orders, or Billing. Each uses its own approved knowledge and
                  permitted actions.
                </p>
              </span>
            </div>
            <div>
              <FileCheck2 />
              <span>
                <strong>Review the evidence</strong>
                <p>
                  The AI submits a summary, sources, and an execution record. Ask for more work when
                  something is missing.
                </p>
              </span>
            </div>
            <div>
              <ShieldCheck />
              <span>
                <strong>Approve and close</strong>
                <p>
                  Only an administrator can close a ticket. New customer replies invalidate an old
                  resolution proposal.
                </p>
              </span>
            </div>
          </div>
          <div className="info-banner">
            {mode === 'demo'
              ? 'This workspace uses clearly labelled scripted examples. Connect a server-side API key to use live AI.'
              : mode === 'live'
                ? 'Live AI is connected. Model replies are validated by the backend.'
                : 'Live AI is not configured. Runs will stop with a visible setup error.'}
          </div>
          <button className="button primary full" onClick={() => setHelpOpen(false)}>
            Got it
            <ArrowRight size={16} />
          </button>
        </Modal>
      )}
    </div>
  );
}
