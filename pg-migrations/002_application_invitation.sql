ALTER TABLE positions ADD COLUMN current_version integer NOT NULL DEFAULT 1 CHECK (current_version > 0);

CREATE TABLE position_versions (
  position_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  version_no integer NOT NULL CHECK (version_no > 0),
  title varchar(160) NOT NULL CHECK (char_length(title) >= 3),
  description varchar(10000) NOT NULL CHECK (char_length(description) >= 10),
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (position_id, version_no),
  FOREIGN KEY (position_id, organization_id) REFERENCES positions(id, organization_id)
);
INSERT INTO position_versions (position_id, organization_id, version_no, title, description, created_by_user_id, created_at)
SELECT id, organization_id, 1, title, description, created_by_user_id, created_at FROM positions;

ALTER TABLE position_requirements ADD COLUMN version_no integer NOT NULL DEFAULT 1 CHECK (version_no > 0);
ALTER TABLE position_requirements DROP CONSTRAINT position_requirements_position_id_sort_order_key;
ALTER TABLE position_requirements ADD CONSTRAINT position_requirements_version_order_unique UNIQUE (position_id, version_no, sort_order);
ALTER TABLE position_requirements ADD CONSTRAINT position_requirements_version_fk FOREIGN KEY (position_id, version_no) REFERENCES position_versions(position_id, version_no);

ALTER TABLE applications ADD COLUMN candidate_name varchar(160);
UPDATE applications a SET candidate_name = c.full_name FROM candidates c WHERE c.id = a.candidate_id;
ALTER TABLE applications ALTER COLUMN candidate_name SET NOT NULL;
ALTER TABLE applications ADD COLUMN position_version integer NOT NULL DEFAULT 1 CHECK (position_version > 0);
ALTER TABLE applications ADD CONSTRAINT applications_id_org_unique UNIQUE (id, organization_id);
ALTER TABLE applications ADD CONSTRAINT applications_id_org_position_unique UNIQUE (id, organization_id, position_id);
ALTER TABLE applications ADD CONSTRAINT applications_position_version_fk FOREIGN KEY (position_id, position_version) REFERENCES position_versions(position_id, version_no);

CREATE TABLE cv_documents (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  application_id uuid NOT NULL,
  original_filename varchar(255) NOT NULL,
  media_type text NOT NULL CHECK (media_type = 'application/pdf'),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 5000000),
  content bytea NOT NULL CHECK (octet_length(content) = size_bytes),
  review_status text NOT NULL DEFAULT 'pending' CHECK (review_status = 'pending'),
  uploaded_by_user_id uuid NOT NULL REFERENCES users(id),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (application_id),
  FOREIGN KEY (application_id, organization_id) REFERENCES applications(id, organization_id)
);
CREATE INDEX cv_documents_organization_idx ON cv_documents (organization_id, application_id);

CREATE TABLE invitations (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  application_id uuid NOT NULL,
  position_id uuid NOT NULL,
  position_version integer NOT NULL CHECK (position_version > 0),
  token_hash char(64) NOT NULL UNIQUE,
  estimated_minutes integer NOT NULL CHECK (estimated_minutes BETWEEN 15 AND 120),
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared', 'cancelled', 'expired')),
  delivery_status text NOT NULL DEFAULT 'not_sent' CHECK (delivery_status = 'not_sent'),
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  FOREIGN KEY (application_id, organization_id, position_id) REFERENCES applications(id, organization_id, position_id),
  FOREIGN KEY (position_id, position_version) REFERENCES position_versions(position_id, version_no)
);
CREATE UNIQUE INDEX invitations_one_prepared_per_application ON invitations (application_id) WHERE status = 'prepared';
CREATE INDEX invitations_organization_idx ON invitations (organization_id, application_id);
