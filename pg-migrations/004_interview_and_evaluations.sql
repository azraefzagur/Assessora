-- 004_interview_and_evaluations.sql
-- Mülakat, görev, kanıtlı değerlendirme ve itiraz veri modeli

-- 1. applications durum kısıtlamasını genişlet
ALTER TABLE applications DROP CONSTRAINT applications_status_check;
ALTER TABLE applications ADD CONSTRAINT applications_status_check
  CHECK (status IN ('created','invited','in_progress','submitted','review','human_review','completed','disputed'));

-- 2. Mülakat ve Görev Planları
CREATE TABLE interview_plans (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  position_id uuid NOT NULL,
  position_version integer NOT NULL CHECK (position_version > 0),
  rubric_version integer NOT NULL DEFAULT 1,
  questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  task_template jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (position_id, position_version) REFERENCES position_versions(position_id, version_no)
);
CREATE INDEX interview_plans_pos_idx ON interview_plans (position_id, position_version);

-- 3. Mülakat Oturumları
CREATE TABLE interview_sessions (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  application_id uuid NOT NULL REFERENCES applications(id),
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  invitation_id uuid REFERENCES invitations(id),
  status text NOT NULL DEFAULT 'preparing' CHECK (status IN ('preparing', 'device_checked', 'in_progress', 'interrupted', 'submitted', 'completed')),
  current_step text NOT NULL DEFAULT 'briefing' CHECK (current_step IN ('briefing', 'device_check', 'interview', 'task', 'completed')),
  started_at timestamptz,
  completed_at timestamptz,
  duration_seconds integer NOT NULL DEFAULT 0,
  current_question_index integer NOT NULL DEFAULT 0,
  video_asset_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (application_id)
);
CREATE INDEX interview_sessions_org_app_idx ON interview_sessions (organization_id, application_id);

-- 4. Konuşma Turları (Transkript)
CREATE TABLE interview_turns (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
  turn_number integer NOT NULL,
  speaker text NOT NULL CHECK (speaker IN ('ai', 'candidate')),
  requirement_id uuid REFERENCES position_requirements(id),
  question_text text,
  transcript_text text NOT NULL,
  audio_timestamp_start numeric(8,2) DEFAULT 0,
  audio_timestamp_end numeric(8,2) DEFAULT 0,
  is_followup boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX interview_turns_session_idx ON interview_turns (session_id, turn_number);

-- 5. Kapsam Takip Kayıtları (Gereksinim bazında mülakat izi)
CREATE TABLE coverage_records (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
  requirement_id uuid NOT NULL REFERENCES position_requirements(id),
  status text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'followup_needed', 'evaluated', 'incomplete')),
  evidence_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, requirement_id)
);

-- 6. Uygulamalı Görev Teslimleri
CREATE TABLE task_submissions (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES applications(id),
  task_type text NOT NULL CHECK (task_type IN ('sql', 'coding', 'case_study')),
  code_content text NOT NULL DEFAULT '',
  explanation_text text NOT NULL DEFAULT '',
  execution_output text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id)
);

-- 7. Yetkinlik Değerlendirmeleri ve Puanlar (Kanıt temelli)
CREATE TABLE assessments (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  application_id uuid NOT NULL REFERENCES applications(id),
  session_id uuid NOT NULL REFERENCES interview_sessions(id),
  requirement_id uuid REFERENCES position_requirements(id),
  is_overall boolean NOT NULL DEFAULT false,
  score numeric(5,2),
  weight numeric(4,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'incomplete_evidence', 'revised_by_human')),
  rationale text NOT NULL,
  strengths jsonb NOT NULL DEFAULT '[]'::jsonb,
  improvements jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  revised_by_user_id uuid REFERENCES users(id),
  revised_at timestamptz,
  revision_note text
);
CREATE INDEX assessments_app_idx ON assessments (application_id);

-- 8. Kanıt Referansları (Transkript veya Görev çıktısına doğrudan bağlama)
CREATE TABLE evidence_items (
  id uuid PRIMARY KEY,
  assessment_id uuid NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  turn_id uuid REFERENCES interview_turns(id),
  submission_id uuid REFERENCES task_submissions(id),
  video_timestamp_start numeric(8,2),
  video_timestamp_end numeric(8,2),
  quote text NOT NULL,
  explanation text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 9. Aday İtirazları ve İnsan İncelemesi
CREATE TABLE appeals (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  application_id uuid NOT NULL REFERENCES applications(id),
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  reason text NOT NULL CHECK (char_length(reason) >= 10),
  timestamp_reference text,
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'assigned', 'in_review', 'resolved')),
  assigned_user_id uuid REFERENCES users(id),
  decision text CHECK (decision IN ('upheld', 'revised', 'additional_interview')),
  decision_note text,
  decided_by_user_id uuid REFERENCES users(id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX appeals_org_app_idx ON appeals (organization_id, application_id);

-- 10. Denetim Kayıtları (Audit Log)
CREATE TABLE audit_logs (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  user_id uuid REFERENCES users(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  old_values jsonb,
  new_values jsonb,
  rationale text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_org_idx ON audit_logs (organization_id, created_at DESC);
