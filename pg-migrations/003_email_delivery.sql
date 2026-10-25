ALTER TABLE invitations DROP CONSTRAINT invitations_delivery_status_check;
ALTER TABLE invitations ADD CONSTRAINT invitations_delivery_status_check
  CHECK (delivery_status IN ('not_sent','pending','sending','accepted','failed','uncertain'));

CREATE TABLE code_request_limits (
  id uuid PRIMARY KEY,
  email_hash char(64) NOT NULL,
  ip_hash char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX code_request_limits_email_idx ON code_request_limits (email_hash,created_at);
CREATE INDEX code_request_limits_ip_idx ON code_request_limits (ip_hash,created_at);

CREATE TABLE email_jobs (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('login_code','invitation')),
  login_code_id uuid UNIQUE REFERENCES login_codes(id),
  invitation_id uuid UNIQUE REFERENCES invitations(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','accepted','failed','uncertain')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  failure_kind text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  accepted_at timestamptz,
  failed_at timestamptz,
  CHECK ((kind='login_code' AND login_code_id IS NOT NULL AND invitation_id IS NULL)
      OR (kind='invitation' AND invitation_id IS NOT NULL AND login_code_id IS NULL))
);
CREATE INDEX email_jobs_pending_idx ON email_jobs (created_at) WHERE status='pending';
