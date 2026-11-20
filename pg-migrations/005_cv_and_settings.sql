-- 005_cv_and_settings.sql
-- CV Analizi, Şirket Ayarları, Saklama Politikası ve Ekip Yönetimi

-- 1. CV Analiz Tablosu (CV-01, CV-02, CV-03, CV-04, CV-05)
CREATE TABLE IF NOT EXISTS cv_analyses (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  application_id uuid NOT NULL UNIQUE REFERENCES applications(id),
  cv_document_id uuid NOT NULL REFERENCES cv_documents(id),
  match_status text NOT NULL CHECK (match_status IN ('suitable', 'needs_review', 'unsuitable')),
  summary text NOT NULL,
  criteria_matches jsonb NOT NULL DEFAULT '[]'::jsonb,
  extracted_projects jsonb NOT NULL DEFAULT '[]'::jsonb,
  extracted_skills jsonb NOT NULL DEFAULT '[]'::jsonb,
  limitations text,
  analyzed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cv_analyses_org_app_idx ON cv_analyses (organization_id, application_id);

-- 2. Şirket Ayarları ve Saklama Politikası (B10, NFR-06)
CREATE TABLE IF NOT EXISTS organization_settings (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id),
  recording_retention_days integer NOT NULL DEFAULT 90 CHECK (recording_retention_days >= 7),
  appeal_window_days integer NOT NULL DEFAULT 14 CHECK (appeal_window_days >= 3),
  invite_mode text NOT NULL DEFAULT 'manual' CHECK (invite_mode IN ('manual', 'auto')),
  allow_candidate_audio_download boolean NOT NULL DEFAULT false,
  feedback_contact_email text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Mevcut şirketler için varsayılan ayarları ekle
INSERT INTO organization_settings (organization_id)
SELECT id FROM organizations
ON CONFLICT (organization_id) DO NOTHING;

-- 3. interview_plans tablosuna onay durumu ekle (B04 / JOB-04)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'interview_plans' AND column_name = 'is_approved'
  ) THEN
    ALTER TABLE interview_plans ADD COLUMN is_approved boolean NOT NULL DEFAULT false;
    ALTER TABLE interview_plans ADD COLUMN approved_by_user_id uuid REFERENCES users(id);
    ALTER TABLE interview_plans ADD COLUMN approved_at timestamptz;
  END IF;
END $$;
