ALTER TABLE cv_documents DROP CONSTRAINT cv_documents_review_status_check;
ALTER TABLE cv_documents ADD CONSTRAINT cv_documents_review_status_check
  CHECK (review_status IN ('pending','reviewed'));
