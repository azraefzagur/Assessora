CREATE TRIGGER requirement_tenant_insert BEFORE INSERT ON position_requirements
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM positions WHERE id=NEW.position_id AND organization_id=NEW.organization_id
  ) THEN RAISE(ABORT, 'requirement tenant mismatch') END;
END;
CREATE TRIGGER requirement_tenant_update BEFORE UPDATE OF position_id,organization_id ON position_requirements
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM positions WHERE id=NEW.position_id AND organization_id=NEW.organization_id
  ) THEN RAISE(ABORT, 'requirement tenant mismatch') END;
END;
CREATE TRIGGER application_tenant_insert BEFORE INSERT ON applications
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM positions WHERE id=NEW.position_id AND organization_id=NEW.organization_id
  ) THEN RAISE(ABORT, 'application tenant mismatch') END;
END;
CREATE TRIGGER application_tenant_update BEFORE UPDATE OF position_id,organization_id ON applications
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM positions WHERE id=NEW.position_id AND organization_id=NEW.organization_id
  ) THEN RAISE(ABORT, 'application tenant mismatch') END;
END;
