import { responseDraftSchema, type User } from '@relaydesk/contracts';
import type { Database } from './db.js';
import { AppError, accessTicket, requireStaff } from './auth.js';
import { outcomeSchema, prepareAction, publishResponse } from './ai.js';
import { logActivity } from './tickets.js';
export async function decideResponseDraft(db: Database, id: string, user: User, input: unknown) {
  requireStaff(user);
  const data = responseDraftSchema.parse(input);
  if (user.role === 'support' && data.decision === 'send' && data.note.length < 5)
    throw new AppError(400, 'Add an approval note of at least 5 characters.');
  if (data.decision === 'send' && !data.body)
    throw new AppError(400, 'Review and provide the response before sending.');
  await db.transaction(async (tx) => {
    await tx.query('SELECT id FROM tickets WHERE id=$1 FOR UPDATE', [id]);
    const ticket = await accessTicket(tx, id, user);
    const draft = (
      await tx.query('SELECT * FROM ai_response_drafts WHERE id=$1 AND ticket_id=$2 FOR UPDATE', [
        data.draftId,
        id,
      ])
    ).rows[0];
    if (
      !draft ||
      draft.state !== 'pending' ||
      draft.revision !== ticket.revision ||
      ticket.revision !== data.expectedRevision ||
      ticket.status !== 'review' ||
      draft.agent_id !== ticket.ai_agent_id
    )
      throw new AppError(
        409,
        'This response draft is no longer current. Review the latest conversation.',
      );
    if (data.decision === 'discard') {
      await tx.query(
        "UPDATE ai_response_drafts SET state='discarded',reviewed_by=$2,reviewed_at=now() WHERE id=$1",
        [draft.id, user.id],
      );
      const restored = ['waiting', 'blocked', 'open'].includes(draft.previous_status)
        ? draft.previous_status
        : 'blocked';
      await tx.query(
        'UPDATE tickets SET status=$2,revision=revision+1,updated_at=now() WHERE id=$1',
        [id, restored],
      );
      await logActivity(
        tx,
        id,
        user,
        'draft_discarded',
        'discarded the private response draft; no response was sent',
      );
      return;
    }
    const agent = (
      await tx.query('SELECT * FROM ai_agents WHERE id=$1 FOR SHARE', [draft.agent_id])
    ).rows[0];
    if (!agent?.enabled)
      throw new AppError(
        409,
        'The specialist is paused. Re-enable it before sending or discard the draft.',
      );
    const run = (await tx.query('SELECT * FROM ai_runs WHERE id=$1 FOR UPDATE', [draft.run_id]))
      .rows[0];
    if (run.status !== 'completed' || !run.requires_approval)
      throw new AppError(409, 'The draft run is no longer ready to send.');
    const outcome = outcomeSchema.parse(draft.outcome),
      steps = [...run.steps];
    // Revalidate and perform any permitted action only after explicit administrator approval.
    await prepareAction(tx, ticket, agent, draft.customer_text, outcome, steps, true, true);
    outcome.reply = data.body!;
    await publishResponse(tx, run, ticket, agent, outcome, draft.sources);
    await tx.query(
      "UPDATE ai_response_drafts SET state='sent',body=$2,reviewed_by=$3,reviewed_at=now(),approval_note=$4 WHERE id=$1",
      [draft.id, data.body, user.id, data.note],
    );
    steps.push({
      name: 'Response approved and sent',
      detail: `${user.name} reviewed the response and explicitly sent it to the customer.`,
      status: 'complete',
    });
    await tx.query('UPDATE ai_runs SET steps=$2 WHERE id=$1', [run.id, JSON.stringify(steps)]);
    await logActivity(
      tx,
      id,
      user,
      'response_approved',
      'approved the AI response and sent it to the customer' + (data.note ? ': ' + data.note : ''),
    );
  });
}
