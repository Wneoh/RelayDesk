# Architecture and decisions

## One application, several specialist identities

React calls an Express JSON API and subscribes to Socket.IO updates. PostgreSQL stores users, sessions, tickets, messages, specialist configurations, knowledge articles, runs, and reviews. AI agents are service records with no passwords or login sessions. Existing human-agent logins are retired; active account roles are Customer, Support, and Admin. Support handles tickets and must record private notes when approving responses or closure. Only Admin manages accounts, knowledge, agent configuration, and ticket deletion/recovery.

One AI owns a ticket at a time. A specialist's instructions and enabled knowledge sources form its working context. Support and Billing provide grounded guidance; Orders can read customer-owned orders and propose one narrowly scoped address-change action. An administrator can pause or reassign a specialist. Pausing or changing instructions cancels in-flight work.

## State changes and generation

1. Assignment, a public follow-up, or requested revision increments the ticket revision and queues a database job.
2. A worker claims a queued job with `FOR UPDATE SKIP LOCKED` and a 90-second lease.
3. It retrieves the specialist's enabled knowledge using lexical relevance, the conversation, and permitted customer-owned order data. Generation happens outside a database transaction.
4. The provider returns a validated structured outcome: waiting, review, or blocked. It cannot return closed.
5. Before committing output, the worker locks the ticket and checks assignment, revision, specialist availability, job state, and lease attempt ownership.
6. Permitted address changes and their verification, AI messages, review proposals, and execution records commit in one transaction. Stale output is discarded.
7. Socket.IO invalidates relevant customer/staff views after commit. Clients also refresh on reconnect, focus, and a bounded polling interval to recover missed invalidations.

The scripted demo implements the same structured provider interface, including real database reads and writes. Its records and UI always identify it as demo execution. It is not evidence of language-model quality.

## Review is a distinct business operation

AI proposes; a Support reviewer or Admin closes. Approval requires a current pending review and the expected ticket revision. A new customer message makes the previous proposal stale. Requesting more work records private feedback and queues another run. Ticket locks ensure that simultaneous approvals yield one successful closure and one conflict.

Customer API responses exclude internal messages, private execution records, proposals, reviewer identities, and private closure feedback. The browser is not responsible for enforcing that separation.

## Model output is not an authorization mechanism

The live adapter uses OpenAI Responses structured output, validated again with Zod. The server permits only supported action names and checks customer ownership, shipping status, the requested order reference, and the verbatim customer-supplied address. The address update result is re-read and used to construct the customer-facing success message. Refunds, arbitrary HTTP requests, administrative changes, and ticket closure are outside the model's capabilities.

The agent path currently uses server-controlled context retrieval and a validated action proposal, not a general-purpose model-driven tool loop. This keeps the action surface small and reviewable. Source retrieval is lexical rather than vector search; a business with a much larger knowledge base would need better retrieval and explicit evaluation data.

## Reliability and limits

- Human messages have a unique client ID per ticket and author. Retries return the saved message without another revision increment.
- AI messages use the run ID as an idempotency key. Actions and output share the same commit, and expired lease attempts cannot overwrite the reclaimed worker's outcome.
- Provider calls have time, input-size, and output-token limits. Live tickets have a run cap. Failed jobs are visible blockers and can be explicitly retried by administrators.
- Session secrets remain server-side. Sessions are hashed in the database, expire, and use HTTP-only cookies. Mutations check origin and are rate limited. WebSocket subscriptions check session and ticket access.
- Overdue alerts have a database uniqueness constraint so repeated deadline scans do not create duplicate notifications.
- No transactional outbox is implemented. A crash between the database commit and the Socket.IO emit can delay the UI until reconnect/poll refresh; persisted state remains the source of truth.
- Deadline targets use elapsed hours rather than business calendars. Reporting uses UTC day boundaries.

## What the verification establishes

Integration tests exercise the backend against a real PostgreSQL engine. In-memory PGlite is convenient for local tests but serializes transactions; CI uses a PostgreSQL server to verify multi-connection behavior. Browser tests exercise the complete scripted workflow and responsive interface. Live model behavior, grounding quality, and operational cost still require evaluation with a configured provider key and a representative ticket set before public use.

## Performance report semantics

`GET /api/reports/performance?days=30&mode=all` is staff-only. Periods are 7, 30, or 90 UTC calendar days including today through a single server timestamp. The query uses a repeatable-read, read-only transaction so totals, distributions, specialist rows, and trends share one snapshot. AI activity filters select all, live, scripted demo, or unavailable mode; ticket metrics and current workload remain workspace-wide and are explicitly labelled.

Ticket volume uses creation and most recent closure timestamps. First response timings and deadline compliance use replies observed during the period, including tickets created earlier. AI run activity uses runs created during the period; duration is queue-to-completion time including retries, not isolated model latency. Persisted structured outcomes distinguish proposed resolutions, customer follow-ups, and admin blockers. Historical outcomes are backfilled only from known execution step labels, otherwise left unknown. Provider failures, cancellations, queued work, and active work remain distinct.

Review acceptance uses approved divided by approved plus rejected decisions made in the period. Proposal counts use proposal creation time. Historical specialist credit follows the run linked to the proposal, independent of the ticket's current assignee. Current backlog ages, priorities, unassigned work, pending reviews, and overdue first replies use all unresolved tickets, regardless of report filters.

Average, p50, and p95 distributions include sample counts; missing observations remain null and render as an em dash. Reopening clears the ticket's closure fields, so these reports describe current ticket records rather than a historical ledger of every closure cycle. Tokens reflect persisted provider usage, including known cancelled results; interrupted/failed provider requests may consume unrecorded tokens. No model cost, customer satisfaction, or model accuracy is inferred. Scripted runs use zero model tokens.

The frontend uses registered Chart.js line components with responsive canvas sizing, reduced-motion support, contrasting solid/dashed series, ARIA names, and an equivalent daily HTML table. CSV exports contain the complete filtered snapshot, metric units, specialist rows, and daily activity. Formula-like strings are escaped for spreadsheet imports. Indexes support run creation, decision time, ticket creation, and closure queries.

## Staff approvals, recoverable deletion, and browser navigation

Manually rerunning a specialist sets `requires_approval` on the run. Generation persists an administrator/staff-only `ai_response_drafts` record rather than a public message. A draft carries the ticket revision, specialist identity, structured outcome, source snapshot, and proposed action. It performs no action. Confirmation locks the ticket and draft, checks revision and current assignment, checks that the specialist remains enabled, then revalidates any action against current customer ownership and order eligibility. The approved edited response, permitted action, draft decision, execution steps, and optional resolution proposal commit together. Concurrent confirmations produce one send and a conflict. New conversation revisions stale pending drafts. Support confirmations require a private approval note; closure requires a separate note and current resolution review. Customer responses never return draft or approval metadata.

Support and Admin join authenticated staff invalidation rooms and can handle tickets, internal notes, assignment, response review, and final review. Only Admin can create accounts, change approved knowledge, configure/deactivate agents, or delete/recover tickets. Support sees agent workload without management controls. Public registration always creates Customer accounts.

Ticket deletion is recoverable. It records the deleting administrator, time, and reason, invalidates pending work, cancels jobs, and excludes the ticket from active access, lists, backlog, ticket volume, and deadline scans. Historical AI runs and review decisions remain in performance history. Restore does not trigger generation; unresolved tickets return as blocked for deliberate review. Existing order changes are not undone by deleting a ticket.

The client uses browser history as the route source, subscribes to navigation events, preserves authenticated ticket deep links across sign-in, and reloads ticket data through permission-checked APIs. Ticket list subjects are actual anchors for new-tab/copy-link behavior, and ticket details include Copy ticket link. The production Express server explicitly serves the app shell on known UI paths while unknown API paths retain JSON 404 responses.
