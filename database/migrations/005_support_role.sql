ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK(role IN ('customer','agent','support','admin'));
ALTER TABLE ai_response_drafts ADD COLUMN approval_note text;
ALTER TABLE tickets ADD COLUMN deleted_at timestamptz;
ALTER TABLE tickets ADD COLUMN deleted_by uuid REFERENCES users(id);
ALTER TABLE tickets ADD COLUMN deletion_note text;
CREATE INDEX tickets_active ON tickets(updated_at DESC) WHERE deleted_at IS NULL;
