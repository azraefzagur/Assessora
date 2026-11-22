-- 010_password_setup.sql
-- #5: Ekip üyesine sabit şifre atanmasını kaldır, tek kullanımlık "şifreni belirle" bağlantısı.

-- Ekip listesi bu kolonu sıralama ve "eklenme tarihi" için kullanıyor; hiçbir migration eklememişti
-- ve ekip sayfası boş veritabanında çöküyordu.
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- Şifresini henüz belirlememiş kullanıcı NULL taşır ve giriş yapamaz.
-- Varsayılan now(): mevcut kayıt akışları (şirket kaydı, setup, seed) değişmeden şifreli kabul edilir.
ALTER TABLE users ADD COLUMN password_set_at timestamptz DEFAULT now();
UPDATE users SET password_set_at = created_at;

CREATE TABLE password_setup_tokens (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  token_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_setup_tokens_user_idx ON password_setup_tokens (user_id, created_at DESC);

ALTER TABLE email_jobs ADD COLUMN password_setup_token_id uuid UNIQUE REFERENCES password_setup_tokens(id);
ALTER TABLE email_jobs DROP CONSTRAINT email_jobs_kind_check;
ALTER TABLE email_jobs ADD CONSTRAINT email_jobs_kind_check
  CHECK (kind IN ('login_code','invitation','password_setup'));
ALTER TABLE email_jobs DROP CONSTRAINT email_jobs_check;
ALTER TABLE email_jobs ADD CONSTRAINT email_jobs_target_check CHECK (
  (kind='login_code'     AND login_code_id IS NOT NULL AND invitation_id IS NULL AND password_setup_token_id IS NULL) OR
  (kind='invitation'     AND invitation_id IS NOT NULL AND login_code_id IS NULL AND password_setup_token_id IS NULL) OR
  (kind='password_setup' AND password_setup_token_id IS NOT NULL AND login_code_id IS NULL AND invitation_id IS NULL));
