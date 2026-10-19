ALTER TABLE ai_runs ADD COLUMN requires_approval boolean NOT NULL DEFAULT false;
ALTER TABLE ai_runs ADD COLUMN previous_status text;
CREATE TABLE ai_response_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL UNIQUE REFERENCES ai_runs(id) ON DELETE CASCADE,
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES ai_agents(id), revision integer NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sent','discarded','stale')),
  body text NOT NULL CHECK(length(body) BETWEEN 1 AND 5000),
  outcome jsonb NOT NULL, sources jsonb NOT NULL DEFAULT '[]', customer_text text NOT NULL,
  previous_status text, reviewed_by uuid REFERENCES users(id), reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ai_drafts_one_pending ON ai_response_drafts(ticket_id) WHERE state='pending';
