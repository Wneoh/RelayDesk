ALTER TABLE ai_runs ADD COLUMN outcome text CHECK(outcome IN ('review','waiting','blocked'));
UPDATE ai_runs SET outcome=CASE steps->-1->>'name'
  WHEN 'Submitted for review' THEN 'review'
  WHEN 'Waiting for customer' THEN 'waiting'
  WHEN 'Needs admin decision' THEN 'blocked' END
WHERE status='completed';
CREATE INDEX ai_runs_reporting ON ai_runs(created_at,mode);
CREATE INDEX reviews_decision_reporting ON resolution_reviews(reviewed_at);
CREATE INDEX tickets_created_reporting ON tickets(created_at);
CREATE INDEX tickets_closed_reporting ON tickets(resolved_at) WHERE resolved_at IS NOT NULL;
