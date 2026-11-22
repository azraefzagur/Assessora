UPDATE cv_documents cv
SET review_status = 'reviewed'
WHERE cv.review_status = 'pending'
  AND EXISTS (
    SELECT 1
    FROM cv_analyses analysis
    WHERE analysis.cv_document_id = cv.id
  );
