-- 006_feedback_and_polish.sql
-- B10 Aday kayıt erişim kısıtlaması ve Değerlendirme Geri Bildirimleri (Model İzleme)

ALTER TABLE organization_settings 
  ADD COLUMN IF NOT EXISTS candidate_privacy_restricted boolean NOT NULL DEFAULT true;

ALTER TABLE assessments ALTER COLUMN weight TYPE numeric(5,2);

CREATE TABLE IF NOT EXISTS evaluation_feedbacks (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  user_id uuid REFERENCES users(id),
  position_id uuid REFERENCES positions(id),
  application_id uuid REFERENCES applications(id),
  feedback_type text NOT NULL CHECK (feedback_type IN ('prompt_adjustment', 'rubric_refinement', 'scoring_accuracy', 'transcription_issue')),
  notes text NOT NULL,
  status text NOT NULL DEFAULT 'logged' CHECK (status IN ('logged', 'reviewed', 'incorporated')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS evaluation_feedbacks_org_idx ON evaluation_feedbacks (organization_id, created_at DESC);
