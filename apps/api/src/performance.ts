import type { PerformanceReport, Timing, User } from '@relaydesk/contracts';
import type { Database, Queryable } from './db.js';
import { requireStaff } from './auth.js';
import { z } from 'zod';

export const performanceQuery = z.object({
  days: z.enum(['7', '30', '90']).default('30'),
  mode: z.enum(['all', 'demo', 'live', 'unavailable']).default('all'),
});
const timing = (row: any): Timing => ({
  count: Number(row.n),
  average: row.average === null ? null : Number(row.average),
  p50: row.p50 === null ? null : Number(row.p50),
  p95: row.p95 === null ? null : Number(row.p95),
});
const distribution = `count(*)::int n,avg(minutes) average,percentile_cont(0.5) WITHIN GROUP(ORDER BY minutes) p50,percentile_cont(0.95) WITHIN GROUP(ORDER BY minutes) p95`;
async function times(tx: Queryable, sql: string, values: unknown[]) {
  return timing((await tx.query(`SELECT ${distribution} FROM (${sql}) samples`, values)).rows[0]);
}
/** Event-window metrics; backlog is a current snapshot. Mode applies to AI runs and reviews only. */
export async function performance(
  db: Database,
  user: User,
  query: unknown,
): Promise<PerformanceReport> {
  requireStaff(user);
  const { days, mode } = performanceQuery.parse(query);
  return db.transaction(async (tx) => {
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    const w = (
      await tx.query(
        `SELECT date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' - ($1::int-1)*interval '1 day' AS start, now() AS finish`,
        [Number(days)],
      )
    ).rows[0];
    const from = new Date(w.start).toISOString(),
      to = new Date(w.finish).toISOString();
    const v = [from, to, mode];
    const runWhere = `created_at >= $1 AND created_at <= $2 AND ($3='all' OR mode=$3)`;
    const reviewMode = `($3='all' OR EXISTS(SELECT 1 FROM ai_runs ar WHERE ar.id=r.run_id AND ar.mode=$3))`;
    // Separate aggregates prevent one-to-many joins multiplying tickets, runs or decisions.
    const requests = [
      tx.query(
        `SELECT (SELECT count(*)::int FROM tickets WHERE deleted_at IS NULL AND created_at BETWEEN $1 AND $2) opened,
        (SELECT count(*)::int FROM tickets WHERE deleted_at IS NULL AND resolved_at BETWEEN $1 AND $2) closed,
        count(*)::int responses,count(*) FILTER(WHERE first_response_at<=response_due_at)::int "onTime",
        count(*) FILTER(WHERE first_response_at>response_due_at)::int late
        FROM tickets WHERE deleted_at IS NULL AND first_response_at BETWEEN $1 AND $2`,
        [from, to],
      ),
      tx.query(
        `SELECT count(*)::int total,
        count(*) FILTER(WHERE status='completed')::int completed,count(*) FILTER(WHERE status='failed')::int failed,
        count(*) FILTER(WHERE status='cancelled')::int cancelled,count(*) FILTER(WHERE status='queued')::int queued,
        count(*) FILTER(WHERE status='running')::int running,count(*) FILTER(WHERE status='completed' AND outcome='review')::int review,
        count(*) FILTER(WHERE status='completed' AND outcome='waiting')::int waiting,count(*) FILTER(WHERE status='completed' AND outcome='blocked')::int blocked,
        count(*) FILTER(WHERE status='completed' AND outcome IS NULL)::int unknown,
        coalesce(sum(input_tokens),0) "inputTokens",coalesce(sum(output_tokens),0) "outputTokens",
        count(*) FILTER(WHERE mode='demo')::int demo,count(*) FILTER(WHERE mode='live')::int live,count(*) FILTER(WHERE mode='unavailable')::int unavailable,
        coalesce(sum((SELECT count(*) FROM jsonb_array_elements(steps) s WHERE s->>'name'='Updated delivery address' AND s->>'status'='complete')),0) "verifiedActions"
        FROM ai_runs WHERE ${runWhere}`,
        v,
      ),
      tx.query(
        `SELECT count(*) FILTER(WHERE r.created_at BETWEEN $1 AND $2)::int proposed,
        count(*) FILTER(WHERE r.created_at BETWEEN $1 AND $2 AND state='pending')::int pending,
        count(*) FILTER(WHERE r.created_at BETWEEN $1 AND $2 AND state='stale')::int stale,
        count(*) FILTER(WHERE reviewed_at BETWEEN $1 AND $2 AND state='approved')::int approved,
        count(*) FILTER(WHERE reviewed_at BETWEEN $1 AND $2 AND state='rejected')::int rejected
        FROM resolution_reviews r WHERE ${reviewMode}`,
        v,
      ),
      times(
        tx,
        `SELECT extract(epoch FROM(first_response_at-created_at))/60 minutes FROM tickets WHERE deleted_at IS NULL AND first_response_at BETWEEN $1 AND $2`,
        [from, to],
      ),
      times(
        tx,
        `SELECT extract(epoch FROM(resolved_at-created_at))/60 minutes FROM tickets WHERE deleted_at IS NULL AND resolved_at BETWEEN $1 AND $2`,
        [from, to],
      ),
      times(
        tx,
        `SELECT extract(epoch FROM(completed_at-created_at))/60 minutes FROM ai_runs WHERE ${runWhere} AND status='completed' AND completed_at IS NOT NULL`,
        v,
      ),
      times(
        tx,
        `SELECT extract(epoch FROM(reviewed_at-r.created_at))/60 minutes FROM resolution_reviews r WHERE reviewed_at BETWEEN $1 AND $2 AND state IN ('approved','rejected') AND ${reviewMode}`,
        v,
      ),
      tx.query(`SELECT count(*)::int total,count(*) FILTER(WHERE ai_agent_id IS NULL)::int unassigned,
        count(*) FILTER(WHERE first_response_at IS NULL AND response_due_at<now())::int overdue,
        count(*) FILTER(WHERE status='review')::int review,count(*) FILTER(WHERE status='blocked')::int blocked,
        max(extract(epoch FROM(now()-created_at))/60) "oldestMinutes",
        count(*) FILTER(WHERE created_at>now()-interval '1 day')::int fresh,
        count(*) FILTER(WHERE created_at<=now()-interval '1 day' AND created_at>now()-interval '3 days')::int medium,
        count(*) FILTER(WHERE created_at<=now()-interval '3 days' AND created_at>now()-interval '7 days')::int old,
        count(*) FILTER(WHERE created_at<=now()-interval '7 days')::int oldest
        FROM tickets WHERE deleted_at IS NULL AND status<>'resolved'`),
      tx.query(
        `SELECT priority,count(*)::int count,count(*) FILTER(WHERE first_response_at IS NULL AND response_due_at<now())::int overdue FROM tickets WHERE deleted_at IS NULL AND status<>'resolved' GROUP BY priority`,
      ),
      tx.query(
        `WITH runs AS (SELECT agent_id,count(*)::int runs,count(*) FILTER(WHERE status='completed')::int completed,
          count(*) FILTER(WHERE status='failed')::int failed,count(*) FILTER(WHERE outcome='review' AND status='completed')::int proposals,
          sum(input_tokens+output_tokens) tokens,avg(extract(epoch FROM(completed_at-created_at))/60) FILTER(WHERE status='completed') "avgRunMinutes"
          FROM ai_runs WHERE ${runWhere} GROUP BY agent_id),
        decisions AS (SELECT ar.agent_id,count(*) FILTER(WHERE r.state='approved')::int approved,count(*) FILTER(WHERE r.state='rejected')::int rejected
          FROM resolution_reviews r JOIN ai_runs ar ON ar.id=r.run_id WHERE r.reviewed_at BETWEEN $1 AND $2 AND ($3='all' OR ar.mode=$3) GROUP BY ar.agent_id),
        workload AS (SELECT ai_agent_id,count(*)::int active,count(*) FILTER(WHERE status='review')::int review FROM tickets WHERE deleted_at IS NULL AND status<>'resolved' GROUP BY ai_agent_id)
        SELECT a.id,a.name,a.enabled,coalesce(w.active,0) active,coalesce(w.review,0) review,
        coalesce(r.runs,0) runs,coalesce(r.completed,0) completed,coalesce(r.failed,0) failed,coalesce(r.proposals,0) proposals,
        coalesce(d.approved,0) approved,coalesce(d.rejected,0) rejected,coalesce(r.tokens,0) tokens,r."avgRunMinutes"
        FROM ai_agents a LEFT JOIN runs r ON r.agent_id=a.id LEFT JOIN decisions d ON d.agent_id=a.id LEFT JOIN workload w ON w.ai_agent_id=a.id ORDER BY a.name`,
        v,
      ),
      tx.query(
        `WITH days AS (SELECT generate_series($1::timestamptz, date_trunc('day',$2::timestamptz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',interval '1 day') d),
        opened AS (SELECT (created_at AT TIME ZONE 'UTC')::date AS "day",count(*)::int n FROM tickets WHERE deleted_at IS NULL AND created_at BETWEEN $1 AND $2 GROUP BY 1),
        closed AS (SELECT (resolved_at AT TIME ZONE 'UTC')::date AS "day",count(*)::int n FROM tickets WHERE deleted_at IS NULL AND resolved_at BETWEEN $1 AND $2 GROUP BY 1),
        runs AS (SELECT (created_at AT TIME ZONE 'UTC')::date AS "day",count(*) FILTER(WHERE status='completed')::int completed,count(*) FILTER(WHERE status='failed')::int failed,coalesce(sum(input_tokens),0) input,coalesce(sum(output_tokens),0) output FROM ai_runs WHERE ${runWhere} GROUP BY 1),
        decisions AS (SELECT (reviewed_at AT TIME ZONE 'UTC')::date AS "day",count(*) FILTER(WHERE state='approved')::int approved,count(*) FILTER(WHERE state='rejected')::int rejected FROM resolution_reviews r WHERE reviewed_at BETWEEN $1 AND $2 AND ${reviewMode} GROUP BY 1)
        SELECT to_char(d.d AT TIME ZONE 'UTC','YYYY-MM-DD') AS "day",coalesce(o.n,0) opened,coalesce(c.n,0) closed,coalesce(r.completed,0) completed,coalesce(r.failed,0) failed,coalesce(v.approved,0) approved,coalesce(v.rejected,0) rejected,coalesce(r.input,0) "inputTokens",coalesce(r.output,0) "outputTokens" FROM days d LEFT JOIN opened o ON o.day=(d.d AT TIME ZONE 'UTC')::date LEFT JOIN closed c ON c.day=(d.d AT TIME ZONE 'UTC')::date LEFT JOIN runs r ON r.day=(d.d AT TIME ZONE 'UTC')::date LEFT JOIN decisions v ON v.day=(d.d AT TIME ZONE 'UTC')::date ORDER BY d.d`,
        v,
      ),
    ];
    const results = await Promise.allSettled(requests);
    const values = results.map((r) => {
      if (r.status === 'rejected') throw r.reason;
      return r.value;
    }) as any[];
    const [
      tickets,
      runs,
      reviews,
      response,
      closure,
      runDuration,
      reviewWait,
      backlog,
      priorities,
      agents,
      trend,
    ] = values;
    const numeric = (row: any) =>
      Object.fromEntries(
        Object.entries(row).map(([k, value]) => [
          k,
          typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value,
        ]),
      );
    const b = numeric(backlog.rows[0]);
    return {
      window: { days: Number(days), mode, from, to, generatedAt: to },
      tickets: {
        ...numeric(tickets.rows[0]),
        firstResponse: response,
        closure,
      } as PerformanceReport['tickets'],
      runs: { ...numeric(runs.rows[0]), duration: runDuration } as PerformanceReport['runs'],
      reviews: { ...numeric(reviews.rows[0]), wait: reviewWait } as PerformanceReport['reviews'],
      backlog: {
        total: b.total,
        unassigned: b.unassigned,
        overdue: b.overdue,
        review: b.review,
        blocked: b.blocked,
        oldestMinutes: b.oldestMinutes,
        ages: [
          { label: 'Under 24 hours', count: b.fresh },
          { label: '1–3 days', count: b.medium },
          { label: '3–7 days', count: b.old },
          { label: '7+ days', count: b.oldest },
        ],
        priorities: ['urgent', 'high', 'normal', 'low'].map((priority) => ({
          priority,
          count: 0,
          overdue: 0,
          ...priorities.rows.find((r: any) => r.priority === priority),
        })),
      } as PerformanceReport['backlog'],
      agents: agents.rows.map(numeric),
      trend: trend.rows.map(numeric),
    } as PerformanceReport;
  });
}
