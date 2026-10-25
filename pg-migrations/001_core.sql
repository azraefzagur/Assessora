CREATE TABLE organizations (
  id uuid PRIMARY KEY,
  name varchar(160) NOT NULL CHECK (char_length(name) >= 2),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE users (
  id uuid PRIMARY KEY,
  email varchar(254) NOT NULL,
  password_hash text NOT NULL,
  development_only boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_unique ON users (lower(email));
CREATE TABLE memberships (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('admin','recruiter','reviewer')),
  active boolean NOT NULL DEFAULT true,
  UNIQUE (organization_id,user_id)
);
CREATE INDEX memberships_user_idx ON memberships (user_id,active);
CREATE TABLE candidates (
  id uuid PRIMARY KEY,
  email varchar(254) NOT NULL,
  full_name varchar(160) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX candidates_email_unique ON candidates (lower(email));
CREATE TABLE positions (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  title varchar(160) NOT NULL CHECK (char_length(title) >= 3),
  description varchar(10000) NOT NULL CHECK (char_length(description) >= 10),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','closed')),
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id,organization_id)
);
CREATE INDEX positions_organization_idx ON positions (organization_id,created_at);
CREATE TABLE position_requirements (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  position_id uuid NOT NULL,
  label varchar(120) NOT NULL,
  required boolean NOT NULL,
  weight integer NOT NULL CHECK (weight BETWEEN 0 AND 100),
  sort_order integer NOT NULL,
  UNIQUE (position_id,sort_order),
  FOREIGN KEY (position_id,organization_id) REFERENCES positions(id,organization_id)
);
CREATE TABLE applications (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  position_id uuid NOT NULL,
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  status text NOT NULL DEFAULT 'created' CHECK (status IN ('created','invited','interviewing','review','completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (position_id,candidate_id),
  FOREIGN KEY (position_id,organization_id) REFERENCES positions(id,organization_id)
);
CREATE INDEX applications_candidate_idx ON applications (candidate_id);
CREATE INDEX applications_organization_idx ON applications (organization_id);
CREATE TABLE login_codes (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  code_hash char(64) NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_codes_candidate_idx ON login_codes (candidate_id,created_at);
CREATE TABLE sessions (
  id_hash char(64) PRIMARY KEY,
  actor_type text CHECK (actor_type IN ('company','candidate')),
  actor_id uuid,
  organization_id uuid REFERENCES organizations(id),
  csrf_token char(48) NOT NULL,
  development_only boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL
);
