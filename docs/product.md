# RelayDesk product model

RelayDesk is an AI support workspace for a small business operated by one or two administrators. Multiple specialist AI agents handle customer tickets. Support reviewers and Admins review the evidence and make the final decision to close a ticket. Support approvals require a private note.

The specialist assignment, durable runs, knowledge management, resolution review, and staff-only closure flows are implemented. The local demo uses visibly labelled scripted agent responses. An OpenAI Responses integration is available for live generation when a server-side key is configured; it has not been verified against a live model in this environment.

## People and agents

- Customers submit issues, answer follow-up questions, and track their own conversations.
- Support users handle tickets, assign specialists, and approve responses and resolutions with private notes. They cannot manage accounts, configure/deactivate AI agents, or delete tickets.
- Administrators manage knowledge, configure AI agents and action permissions, assign or reroute tickets, review proposed resolutions, request more work, and close tickets.
- AI agents are service identities, not human login accounts. Each has a specialty, instructions, approved knowledge sources, allowed tools, and a clear enabled/paused state.
- One or two administrators is the target customer profile, not a hard-coded account limit.

Start with three specialists:

| Agent         | Responsibility                        | Initial scope                                                                                             |
| ------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Relay Support | General product and account questions | Search approved articles, ask clarifying questions, explain documented procedures                         |
| Relay Orders  | Order and delivery questions          | Look up customer-owned orders, check shipping status, propose eligible order changes                      |
| Relay Billing | Invoice and payment questions         | Retrieve customer-owned invoice information, explain billing policy, flag exceptions for an administrator |

One AI agent owns a ticket at a time. An administrator can assign it manually. Automatic routing may recommend a specialist later. A specialist handoff must preserve the conversation and explain why responsibility changed. An agent cannot grant itself another agent's tools.

## Ticket lifecycle

1. **New** — the ticket has arrived and needs an AI owner.
2. **AI working** — the assigned AI is investigating or responding.
3. **Waiting for customer** — the AI needs information from the customer.
4. **Ready for review** — the AI proposes a resolution and provides evidence.
5. **Needs admin decision** — the AI is blocked by missing knowledge, an action failure, or a policy exception.
6. **Closed** — an administrator approved the result and explicitly closed the ticket.

AI agents cannot close tickets. Closing is an authenticated Support or Admin action enforced by the backend. A customer-facing message may say the issue appears addressed and the ticket is under review; it must not claim the administrator has approved closure.

## Resolution review

A review card contains:

- The customer's original problem.
- What the AI did, including public replies and completed tools.
- The proposed outcome and supporting knowledge sources.
- Any remaining uncertainty, failed actions, or unresolved customer questions.
- The conversation version and action results on which the proposal is based.

Administrator actions:

- **Approve and close** — records the reviewing administrator, review version, reason, and timestamp.
- **Request more work** — adds an internal instruction and returns the ticket to the AI.
- **Reassign AI** — changes the responsible specialist and records a handoff.

If the customer replies or the conversation changes after the proposal, invalidate the proposal. The server must reject approval of a stale review. Simultaneous approval by two administrators must produce one closure record.

## AI execution boundaries

- Execute runs as durable background jobs with a ticket/version identifier and retry-safe action IDs.
- Validate permissions and action arguments on the server. Treat customer messages, retrieved text, and tool results as data, not authority to change rules.
- Only provide tools and knowledge sources approved for the assigned specialist. Customer identity comes from the ticket, not from model-supplied IDs.
- Before publishing a generated reply or executing an action, verify that the agent still owns the ticket and the run is current.
- Use bounded runs, timeouts, and usage limits. When a run fails or cannot support an answer, record the blocker and move the ticket to Needs admin decision.
- Keep an execution record of tool names, validated inputs, results, source references, timing, and usage. Show concise explanations, not hidden chain-of-thought.
- Distinguish live model execution from scripted demo fixtures. Never label a canned reply or simulated action as a live AI outcome.

## Interface

Administrator navigation:

- **Inbox** — filters for Ready for review, Needs decision, AI working, Waiting, New, and Closed.
- **AI agents** — specialists, configuration, enabled/paused state, assigned workload, and recent failures.
- **Knowledge** — approved help articles and the agents permitted to use them.
- **Actions and rules** — backend capabilities and their eligibility rules.
- **Performance** — customer outcomes, review results, time, and model usage.

Ticket detail:

- Customer conversation in the center.
- Assigned AI, lifecycle state, priority, and response deadline in the details panel.
- An expandable execution timeline showing actual operations and sources.
- A prominent review card when administrator attention is needed.

Keep the readable typography established in the local preview: 16px base, 14–15px primary interface text, and 12px supporting metadata.

## Metrics

The Performance workspace provides Overview, AI specialists, and Operations & usage reports with 7/30/90-day periods, AI mode filters, refresh, and CSV export.

- Volume: opened tickets, human-approved closures, and daily Chart.js trends.
- Speed: average, median, and p95 first response, queue-to-completion AI execution, admin review, and approved closure times, with sample sizes.
- AI outcomes: completed, failed, cancelled, queued/running, review proposals, customer follow-ups, and admin blockers.
- Quality gate: approvals, revisions, pending and superseded proposals; acceptance includes only explicit admin decisions.
- Specialists: historical runs and review credit, current workload, completion and acceptance rates, duration, and recorded tokens.
- Operations: current backlog age and priority, unassigned/blocked work, overdue first replies, and deadline compliance.
- Usage: input/output tokens, verified address updates, and execution mode counts. Scripted activity is clearly labelled; model cost and customer satisfaction are not estimated.

AI mode filters apply to runs and reviews, while ticket metrics remain workspace-wide. Backlog always reflects current unresolved work. Metric definitions and limitations are available in the interface and architecture document. Current ticket fields retain only the most recent closure cycle.

## First complete showcase

Use a fictional online store and seeded customer/order data. A customer asks for an address change. An administrator assigns Relay Orders. The agent checks order ownership and shipping eligibility, gathers the new address, performs a permitted change, verifies it, and submits a resolution summary. An administrator reviews the recorded evidence and closes the ticket.

Also demonstrate an already-shipped order: the action is rejected by backend policy, the AI explains the restriction, and the ticket moves to Needs admin decision rather than being marked complete.

## Delivery order

1. Add AI service identities, specialist assignment, and staff-only closure with a review queue.
2. Add knowledge-grounded generation and durable AI runs with explicit unavailable/error states.
3. Add one real action workflow against seeded store data, plus execution records.
4. Add usage reporting and a repeatable showcase script.

Provider credentials and local runtime data are excluded from version control.
