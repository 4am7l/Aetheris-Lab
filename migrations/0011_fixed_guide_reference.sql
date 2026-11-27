-- Anchor the original figures to their exact 0007 rows and source document.
CREATE VIEW fixed_guide_reference AS
SELECT c.id, c.cas, c.formula, c.concentration, c.solvent, c.formulation, c.name_ar AS nameAr, c.name_en AS nameEn,
  p.id AS priceId, p.value AS price, p.currency, p.unit AS denominator,
  json_extract(p.source_json, '$.suppliedValue') AS sourcePrice,
  json_extract(p.source_json, '$.column') AS sourcePriceUnit,
  f.id AS factorId, f.value AS factor, json_extract(f.source_json, '$.suppliedValue') AS sourceFactor,
  json_extract(f.source_json, '$.column') AS sourceFactorUnit,
  json_extract(c.provenance_json, '$.document') AS document, json_extract(c.provenance_json, '$.sha256') AS sourceHash,
  json_extract(c.provenance_json, '$.page') AS page, json_extract(c.provenance_json, '$.row') AS rowNumber
FROM chemical_references c
JOIN chemical_price_versions p ON p.id = c.id || '-combined' AND p.chemical_id = c.id
JOIN carbon_factor_versions f ON f.id = c.id || '-carbon' AND f.chemical_id = c.id
WHERE c.institution_id IS NULL AND p.institution_id IS NULL AND f.institution_id IS NULL
  AND json_extract(c.provenance_json, '$.sha256') = 'bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce'
  AND json_extract(c.provenance_json, '$.section') = 4
  AND json_extract(c.provenance_json, '$.row') BETWEEN 1 AND 25
  AND json_extract(p.source_json, '$.sha256') = json_extract(c.provenance_json, '$.sha256')
  AND json_extract(f.source_json, '$.sha256') = json_extract(c.provenance_json, '$.sha256')
  AND p.kind = 'combined' AND p.package_quantity = 1 AND p.currency = 'JOD' AND p.unit = 'L' AND f.unit = 'L';

CREATE TRIGGER fixed_guide_material_no_update BEFORE UPDATE ON chemical_references
WHEN EXISTS (SELECT 1 FROM fixed_guide_reference WHERE id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'Fixed guide formulation is immutable'); END;

CREATE TRIGGER fixed_guide_material_no_delete BEFORE DELETE ON chemical_references
WHEN EXISTS (SELECT 1 FROM fixed_guide_reference WHERE id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'Fixed guide formulation is immutable'); END;

CREATE TRIGGER fixed_guide_material_no_replace BEFORE INSERT ON chemical_references
WHEN EXISTS (SELECT 1 FROM fixed_guide_reference WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'Fixed guide formulation is immutable'); END;

CREATE TRIGGER fixed_guide_price_no_replace BEFORE INSERT ON chemical_price_versions
WHEN EXISTS (SELECT 1 FROM fixed_guide_reference WHERE priceId IN (NEW.id, NEW.supersedes))
BEGIN SELECT RAISE(ABORT, 'Fixed guide rate is immutable'); END;

CREATE TRIGGER fixed_guide_factor_no_replace BEFORE INSERT ON carbon_factor_versions
WHEN EXISTS (SELECT 1 FROM fixed_guide_reference WHERE factorId IN (NEW.id, NEW.supersedes))
BEGIN SELECT RAISE(ABORT, 'Fixed guide rate is immutable'); END;

CREATE TABLE assessment_guide_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL REFERENCES public_requests(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('A','B')),
  reference_id TEXT NOT NULL REFERENCES chemical_references(id),
  applicable INTEGER NOT NULL CHECK (applicable IN (0,1)),
  reason TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX assessment_guide_review_scope ON assessment_guide_reviews(request_id, run_id, side, id DESC);

CREATE TRIGGER assessment_guide_review_no_update BEFORE UPDATE ON assessment_guide_reviews
BEGIN SELECT RAISE(ABORT, 'Guide reviews are append-only'); END;

CREATE TRIGGER assessment_guide_review_no_delete BEFORE DELETE ON assessment_guide_reviews
WHEN NOT EXISTS (SELECT 1 FROM public_request_management_events WHERE request_id = OLD.request_id AND action = 'delete')
BEGIN SELECT RAISE(ABORT, 'Guide reviews are append-only'); END;
