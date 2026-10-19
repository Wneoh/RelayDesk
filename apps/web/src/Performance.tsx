import { ActivityChart } from './PerformanceCharts';
import { useEffect, useState } from 'react';
import {
  Activity,
  ArrowDownToLine,
  CheckCheck,
  Clock3,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import type { PerformanceReport, Timing } from '@relaydesk/contracts';
import { api } from './api';
import { duration, Spinner } from './components';

const number = (value: number) => value.toLocaleString();
const rate = (value: number, total: number) =>
  total ? `${Math.round((value / total) * 100)}%` : '—';
const modeName = (mode: string) =>
  mode === 'all'
    ? 'All AI modes'
    : mode === 'demo'
      ? 'Scripted demo'
      : mode === 'live'
        ? 'Live AI'
        : 'Not connected';
function csv(report: PerformanceReport) {
  const rows: (string | number | null)[][] = [['Section', 'Metric', 'Value', 'Unit', 'Context']];
  const add = (
    section: string,
    metric: string,
    value: string | number | null,
    unit = 'count',
    context = '',
  ) => rows.push([section, metric, value, unit, context]);
  add('Window', 'From', report.window.from, 'UTC');
  add('Window', 'Through', report.window.to, 'UTC');
  add('Window', 'AI mode', report.window.mode, 'mode');
  for (const [k, v] of Object.entries(report.tickets))
    if (typeof v === 'number') add('Tickets', k, v);
  for (const [k, v] of Object.entries(report.runs))
    if (typeof v === 'number') add('AI runs', k, v, k.includes('Tokens') ? 'tokens' : 'count');
  for (const [k, v] of Object.entries(report.reviews))
    if (typeof v === 'number') add('Reviews', k, v);
  for (const [name, t] of [
    ['First response', report.tickets.firstResponse],
    ['Closure', report.tickets.closure],
    ['AI run including queue', report.runs.duration],
    ['Human review', report.reviews.wait],
  ] as [string, Timing][]) {
    add('Timings', `${name}: samples`, t.count);
    for (const stat of ['average', 'p50', 'p95'] as const)
      add('Timings', `${name}: ${stat}`, t[stat], 'minutes');
  }
  for (const [k, v] of Object.entries(report.backlog))
    if (typeof v === 'number' || v === null)
      add('Current backlog', k, v, k === 'oldestMinutes' ? 'minutes' : 'count');
  report.backlog.ages.forEach((a) => add('Backlog age', a.label, a.count));
  report.backlog.priorities.forEach((p) => {
    add('Backlog priority', p.priority, p.count);
    add('Backlog overdue', p.priority, p.overdue);
  });
  report.agents.forEach((a) =>
    Object.entries(a).forEach(([k, v]) => {
      if (typeof v === 'number' || v === null)
        add(
          'Specialist',
          k,
          v,
          k === 'avgRunMinutes' ? 'minutes' : k === 'tokens' ? 'tokens' : 'count',
          a.name,
        );
    }),
  );
  report.trend.forEach((d) =>
    Object.entries(d).forEach(([k, v]) => {
      if (k !== 'day')
        add('Daily activity', k, v, k.includes('Tokens') ? 'tokens' : 'count', d.day);
    }),
  );
  const escape = (v: string | number | null) =>
    `"${String(v ?? '')
      .replace(/^(?=[\s]*[=+\-@])/, "'")
      .replaceAll('"', '""')}"`;
  const url = URL.createObjectURL(
    new Blob(['\uFEFF' + rows.map((r) => r.map(escape).join(',')).join('\r\n')], {
      type: 'text/csv;charset=utf-8;',
    }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = `relaydesk-performance-${report.window.days}d-${report.window.mode}-${report.window.to.slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function TimeRow({ name, detail, time }: { name: string; detail: string; time: Timing }) {
  return (
    <tr>
      <th scope="row">
        <strong>{name}</strong>
        <small>{detail}</small>
      </th>
      <td>{duration(time.average)}</td>
      <td>{duration(time.p50)}</td>
      <td>{duration(time.p95)}</td>
      <td>{number(time.count)}</td>
    </tr>
  );
}
function Trend({ report }: { report: PerformanceReport }) {
  const [metric, setMetric] = useState<'tickets' | 'runs' | 'tokens'>('tickets');
  const keys =
    metric === 'tickets'
      ? (['opened', 'closed'] as const)
      : metric === 'runs'
        ? (['completed', 'failed'] as const)
        : (['inputTokens', 'outputTokens'] as const);
  const names =
    metric === 'tickets'
      ? ['Opened', 'Closed']
      : metric === 'runs'
        ? ['Completed', 'Failed']
        : ['Input tokens', 'Output tokens'];
  return (
    <section className="panel performance-chart">
      <div className="section-heading">
        <div>
          <span className="section-kicker">DAILY ACTIVITY · UTC</span>
          <h2>From conversation to closure.</h2>
        </div>
        <label className="sr-only" htmlFor="trend-metric">
          Chart metric
        </label>
        <select
          id="trend-metric"
          value={metric}
          onChange={(e) => setMetric(e.target.value as typeof metric)}
        >
          <option value="tickets">Ticket volume</option>
          <option value="runs">AI run outcomes</option>
          <option value="tokens">Model tokens</option>
        </select>
      </div>
      <div className="performance-legend">
        {names.map((name, i) => (
          <span key={name}>
            <i style={{ background: i ? 'var(--chart-secondary)' : 'var(--chart-primary)' }} />
            {name}
            <strong>{number(report.trend.reduce((s, d) => s + d[keys[i]], 0))}</strong>
          </span>
        ))}
      </div>
      <ActivityChart trend={report.trend} metric={metric} />
      <details className="daily-details">
        <summary>View daily data</summary>
        <div className="report-table-scroll">
          <table className="report-table">
            <caption className="sr-only">Daily ticket and AI activity in UTC</caption>
            <thead>
              <tr>
                {[
                  'UTC day',
                  'Opened',
                  'Closed',
                  'AI completed',
                  'AI failed',
                  'Approved',
                  'Revisions',
                  'Input tokens',
                  'Output tokens',
                ].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...report.trend].reverse().map((d) => (
                <tr key={d.day}>
                  <th scope="row">{d.day}</th>
                  {[
                    'opened',
                    'closed',
                    'completed',
                    'failed',
                    'approved',
                    'rejected',
                    'inputTokens',
                    'outputTokens',
                  ].map((k) => (
                    <td key={k}>{number(d[k as keyof typeof d] as number)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
export function Performance() {
  const [days, setDays] = useState('30'),
    [mode, setMode] = useState('all'),
    [tab, setTab] = useState('overview'),
    [refresh, setRefresh] = useState(0);
  const [report, setReport] = useState<PerformanceReport | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  useEffect(() => {
    const timer = setInterval(() => setRefresh((v) => v + 1), 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    api<PerformanceReport>(`/reports/performance?days=${days}&mode=${mode}`, {
      signal: controller.signal,
    })
      .then((r) => {
        if (!controller.signal.aborted) setReport(r);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [days, mode, refresh]);
  const decisions = report ? report.reviews.approved + report.reviews.rejected : 0;
  return (
    <div className="performance-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">PERFORMANCE INTELLIGENCE</span>
          <h1>Know what’s working.</h1>
          <p>
            Track your AI team’s output, the quality of its handoffs, and the work still waiting.
          </p>
        </div>
        <button
          className="button secondary"
          disabled={!report || loading || !!error}
          onClick={() => report && csv(report)}
        >
          <ArrowDownToLine size={17} />
          Export report
        </button>
      </div>
      <div className="report-toolbar">
        <div className="report-filters">
          <label>
            Reporting period
            <select value={days} onChange={(e) => setDays(e.target.value)}>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
            </select>
          </label>
          <label>
            AI activity
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="all">All AI modes</option>
              <option value="live">Live AI only</option>
              <option value="demo">Scripted demo only</option>
              <option value="unavailable">Not connected</option>
            </select>
          </label>
        </div>
        <div className="report-updated">
          <span role="status">
            {loading
              ? 'Updating report…'
              : report
                ? `Updated ${new Date(report.window.generatedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
                : ''}
          </span>
          <button
            className="icon-button"
            aria-label="Refresh performance report"
            disabled={loading}
            onClick={() => setRefresh((v) => v + 1)}
          >
            <RefreshCw size={18} />
          </button>
        </div>
      </div>
      <p className="report-scope">
        Period: UTC calendar days through now. AI activity filters apply to runs and reviews; ticket
        metrics include every ticket. Backlog always shows the current workspace.
      </p>
      {error && (
        <div className="error-banner" role="alert">
          Could not update the report: {error} Use refresh to try again.
        </div>
      )}
      {!report ? (
        loading ? (
          <div className="report-loading">
            <Spinner />
          </div>
        ) : null
      ) : (
        <>
          <div className="report-context">
            <span>
              <Activity size={15} />
              {new Date(report.window.from).toLocaleDateString(undefined, {
                timeZone: 'UTC',
                month: 'short',
                day: 'numeric',
              })}{' '}
              –{' '}
              {new Date(report.window.to).toLocaleDateString(undefined, {
                timeZone: 'UTC',
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </span>
            <span>
              {modeName(report.window.mode)} · {number(report.runs.total)} runs
            </span>
          </div>
          <div className="metric-grid">
            {[
              {
                label: 'Approved closures',
                value: number(report.tickets.closed),
                detail: `${number(report.tickets.opened)} tickets opened in this period`,
                icon: CheckCheck,
                tone: 'mint',
              },
              {
                label: 'AI execution completion',
                value: rate(report.runs.completed, report.runs.completed + report.runs.failed),
                detail: `${number(report.runs.completed)} completed · ${number(report.runs.failed)} failed`,
                icon: Sparkles,
                tone: 'indigo',
              },
              {
                label: 'Review acceptance',
                value: rate(report.reviews.approved, decisions),
                detail: `${number(report.reviews.approved)} approved / ${number(decisions)} decisions`,
                icon: ShieldCheck,
                tone: 'violet',
              },
              {
                label: 'First response on time',
                value: rate(report.tickets.onTime, report.tickets.responses),
                detail: `${number(report.tickets.onTime)} on time / ${number(report.tickets.responses)} responses`,
                icon: Clock3,
                tone: 'cyan',
              },
            ].map((m) => (
              <div className={`metric-card ${m.tone}`} key={m.label}>
                <div>
                  <span>{m.label}</span>
                  <span className="metric-icon">
                    <m.icon size={19} />
                  </span>
                </div>
                <strong>{m.value}</strong>
                <p>{m.detail}</p>
              </div>
            ))}
          </div>
          <div className="report-tabs" role="tablist" aria-label="Performance reports">
            {[
              ['overview', 'Overview'],
              ['specialists', 'AI specialists'],
              ['operations', 'Operations & usage'],
            ].map(([key, name]) => (
              <button
                key={key}
                role="tab"
                id={`report-tab-${key}`}
                aria-controls={`report-panel-${key}`}
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                onKeyDown={(e) => {
                  if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
                    e.preventDefault();
                    const tabs = ['overview', 'specialists', 'operations'];
                    const next =
                      e.key === 'Home'
                        ? 0
                        : e.key === 'End'
                          ? 2
                          : (tabs.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : 2)) % 3;
                    setTab(tabs[next]);
                    document.getElementById(`report-tab-${tabs[next]}`)?.focus();
                  }
                }}
                tabIndex={tab === key ? 0 : -1}
              >
                {name}
              </button>
            ))}
          </div>
          <div role="tabpanel" id={`report-panel-${tab}`} aria-labelledby={`report-tab-${tab}`}>
            {tab === 'overview' ? (
              <>
                <Trend report={report} />
                <section className="panel timing-panel">
                  <div className="section-heading">
                    <div>
                      <span className="section-kicker">SPEED & HANDOFFS</span>
                      <h2>Where does the time go?</h2>
                    </div>
                    <span className="outline-pill">p50 = median · p95 = 95th percentile</span>
                  </div>
                  <div className="report-table-scroll">
                    <table className="report-table timing-table">
                      <caption className="sr-only">
                        Time distributions for support workflow stages
                      </caption>
                      <thead>
                        <tr>
                          <th>Workflow stage</th>
                          <th>Average</th>
                          <th>p50</th>
                          <th>p95</th>
                          <th>Samples</th>
                        </tr>
                      </thead>
                      <tbody>
                        <TimeRow
                          name="First public response"
                          detail="Ticket creation → first support reply; replies sent in the period"
                          time={report.tickets.firstResponse}
                        />
                        <TimeRow
                          name="AI execution, including queue"
                          detail="Run queued → completed; runs created in the period, retries included"
                          time={report.runs.duration}
                        />
                        <TimeRow
                          name="Human review"
                          detail="Proposal → decision; decisions made in the period"
                          time={report.reviews.wait}
                        />
                        <TimeRow
                          name="Approved closure"
                          detail="Ticket creation → most recent closure; closures in the period"
                          time={report.tickets.closure}
                        />
                      </tbody>
                    </table>
                  </div>
                  <p className="report-panel-note">
                    p95 is the time 95% of measured samples fall at or below. Empty samples show —.
                    Current ticket records retain the latest closure when a ticket is reopened.
                  </p>
                </section>
                <div className="report-columns">
                  <section className="panel outcome-panel">
                    <div className="section-heading">
                      <div>
                        <span className="section-kicker">AI RUN OUTCOMES</span>
                        <h2>Completed is only the beginning.</h2>
                      </div>
                    </div>
                    <OutcomeBars
                      rows={[
                        ['Ready for review', report.runs.review, 'indigo'],
                        ['Waiting for customer', report.runs.waiting, 'cyan'],
                        ['Needs admin decision', report.runs.blocked, 'amber'],
                        ['Historical outcome unknown', report.runs.unknown, 'slate'],
                      ]}
                      total={report.runs.completed}
                    />
                    <div className="report-count-strip">
                      <span>
                        <b>{report.runs.queued + report.runs.running}</b> queued or running
                      </span>
                      <span>
                        <b>{report.runs.cancelled}</b> cancelled
                      </span>
                      <span>
                        <b>{report.runs.failed}</b> failed
                      </span>
                    </div>
                    <p className="report-panel-note">
                      Completion means a saved response and outcome, including private drafts and
                      blocked outcomes. It does not mean the ticket is resolved. Cancelled and
                      in-flight runs are excluded from completion rate.
                    </p>
                  </section>
                  <section className="panel outcome-panel">
                    <div className="section-heading">
                      <div>
                        <span className="section-kicker">HUMAN QUALITY GATE</span>
                        <h2>Every closure has a final say.</h2>
                      </div>
                    </div>
                    <OutcomeBars
                      rows={[
                        ['Approved', report.reviews.approved, 'mint'],
                        ['Sent back for revision', report.reviews.rejected, 'amber'],
                      ]}
                      total={decisions}
                    />
                    <div className="report-count-strip">
                      <span>
                        <b>{report.reviews.proposed}</b> proposals created
                      </span>
                      <span>
                        <b>{report.reviews.pending}</b> still pending
                      </span>
                      <span>
                        <b>{report.reviews.stale}</b> superseded
                      </span>
                    </div>
                    <p className="report-panel-note">
                      Approval and revision counts use decision time. Proposal and pending counts
                      use proposal creation time. Acceptance measures reviewer decisions, not
                      customer satisfaction or answer accuracy.
                    </p>
                  </section>
                </div>
              </>
            ) : tab === 'specialists' ? (
              <section className="panel specialist-report">
                <div className="section-heading">
                  <div>
                    <span className="section-kicker">SPECIALIST COMPARISON</span>
                    <h2>See how each agent contributes.</h2>
                  </div>
                </div>
                <p className="report-panel-note">
                  Run activity belongs to the specialist that executed it. Decisions belong to the
                  proposal’s specialist, even after reassignment. Current workload includes all AI
                  modes.
                </p>
                <div className="report-table-scroll">
                  <table className="report-table specialist-table">
                    <caption className="sr-only">
                      AI specialist performance and current workload
                    </caption>
                    <thead>
                      <tr>
                        <th>Specialist</th>
                        <th>Active now</th>
                        <th>Runs</th>
                        <th>Completion</th>
                        <th>For review</th>
                        <th>Approved / revised</th>
                        <th>Acceptance</th>
                        <th>Avg. run</th>
                        <th>Tokens</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.agents.map((a) => (
                        <tr key={a.id}>
                          <th scope="row">
                            <strong>{a.name}</strong>
                            <small>
                              {a.enabled ? 'Enabled' : 'Paused'} · {a.review} awaiting review now
                            </small>
                          </th>
                          <td>{number(a.active)}</td>
                          <td>{number(a.runs)}</td>
                          <td>
                            <strong>{rate(a.completed, a.completed + a.failed)}</strong>
                            <small>{a.failed} failed</small>
                          </td>
                          <td>{number(a.proposals)}</td>
                          <td>
                            {a.approved} / {a.rejected}
                          </td>
                          <td>{rate(a.approved, a.approved + a.rejected)}</td>
                          <td>{duration(a.avgRunMinutes)}</td>
                          <td>{number(a.tokens)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="report-callout">
                  <ShieldCheck size={22} />
                  <div>
                    <strong>Compare the work, then inspect the evidence.</strong>
                    <p>
                      Different specialties receive different ticket complexity. Use sample sizes,
                      review outcomes, and execution logs together. Run duration includes queue
                      time.
                    </p>
                  </div>
                </div>
              </section>
            ) : (
              <>
                <div className="report-columns">
                  <section className="panel outcome-panel">
                    <div className="section-heading">
                      <div>
                        <span className="section-kicker">CURRENT WORKSPACE · ALL MODES</span>
                        <h2>Backlog health.</h2>
                      </div>
                      <span className="outline-pill">{report.backlog.total} active</span>
                    </div>
                    <OutcomeBars
                      rows={report.backlog.ages.map((a, i) => [
                        a.label,
                        a.count,
                        ['mint', 'cyan', 'amber', 'rose'][i],
                      ])}
                      total={report.backlog.total}
                    />
                    <div className="report-count-strip">
                      <span>
                        <b>{report.backlog.unassigned}</b> unassigned
                      </span>
                      <span>
                        <b>{report.backlog.blocked}</b> blocked
                      </span>
                      <span>
                        <b>{report.backlog.review}</b> for review
                      </span>
                    </div>
                    <p className="report-panel-note">
                      Oldest active ticket: {duration(report.backlog.oldestMinutes)}. Age runs from
                      ticket creation, including tickets reopened later.
                    </p>
                  </section>
                  <section className="panel outcome-panel">
                    <div className="section-heading">
                      <div>
                        <span className="section-kicker">FIRST RESPONSE DEADLINES</span>
                        <h2>Keep the promise.</h2>
                      </div>
                    </div>
                    <div className="deadline-total">
                      <TriangleAlert size={26} />
                      <strong>{number(report.backlog.overdue)}</strong>
                      <span>active tickets overdue for a first reply</span>
                    </div>
                    <div className="report-table-scroll">
                      <table className="report-table">
                        <caption className="sr-only">
                          Current backlog and overdue first replies by priority
                        </caption>
                        <thead>
                          <tr>
                            <th>Priority</th>
                            <th>Active now</th>
                            <th>Overdue now</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.backlog.priorities.map((p) => (
                            <tr key={p.priority}>
                              <th scope="row" className="capitalize">
                                {p.priority}
                              </th>
                              <td>{p.count}</td>
                              <td>{p.overdue}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="report-panel-note">
                      In this period, {report.tickets.late} first replies missed their deadline.
                      On-time rate includes only tickets that received a first reply; unanswered
                      overdue tickets appear above.
                    </p>
                  </section>
                </div>
                <section className="panel usage-report">
                  <div className="section-heading">
                    <div>
                      <span className="section-kicker">MODEL USAGE & EXECUTION</span>
                      <h2>Know what your team consumes.</h2>
                    </div>
                    <span className="outline-pill">{modeName(report.window.mode)}</span>
                  </div>
                  <div className="usage-grid">
                    <div>
                      <span>Input tokens</span>
                      <strong>{number(report.runs.inputTokens)}</strong>
                      <small>Recorded provider usage</small>
                    </div>
                    <div>
                      <span>Output tokens</span>
                      <strong>{number(report.runs.outputTokens)}</strong>
                      <small>Recorded provider usage</small>
                    </div>
                    <div>
                      <span>Verified address updates</span>
                      <strong>{number(report.runs.verifiedActions)}</strong>
                      <small>Saved and checked by the backend</small>
                    </div>
                    <div>
                      <span>AI runs by mode</span>
                      <strong>
                        {number(report.runs.live)} <small>live</small>
                      </strong>
                      <small>
                        {report.runs.demo} scripted · {report.runs.unavailable} not connected
                      </small>
                    </div>
                  </div>
                  <div className="report-callout">
                    <Sparkles size={22} />
                    <div>
                      <strong>Demo activity is a workflow demonstration.</strong>
                      <p>
                        Scripted runs use zero model tokens. This report does not estimate model
                        cost or customer satisfaction. Usage reflects persisted provider responses;
                        interrupted or failed requests can have unrecorded provider usage.
                      </p>
                    </div>
                  </div>
                </section>
                <Trend report={report} />
              </>
            )}
          </div>
          <details className="report-definitions">
            <summary>How these reports are measured</summary>
            <p>
              Time filters cover the selected number of UTC calendar days, including today through
              the displayed update time. Ticket volume uses creation and most recent closure events.
              Timings include only observed events, so unfinished work is excluded from time
              averages and shown in the backlog. AI execution completion is completed ÷ (completed +
              failed); completed runs can still require an admin decision. Review acceptance is
              approved ÷ (approved + sent back for revision). A revision can lead to another
              proposal and another decision on the same ticket. First response on time is responses
              at or before the ticket deadline ÷ all first responses in the period. No denominator
              means —. Current ticket fields do not preserve historical closure cycles. Refreshes
              every 30 seconds.
            </p>
          </details>
        </>
      )}
    </div>
  );
}
function OutcomeBars({ rows, total }: { rows: [string, number, string][]; total: number }) {
  return (
    <div className="outcome-bars">
      {rows.map(([name, count, color]) => (
        <div key={name}>
          <div>
            <span>{name}</span>
            <strong>
              {number(count)} <small>{rate(count, total)}</small>
            </strong>
          </div>
          <div className="outcome-track">
            <span
              className={`fill-${color}`}
              style={{ width: `${total ? (count / total) * 100 : 0}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
