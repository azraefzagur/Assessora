CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 160),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE memberships (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('admin','recruiter','reviewer')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  UNIQUE(organization_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships(user_id, active);
CREATE TABLE candidates (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE positions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 3 AND 160),
  description TEXT NOT NULL CHECK (length(description) BETWEEN 10 AND 10000),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','closed')),
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX positions_organization_idx ON positions(organization_id, created_at);
CREATE TABLE position_requirements (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  position_id TEXT NOT NULL REFERENCES positions(id),
  label TEXT NOT NULL,
  required INTEGER NOT NULL CHECK (required IN (0,1)),
  weight INTEGER NOT NULL CHECK (weight BETWEEN 0 AND 100),
  sort_order INTEGER NOT NULL,
  UNIQUE(position_id, sort_order)
);
CREATE TABLE applications (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  position_id TEXT NOT NULL REFERENCES positions(id),
  candidate_id TEXT NOT NULL REFERENCES candidates(id),
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created','invited','interviewing','review','completed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(position_id, candidate_id)
);
CREATE INDEX applications_candidate_idx ON applications(candidate_id);
CREATE INDEX applications_organization_idx ON applications(organization_id);
CREATE TABLE login_codes (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id),
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX login_codes_candidate_idx ON login_codes(candidate_id, created_at);
CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  actor_type TEXT CHECK (actor_type IN ('company','candidate')),
  actor_id TEXT,
  organization_id TEXT REFERENCES organizations(id),
  csrf_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
