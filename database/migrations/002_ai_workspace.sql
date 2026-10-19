CREATE TABLE ai_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE,
  name text NOT NULL, specialty text NOT NULL, description text NOT NULL,
  instructions text NOT NULL, enabled boolean NOT NULL DEFAULT true,
  color text NOT NULL DEFAULT 'indigo', created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO ai_agents(slug,name,specialty,description,instructions,color) VALUES
('support','Relay Support','General support','Product guidance, account questions, and getting started.','Use approved knowledge to answer product questions. Ask for details when necessary. Never claim an account change you cannot perform.','indigo'),
('orders','Relay Orders','Orders & delivery','Order tracking, delivery questions, and eligible address changes.','Check the customer-owned order before responding. An address change is permitted only before shipment and when the customer explicitly supplies the complete new address.','cyan'),
('billing','Relay Billing','Billing & invoices','Invoice guidance, payment questions, and billing exceptions.','Use approved billing policy. Never issue a refund or claim a payment action. Escalate payment disputes for an administrator decision.','violet');
CREATE TABLE knowledge_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), agent_id uuid NOT NULL REFERENCES ai_agents(id),
  title text NOT NULL CHECK(length(title) BETWEEN 3 AND 160),
  content text NOT NULL CHECK(length(content) BETWEEN 20 AND 12000),
  enabled boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tickets DROP CONSTRAINT tickets_status_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_status_check CHECK(status IN ('open','in_progress','waiting','review','blocked','resolved'));
ALTER TABLE tickets ADD COLUMN ai_agent_id uuid REFERENCES ai_agents(id);
ALTER TABLE tickets ADD COLUMN revision integer NOT NULL DEFAULT 0;
ALTER TABLE tickets ADD COLUMN reviewed_by uuid REFERENCES users(id);
ALTER TABLE tickets ADD COLUMN closure_reason text;
UPDATE tickets SET ai_agent_id=(SELECT id FROM ai_agents WHERE slug=CASE
  WHEN lower(subject) SIMILAR TO '%(order|shipping|delivery|store)%' THEN 'orders'
  WHEN lower(subject) SIMILAR TO '%(payment|invoice|billing)%' THEN 'billing' ELSE 'support' END)
WHERE assignee_id IS NOT NULL;
ALTER TABLE messages ALTER COLUMN author_id DROP NOT NULL;
ALTER TABLE messages ADD COLUMN ai_agent_id uuid REFERENCES ai_agents(id);
ALTER TABLE messages ADD CONSTRAINT messages_author_check CHECK((author_id IS NOT NULL)::int+(ai_agent_id IS NOT NULL)::int=1);
CREATE UNIQUE INDEX messages_ai_dedup ON messages(ticket_id,ai_agent_id,client_message_id) WHERE ai_agent_id IS NOT NULL;
ALTER TABLE activities ALTER COLUMN actor_id DROP NOT NULL;
ALTER TABLE activities ADD COLUMN ai_agent_id uuid REFERENCES ai_agents(id);
CREATE TABLE ai_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES ai_agents(id), revision integer NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','cancelled','failed')),
  mode text NOT NULL CHECK(mode IN ('demo','live','unavailable')),
  attempts integer NOT NULL DEFAULT 0, lease_until timestamptz,
  steps jsonb NOT NULL DEFAULT '[]', error text, input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  UNIQUE(ticket_id,revision)
);
CREATE INDEX ai_runs_queue ON ai_runs(status,created_at);
CREATE TABLE resolution_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  run_id uuid REFERENCES ai_runs(id), revision integer NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','rejected','stale')),
  summary text NOT NULL, evidence jsonb NOT NULL DEFAULT '[]', sources jsonb NOT NULL DEFAULT '[]',
  reviewed_by uuid REFERENCES users(id), reviewed_at timestamptz, feedback text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX reviews_one_pending ON resolution_reviews(ticket_id) WHERE state='pending';
CREATE TABLE store_orders (
  id text PRIMARY KEY, customer_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL CHECK(status IN ('preparing','shipped','delivered')),
  address text NOT NULL, tracking text, total_cents integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
