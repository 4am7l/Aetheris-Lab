CREATE TABLE institutions (
  id TEXT PRIMARY KEY NOT NULL,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  geography TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE institution_departments (
  id TEXT PRIMARY KEY NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id),
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  UNIQUE (institution_id, id)
);
CREATE TABLE institution_labs (
  id TEXT PRIMARY KEY NOT NULL,
  institution_id TEXT NOT NULL,
  department_id TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  UNIQUE (institution_id, id),
  FOREIGN KEY (institution_id, department_id) REFERENCES institution_departments(institution_id, id)
);
CREATE TABLE chemical_references (
  id TEXT PRIMARY KEY NOT NULL,
  institution_id TEXT REFERENCES institutions(id),
  lab_id TEXT,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  cas TEXT,
  pubchem_cid INTEGER CHECK (pubchem_cid > 0),
  formula TEXT,
  concentration TEXT,
  purity TEXT,
  solvent TEXT,
  formulation TEXT,
  physical_state TEXT,
  category TEXT,
  hazard_evidence TEXT,
  waste_category TEXT,
  status TEXT NOT NULL CHECK (status IN ('unverified', 'verified')),
  provenance_json TEXT NOT NULL CHECK (json_valid(provenance_json)),
  updated_at TEXT NOT NULL,
  CHECK (lab_id IS NULL OR institution_id IS NOT NULL),
  FOREIGN KEY (institution_id, lab_id) REFERENCES institution_labs(institution_id, id)
);
CREATE INDEX chemical_reference_search ON chemical_references(institution_id, lab_id, name_en, id);
CREATE INDEX chemical_reference_cas ON chemical_references(cas);
CREATE TABLE chemical_price_versions (
  id TEXT PRIMARY KEY NOT NULL,
  chemical_id TEXT NOT NULL REFERENCES chemical_references(id),
  institution_id TEXT REFERENCES institutions(id),
  kind TEXT NOT NULL CHECK (kind IN ('purchase', 'disposal', 'combined')),
  value REAL NOT NULL CHECK (value >= 0),
  currency TEXT NOT NULL,
  package_quantity REAL NOT NULL CHECK (package_quantity > 0),
  unit TEXT NOT NULL CHECK (unit IN ('uL', 'mL', 'L', 'g', 'kg')),
  supplier TEXT,
  invoice_reference TEXT,
  effective_date TEXT,
  source_json TEXT NOT NULL CHECK (json_valid(source_json)),
  status TEXT NOT NULL CHECK (status IN ('unverified', 'verified')),
  supersedes TEXT REFERENCES chemical_price_versions(id),
  created_at TEXT NOT NULL,
  UNIQUE (supersedes),
  CHECK (status <> 'verified' OR (kind <> 'combined' AND effective_date IS NOT NULL AND invoice_reference IS NOT NULL))
);
CREATE INDEX chemical_price_history ON chemical_price_versions(chemical_id, institution_id, created_at);
CREATE TABLE carbon_factor_versions (
  id TEXT PRIMARY KEY NOT NULL,
  chemical_id TEXT NOT NULL REFERENCES chemical_references(id),
  institution_id TEXT REFERENCES institutions(id),
  value REAL NOT NULL CHECK (value >= 0),
  unit TEXT NOT NULL CHECK (unit IN ('uL', 'mL', 'L', 'g', 'kg')),
  stage TEXT CHECK (stage IN ('manufacturing', 'transportation', 'treatment', 'disposal')),
  geography TEXT,
  boundary TEXT,
  source_url TEXT,
  publication_date TEXT,
  methodology TEXT,
  uncertainty TEXT,
  source_json TEXT NOT NULL CHECK (json_valid(source_json)),
  status TEXT NOT NULL CHECK (status IN ('unverified', 'verified')),
  supersedes TEXT REFERENCES carbon_factor_versions(id),
  created_at TEXT NOT NULL,
  UNIQUE (supersedes),
  CHECK (status <> 'verified' OR (stage IS NOT NULL AND geography IS NOT NULL AND boundary IS NOT NULL
    AND source_url IS NOT NULL AND publication_date IS NOT NULL AND methodology IS NOT NULL AND uncertainty IS NOT NULL))
);
CREATE INDEX carbon_factor_history ON carbon_factor_versions(chemical_id, institution_id, created_at);
CREATE TABLE chemical_density_versions (
  id TEXT PRIMARY KEY NOT NULL,
  chemical_id TEXT NOT NULL REFERENCES chemical_references(id),
  institution_id TEXT REFERENCES institutions(id),
  kg_per_liter REAL NOT NULL CHECK (kg_per_liter > 0),
  conditions TEXT NOT NULL,
  source_url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  supersedes TEXT UNIQUE REFERENCES chemical_density_versions(id)
);
CREATE TRIGGER chemical_price_no_update BEFORE UPDATE ON chemical_price_versions
BEGIN SELECT RAISE(ABORT, 'Price versions are append-only'); END;
CREATE TRIGGER chemical_price_no_delete BEFORE DELETE ON chemical_price_versions
BEGIN SELECT RAISE(ABORT, 'Price versions are append-only'); END;
CREATE TRIGGER carbon_factor_no_update BEFORE UPDATE ON carbon_factor_versions
BEGIN SELECT RAISE(ABORT, 'Factor versions are append-only'); END;
CREATE TRIGGER carbon_factor_no_delete BEFORE DELETE ON carbon_factor_versions
BEGIN SELECT RAISE(ABORT, 'Factor versions are append-only'); END;
CREATE TRIGGER chemical_density_no_update BEFORE UPDATE ON chemical_density_versions
BEGIN SELECT RAISE(ABORT, 'Density versions are append-only'); END;
CREATE TRIGGER chemical_density_no_delete BEFORE DELETE ON chemical_density_versions
BEGIN SELECT RAISE(ABORT, 'Density versions are append-only'); END;

-- Transcribed from the supplied 25-solution guide. All numerical references require independent verification.
INSERT INTO chemical_references (id, name_ar, name_en, cas, formula, concentration, purity, solvent, formulation, physical_state, category, hazard_evidence, waste_category, status, provenance_json, updated_at)
VALUES ('reference-hydrochloric-acid', 'حمض الهيدروكلوريك', 'Hydrochloric acid', '7647-01-0', 'HCl', '37% (12 M)', NULL, NULL, NULL, 'سائل شفاف', 'inorganic-acid', 'عالية (آكّال وأبخرة مهيّجة)', 'نفايات حمضية غير عضوية', 'unverified', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":1,"row":1}', '2026-11-27T00:00:00.000Z');
INSERT INTO chemical_price_versions (id, chemical_id, kind, value, currency, package_quantity, unit, source_json, status, created_at)
VALUES ('reference-hydrochloric-acid-combined', 'reference-hydrochloric-acid', 'combined', 6, 'JOD', 1, 'L', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":1,"row":1,"column":"د/لتر","suppliedValue":"6"}', 'unverified', '2026-11-27T00:00:00.000Z');
INSERT INTO carbon_factor_versions (id, chemical_id, value, unit, source_json, status, created_at)
VALUES ('reference-hydrochloric-acid-carbon', 'reference-hydrochloric-acid', 0.10, 'L', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":1,"row":1,"column":"كغم/لتر","suppliedValue":"0.10"}', 'unverified', '2026-11-27T00:00:00.000Z');

INSERT INTO chemical_references (id, name_ar, name_en, cas, formula, concentration, purity, solvent, formulation, physical_state, category, hazard_evidence, waste_category, status, provenance_json, updated_at)
VALUES ('reference-sulfuric-acid', 'حمض الكبريتيك', 'Sulfuric acid', '7664-93-9', 'H2SO4', '95–98% (18 M)', NULL, NULL, NULL, 'سائل زيتي كثيف', 'inorganic-acid', 'عالية جداً (آكّال وحارق ومجفف)', 'نفايات أحماض غير عضوية', 'unverified', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":1,"row":2}', '2026-11-27T00:00:00.000Z');
INSERT INTO chemical_price_versions (id, chemical_id, kind, value, currency, package_quantity, unit, source_json, status, created_at)
VALUES ('reference-sulfuric-acid-combined', 'reference-sulfuric-acid', 'combined', 8, 'JOD', 1, 'L', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":1,"row":2,"column":"د/لتر","suppliedValue":"8"}', 'unverified', '2026-11-27T00:00:00.000Z');
INSERT INTO carbon_factor_versions (id, chemical_id, value, unit, source_json, status, created_at)
VALUES ('reference-sulfuric-acid-carbon', 'reference-sulfuric-acid', 0.15, 'L', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":1,"row":2,"column":"كغم/لتر","suppliedValue":"0.15"}', 'unverified', '2026-11-27T00:00:00.000Z');

INSERT INTO chemical_references (id, name_ar, name_en, cas, formula, concentration, purity, solvent, formulation, physical_state, category, hazard_evidence, waste_category, status, provenance_json, updated_at)
VALUES ('reference-nitric-acid', 'حمض النيتريك', 'Nitric acid', '7697-37-2', 'HNO3', '65–70% (15.8 M)', NULL, NULL, NULL, 'سائل شفاف / مصفر', 'inorganic-acid', 'عالية جداً (مؤكسد قوي وآكّال)', 'أحماض مؤكسدة', 'unverified', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":2,"row":3}', '2026-11-27T00:00:00.000Z');
INSERT INTO chemical_price_versions (id, chemical_id, kind, value, currency, package_quantity, unit, source_json, status, created_at)
VALUES ('reference-nitric-acid-combined', 'reference-nitric-acid', 'combined', 10, 'JOD', 1, 'L', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":2,"row":3,"column":"د/لتر","suppliedValue":"10"}', 'unverified', '2026-11-27T00:00:00.000Z');
INSERT INTO carbon_factor_versions (id, chemical_id, value, unit, source_json, status, created_at)
VALUES ('reference-nitric-acid-carbon', 'reference-nitric-acid', 0.25, 'L', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":2,"row":3,"column":"كغم/لتر","suppliedValue":"0.25"}', 'unverified', '2026-11-27T00:00:00.000Z');

INSERT INTO chemical_references (id, name_ar, name_en, cas, formula, concentration, purity, solvent, formulation, physical_state, category, hazard_evidence, waste_category, status, provenance_json, updated_at)
VALUES ('reference-phosphoric-acid', 'حمض الفوسفوريك', 'Phosphoric acid', '7664-38-2', 'H3PO4', '85% (14.7 M)', NULL, NULL, NULL, 'سائل لزج شفاف', 'inorganic-acid', 'متوسطة (آكّال للجلد والعين)', 'نفايات حمضية غير عضوية', 'unverified', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":2,"row":4}', '2026-11-27T00:00:00.000Z');
INSERT INTO chemical_price_versions (id, chemical_id, kind, value, currency, package_quantity, unit, source_json, status, created_at)
VALUES ('reference-phosphoric-acid-combined', 'reference-phosphoric-acid', 'combined', 7, 'JOD', 1, 'L', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":2,"row":4,"column":"د/لتر","suppliedValue":"7"}', 'unverified', '2026-11-27T00:00:00.000Z');
INSERT INTO carbon_factor_versions (id, chemical_id, value, unit, source_json, status, created_at)
VALUES ('reference-phosphoric-acid-carbon', 'reference-phosphoric-acid', 0.10, 'L', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":2,"row":4,"column":"كغم/لتر","suppliedValue":"0.10"}', 'unverified', '2026-11-27T00:00:00.000Z');

INSERT INTO chemical_references (id, name_ar, name_en, cas, formula, concentration, purity, solvent, formulation, physical_state, category, hazard_evidence, waste_category, status, provenance_json, updated_at)
VALUES ('reference-acetic-acid', 'حمض الخليك', 'Acetic acid', '64-19-7', 'CH3COOH', '99.7% ثلجي', NULL, NULL, 'ثلجي', 'سائل شفاف نفّاذ', 'organic-acid', 'متوسطة (آكّال وقابل للاشتعال)', 'نفايات عضوية غير مهلجنة', 'unverified', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":2,"row":5}', '2026-11-27T00:00:00.000Z');
INSERT INTO chemical_price_versions (id, chemical_id, kind, value, currency, package_quantity, unit, source_json, status, created_at)
VALUES ('reference-acetic-acid-combined', 'reference-acetic-acid', 'combined', 8, 'JOD', 1, 'L', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":2,"row":5,"column":"د/لتر","suppliedValue":"8"}', 'unverified', '2026-11-27T00:00:00.000Z');
INSERT INTO carbon_factor_versions (id, chemical_id, value, unit, source_json, status, created_at)
VALUES ('reference-acetic-acid-carbon', 'reference-acetic-acid', 0.20, 'L', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":2,"row":5,"column":"كغم/لتر","suppliedValue":"0.20"}', 'unverified', '2026-11-27T00:00:00.000Z');

INSERT INTO chemical_references (id, name_ar, name_en, cas, formula, concentration, purity, solvent, formulation, physical_state, category, hazard_evidence, waste_category, status, provenance_json, updated_at)
VALUES ('reference-sodium-hydroxide', 'هيدروكسيد الصوديوم', 'Sodium hydroxide', '1310-73-2', 'NaOH', '1–10 M', NULL, 'water', 'مائي', 'محلول مائي شفاف', 'base', 'عالية (كاوي جداً للعين والجلد)', 'قواعد غير عضوية', 'unverified', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":2,"row":6}', '2026-11-27T00:00:00.000Z');
INSERT INTO chemical_price_versions (id, chemical_id, kind, value, currency, package_quantity, unit, source_json, status, created_at)
VALUES ('reference-sodium-hydroxide-combined', 'reference-sodium-hydroxide', 'combined', 5, 'JOD', 1, 'L', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":2,"row":6,"column":"د/لتر","suppliedValue":"5"}', 'unverified', '2026-11-27T00:00:00.000Z');
INSERT INTO carbon_factor_versions (id, chemical_id, value, unit, source_json, status, created_at)
VALUES ('reference-sodium-hydroxide-carbon', 'reference-sodium-hydroxide', 0.08, 'L', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":2,"row":6,"column":"كغم/لتر","suppliedValue":"0.08"}', 'unverified', '2026-11-27T00:00:00.000Z');

INSERT INTO chemical_references (id, name_ar, name_en, cas, formula, concentration, purity, solvent, formulation, physical_state, category, hazard_evidence, waste_category, status, provenance_json, updated_at)
VALUES ('reference-potassium-hydroxide', 'هيدروكسيد البوتاسيوم', 'Potassium hydroxide', '1310-58-3', 'KOH', '1–5 M', NULL, 'water', 'مائي', 'محلول مائي عديم اللون', 'base', 'عالية (كاوي ومسبب للحروق)', 'نفايات قاعدية غير عضوية', 'unverified', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":2,"row":7}', '2026-11-27T00:00:00.000Z');
INSERT INTO chemical_price_versions (id, chemical_id, kind, value, currency, package_quantity, unit, source_json, status, created_at)
VALUES ('reference-potassium-hydroxide-combined', 'reference-potassium-hydroxide', 'combined', 6, 'JOD', 1, 'L', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":2,"row":7,"column":"د/لتر","suppliedValue":"6"}', 'unverified', '2026-11-27T00:00:00.000Z');
INSERT INTO carbon_factor_versions (id, chemical_id, value, unit, source_json, status, created_at)
VALUES ('reference-potassium-hydroxide-carbon', 'reference-potassium-hydroxide', 0.08, 'L', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":2,"row":7,"column":"كغم/لتر","suppliedValue":"0.08"}', 'unverified', '2026-11-27T00:00:00.000Z');

INSERT INTO chemical_references (id, name_ar, name_en, cas, formula, concentration, purity, solvent, formulation, physical_state, category, hazard_evidence, waste_category, status, provenance_json, updated_at)
VALUES ('reference-ammonia-solution', 'محلول الأمونيا', 'Ammonia solution', '1336-21-6', 'NH4OH', '25–30%', NULL, 'water', 'مائي', 'سائل شفاف برائحة نفّاذة', 'base', 'متوسطة (مهيّج للتنفس والعيون)', 'قواعد غير عضوية', 'unverified', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":2,"row":8}', '2026-11-27T00:00:00.000Z');
INSERT INTO chemical_price_versions (id, chemical_id, kind, value, currency, package_quantity, unit, source_json, status, created_at)
VALUES ('reference-ammonia-solution-combined', 'reference-ammonia-solution', 'combined', 6, 'JOD', 1, 'L', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":2,"row":8,"column":"د/لتر","suppliedValue":"6"}', 'unverified', '2026-11-27T00:00:00.000Z');
INSERT INTO carbon_factor_versions (id, chemical_id, value, unit, source_json, status, created_at)
VALUES ('reference-ammonia-solution-carbon', 'reference-ammonia-solution', 0.15, 'L', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":2,"row":8,"column":"كغم/لتر","suppliedValue":"0.15"}', 'unverified', '2026-11-27T00:00:00.000Z');

INSERT INTO chemical_references (id, name_ar, name_en, cas, formula, concentration, purity, solvent, formulation, physical_state, category, hazard_evidence, waste_category, status, provenance_json, updated_at)
VALUES ('reference-ethanol', 'الإيثانول', 'Ethanol', '64-17-5', 'C2H5OH', '96–99.8%', NULL, NULL, NULL, 'سائل متطاير شفاف', 'nonhalogenated-solvent', 'متوسطة (سريع الاشتعال)', 'مذيبات عضوية غير مهلجنة', 'unverified', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":2,"row":9}', '2026-11-27T00:00:00.000Z');
INSERT INTO chemical_price_versions (id, chemical_id, kind, value, currency, package_quantity, unit, source_json, status, created_at)
VALUES ('reference-ethanol-combined', 'reference-ethanol', 'combined', 12, 'JOD', 1, 'L', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":2,"row":9,"column":"د/لتر","suppliedValue":"12"}', 'unverified', '2026-11-27T00:00:00.000Z');
INSERT INTO carbon_factor_versions (id, chemical_id, value, unit, source_json, status, created_at)
VALUES ('reference-ethanol-carbon', 'reference-ethanol', 0.45, 'L', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":2,"row":9,"column":"كغم/لتر","suppliedValue":"0.45"}', 'unverified', '2026-11-27T00:00:00.000Z');

INSERT INTO chemical_references (id, name_ar, name_en, cas, formula, concentration, purity, solvent, formulation, physical_state, category, hazard_evidence, waste_category, status, provenance_json, updated_at)
VALUES ('reference-methanol', 'الميثانول', 'Methanol', '67-56-1', 'CH3OH', '99.8%', NULL, NULL, 'HPLC/Lab', 'سائل شفاف متطاير', 'nonhalogenated-solvent', 'عالية (سام ومشتعل جداً)', 'مذيبات عضوية غير مهلجنة', 'unverified', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":2,"row":10}', '2026-11-27T00:00:00.000Z');
INSERT INTO chemical_price_versions (id, chemical_id, kind, value, currency, package_quantity, unit, source_json, status, created_at)
VALUES ('reference-methanol-combined', 'reference-methanol', 'combined', 14, 'JOD', 1, 'L', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":2,"row":10,"column":"د/لتر","suppliedValue":"14"}', 'unverified', '2026-11-27T00:00:00.000Z');
INSERT INTO carbon_factor_versions (id, chemical_id, value, unit, source_json, status, created_at)
VALUES ('reference-methanol-carbon', 'reference-methanol', 0.55, 'L', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":2,"row":10,"column":"كغم/لتر","suppliedValue":"0.55"}', 'unverified', '2026-11-27T00:00:00.000Z');

INSERT INTO chemical_references (id, name_ar, name_en, cas, formula, concentration, purity, solvent, formulation, physical_state, category, hazard_evidence, waste_category, status, provenance_json, updated_at)
VALUES ('reference-acetone', 'الأسيتون', 'Acetone', '67-64-1', 'C3H6O', '99.5%', NULL, NULL, NULL, 'سائل شفاف سريع التبخر', 'nonhalogenated-solvent', 'متوسطة (شديد الاشتعال ومهيّج)', 'مذيبات عضوية غير مهلجنة', 'unverified', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":3,"row":11}', '2026-11-27T00:00:00.000Z');
INSERT INTO chemical_price_versions (id, chemical_id, kind, value, currency, package_quantity, unit, source_json, status, created_at)
VALUES ('reference-acetone-combined', 'reference-acetone', 'combined', 15, 'JOD', 1, 'L', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":3,"row":11,"column":"د/لتر","suppliedValue":"15"}', 'unverified', '2026-11-27T00:00:00.000Z');
INSERT INTO carbon_factor_versions (id, chemical_id, value, unit, source_json, status, created_at)
VALUES ('reference-acetone-carbon', 'reference-acetone', 0.60, 'L', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":3,"row":11,"column":"كغم/لتر","suppliedValue":"0.60"}', 'unverified', '2026-11-27T00:00:00.000Z');

INSERT INTO chemical_references (id, name_ar, name_en, cas, formula, concentration, purity, solvent, formulation, physical_state, category, hazard_evidence, waste_category, status, provenance_json, updated_at)
VALUES ('reference-isopropanol', 'الإيزوبروبانول', 'Isopropanol', '67-63-0', 'C3H8O', '70–99.9%', NULL, NULL, NULL, 'سائل شفاف', 'nonhalogenated-solvent', 'متوسطة (قابل للاشتعال)', 'مذيبات غير مهلجنة', 'unverified', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":3,"row":12}', '2026-11-27T00:00:00.000Z');
INSERT INTO chemical_price_versions (id, chemical_id, kind, value, currency, package_quantity, unit, source_json, status, created_at)
VALUES ('reference-isopropanol-combined', 'reference-isopropanol', 'combined', 14, 'JOD', 1, 'L', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":3,"row":12,"column":"د/لتر","suppliedValue":"14"}', 'unverified', '2026-11-27T00:00:00.000Z');
INSERT INTO carbon_factor_versions (id, chemical_id, value, unit, source_json, status, created_at)
VALUES ('reference-isopropanol-carbon', 'reference-isopropanol', 0.50, 'L', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":3,"row":12,"column":"كغم/لتر","suppliedValue":"0.50"}', 'unverified', '2026-11-27T00:00:00.000Z');

INSERT INTO chemical_references (id, name_ar, name_en, cas, formula, concentration, purity, solvent, formulation, physical_state, category, hazard_evidence, waste_category, status, provenance_json, updated_at)
VALUES ('reference-hexane', 'الهكسان', 'Hexane', '110-54-3', 'C6H14', '95–99%', NULL, NULL, NULL, 'سائل هيدروكربوني شفاف', 'nonhalogenated-solvent', 'عالية (مشتعل وسام للأعصاب)', 'مذيبات غير مهلجنة', 'unverified', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":3,"row":13}', '2026-11-27T00:00:00.000Z');
INSERT INTO chemical_price_versions (id, chemical_id, kind, value, currency, package_quantity, unit, source_json, status, created_at)
VALUES ('reference-hexane-combined', 'reference-hexane', 'combined', 18, 'JOD', 1, 'L', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":3,"row":13,"column":"د/لتر","suppliedValue":"18"}', 'unverified', '2026-11-27T00:00:00.000Z');
INSERT INTO carbon_factor_versions (id, chemical_id, value, unit, source_json, status, created_at)
VALUES ('reference-hexane-carbon', 'reference-hexane', 0.70, 'L', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":3,"row":13,"column":"كغم/لتر","suppliedValue":"0.70"}', 'unverified', '2026-11-27T00:00:00.000Z');

INSERT INTO chemical_references (id, name_ar, name_en, cas, formula, concentration, purity, solvent, formulation, physical_state, category, hazard_evidence, waste_category, status, provenance_json, updated_at)
VALUES ('reference-diethyl-ether', 'ثنائي إيثيل الإيثر', 'Diethyl ether', '60-29-7', '(C2H5)2O', '99%', NULL, NULL, 'لا مائي', 'سائل شديد التطاير', 'nonhalogenated-solvent', 'عالية جداً (خطر اشتعال وانفجار)', 'مذيبات غير مهلجنة', 'unverified', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":3,"row":14}', '2026-11-27T00:00:00.000Z');
INSERT INTO chemical_price_versions (id, chemical_id, kind, value, currency, package_quantity, unit, source_json, status, created_at)
VALUES ('reference-diethyl-ether-combined', 'reference-diethyl-ether', 'combined', 22, 'JOD', 1, 'L', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":3,"row":14,"column":"د/لتر","suppliedValue":"22"}', 'unverified', '2026-11-27T00:00:00.000Z');
INSERT INTO carbon_factor_versions (id, chemical_id, value, unit, source_json, status, created_at)
VALUES ('reference-diethyl-ether-carbon', 'reference-diethyl-ether', 0.75, 'L', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":3,"row":14,"column":"كغم/لتر","suppliedValue":"0.75"}', 'unverified', '2026-11-27T00:00:00.000Z');

INSERT INTO chemical_references (id, name_ar, name_en, cas, formula, concentration, purity, solvent, formulation, physical_state, category, hazard_evidence, waste_category, status, provenance_json, updated_at)
VALUES ('reference-chloroform', 'الكلوروفورم', 'Chloroform', '67-66-3', 'CHCl3', '99.8%', NULL, NULL, NULL, 'سائل ثقيل شفاف', 'halogenated-solvent', 'عالية (سام ومسرطن محتمل)', 'مذيبات عضوية مهلجنة', 'unverified', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":3,"row":15}', '2026-11-27T00:00:00.000Z');
INSERT INTO chemical_price_versions (id, chemical_id, kind, value, currency, package_quantity, unit, source_json, status, created_at)
VALUES ('reference-chloroform-combined', 'reference-chloroform', 'combined', 25, 'JOD', 1, 'L', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":3,"row":15,"column":"د/لتر","suppliedValue":"25"}', 'unverified', '2026-11-27T00:00:00.000Z');
INSERT INTO carbon_factor_versions (id, chemical_id, value, unit, source_json, status, created_at)
VALUES ('reference-chloroform-carbon', 'reference-chloroform', 0.90, 'L', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":3,"row":15,"column":"كغم/لتر","suppliedValue":"0.90"}', 'unverified', '2026-11-27T00:00:00.000Z');

INSERT INTO chemical_references (id, name_ar, name_en, cas, formula, concentration, purity, solvent, formulation, physical_state, category, hazard_evidence, waste_category, status, provenance_json, updated_at)
VALUES ('reference-dichloromethane', 'ثنائي كلورو ميثان', 'Dichloromethane', '75-09-2', 'CH2Cl2', '99.8%', NULL, NULL, NULL, 'سائل متطاير شفاف', 'halogenated-solvent', 'عالية (سام ومتطاير وخطر صحي)', 'نفايات عضوية مهلجنة', 'unverified', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":3,"row":16}', '2026-11-27T00:00:00.000Z');
INSERT INTO chemical_price_versions (id, chemical_id, kind, value, currency, package_quantity, unit, source_json, status, created_at)
VALUES ('reference-dichloromethane-combined', 'reference-dichloromethane', 'combined', 24, 'JOD', 1, 'L', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":3,"row":16,"column":"د/لتر","suppliedValue":"24"}', 'unverified', '2026-11-27T00:00:00.000Z');
INSERT INTO carbon_factor_versions (id, chemical_id, value, unit, source_json, status, created_at)
VALUES ('reference-dichloromethane-carbon', 'reference-dichloromethane', 0.85, 'L', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":3,"row":16,"column":"كغم/لتر","suppliedValue":"0.85"}', 'unverified', '2026-11-27T00:00:00.000Z');

INSERT INTO chemical_references (id, name_ar, name_en, cas, formula, concentration, purity, solvent, formulation, physical_state, category, hazard_evidence, waste_category, status, provenance_json, updated_at)
VALUES ('reference-hydrogen-peroxide', 'بيروكسيد الهيدروجين', 'Hydrogen peroxide', '7722-84-1', 'H2O2', '30%', NULL, 'water', 'مائي', 'سائل مائي شفاف', 'oxidizer', 'عالية (مؤكسد قوي ومسبب للحروق)', 'مؤكسدات منفصلة', 'unverified', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":3,"row":17}', '2026-11-27T00:00:00.000Z');
INSERT INTO chemical_price_versions (id, chemical_id, kind, value, currency, package_quantity, unit, source_json, status, created_at)
VALUES ('reference-hydrogen-peroxide-combined', 'reference-hydrogen-peroxide', 'combined', 12, 'JOD', 1, 'L', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":3,"row":17,"column":"د/لتر","suppliedValue":"12"}', 'unverified', '2026-11-27T00:00:00.000Z');
INSERT INTO carbon_factor_versions (id, chemical_id, value, unit, source_json, status, created_at)
VALUES ('reference-hydrogen-peroxide-carbon', 'reference-hydrogen-peroxide', 0.25, 'L', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":3,"row":17,"column":"كغم/لتر","suppliedValue":"0.25"}', 'unverified', '2026-11-27T00:00:00.000Z');

INSERT INTO chemical_references (id, name_ar, name_en, cas, formula, concentration, purity, solvent, formulation, physical_state, category, hazard_evidence, waste_category, status, provenance_json, updated_at)
VALUES ('reference-potassium-permanganate', 'برمنغنات البوتاسيوم', 'Potassium permanganate', '7722-64-7', 'KMnO4', '0.02–0.1 M', NULL, 'water', 'مائي', 'محلول أرجواني داكن', 'oxidizer', 'متوسطة (مؤكسد وضار بالبيئة)', 'مؤكسدات أو أملاح معادن', 'unverified', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":3,"row":18}', '2026-11-27T00:00:00.000Z');
INSERT INTO chemical_price_versions (id, chemical_id, kind, value, currency, package_quantity, unit, source_json, status, created_at)
VALUES ('reference-potassium-permanganate-combined', 'reference-potassium-permanganate', 'combined', 16, 'JOD', 1, 'L', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":3,"row":18,"column":"د/لتر","suppliedValue":"16"}', 'unverified', '2026-11-27T00:00:00.000Z');
INSERT INTO carbon_factor_versions (id, chemical_id, value, unit, source_json, status, created_at)
VALUES ('reference-potassium-permanganate-carbon', 'reference-potassium-permanganate', 0.35, 'L', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":3,"row":18,"column":"كغم/لتر","suppliedValue":"0.35"}', 'unverified', '2026-11-27T00:00:00.000Z');

INSERT INTO chemical_references (id, name_ar, name_en, cas, formula, concentration, purity, solvent, formulation, physical_state, category, hazard_evidence, waste_category, status, provenance_json, updated_at)
VALUES ('reference-sodium-hypochlorite', 'هيبوكلوريت الصوديوم', 'Sodium hypochlorite', '7681-52-9', 'NaClO', '5–12% كلور نشط', NULL, NULL, NULL, 'سائل أصفر باهت', 'oxidizer', 'متوسطة (مؤكسد ومهيّج وآكّال)', 'مؤكسدات منفصلة', 'unverified', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":4,"row":19}', '2026-11-27T00:00:00.000Z');
INSERT INTO chemical_price_versions (id, chemical_id, kind, value, currency, package_quantity, unit, source_json, status, created_at)
VALUES ('reference-sodium-hypochlorite-combined', 'reference-sodium-hypochlorite', 'combined', 7, 'JOD', 1, 'L', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":4,"row":19,"column":"د/لتر","suppliedValue":"7"}', 'unverified', '2026-11-27T00:00:00.000Z');
INSERT INTO carbon_factor_versions (id, chemical_id, value, unit, source_json, status, created_at)
VALUES ('reference-sodium-hypochlorite-carbon', 'reference-sodium-hypochlorite', 0.30, 'L', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":4,"row":19,"column":"كغم/لتر","suppliedValue":"0.30"}', 'unverified', '2026-11-27T00:00:00.000Z');

INSERT INTO chemical_references (id, name_ar, name_en, cas, formula, concentration, purity, solvent, formulation, physical_state, category, hazard_evidence, waste_category, status, provenance_json, updated_at)
VALUES ('reference-silver-nitrate', 'نترات الفضة', 'Silver nitrate', '7761-88-8', 'AgNO3', '0.1 M', NULL, 'water', 'مائي', 'محلول شفاف حساس للضوء', 'metal-salt', 'عالية (مؤكسد وسام للبيئة المائية)', 'نفايات معادن ثقيلة (الفضة)', 'unverified', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":4,"row":20}', '2026-11-27T00:00:00.000Z');
INSERT INTO chemical_price_versions (id, chemical_id, kind, value, currency, package_quantity, unit, source_json, status, created_at)
VALUES ('reference-silver-nitrate-combined', 'reference-silver-nitrate', 'combined', 45, 'JOD', 1, 'L', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":4,"row":20,"column":"د/لتر","suppliedValue":"45"}', 'unverified', '2026-11-27T00:00:00.000Z');
INSERT INTO carbon_factor_versions (id, chemical_id, value, unit, source_json, status, created_at)
VALUES ('reference-silver-nitrate-carbon', 'reference-silver-nitrate', 1.50, 'L', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":4,"row":20,"column":"كغم/لتر","suppliedValue":"1.50"}', 'unverified', '2026-11-27T00:00:00.000Z');

INSERT INTO chemical_references (id, name_ar, name_en, cas, formula, concentration, purity, solvent, formulation, physical_state, category, hazard_evidence, waste_category, status, provenance_json, updated_at)
VALUES ('reference-copper-sulfate', 'كبريتات النحاس', 'Copper sulfate', '7758-98-7', 'CuSO4', '0.1–0.5 M', NULL, 'water', 'مائي', 'محلول أزرق شفاف', 'metal-salt', 'متوسطة (سام للأحياء المائية ومهيّج)', 'نفايات معادن ثقيلة', 'unverified', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":4,"row":21}', '2026-11-27T00:00:00.000Z');
INSERT INTO chemical_price_versions (id, chemical_id, kind, value, currency, package_quantity, unit, source_json, status, created_at)
VALUES ('reference-copper-sulfate-combined', 'reference-copper-sulfate', 'combined', 20, 'JOD', 1, 'L', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":4,"row":21,"column":"د/لتر","suppliedValue":"20"}', 'unverified', '2026-11-27T00:00:00.000Z');
INSERT INTO carbon_factor_versions (id, chemical_id, value, unit, source_json, status, created_at)
VALUES ('reference-copper-sulfate-carbon', 'reference-copper-sulfate', 0.80, 'L', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":4,"row":21,"column":"كغم/لتر","suppliedValue":"0.80"}', 'unverified', '2026-11-27T00:00:00.000Z');

INSERT INTO chemical_references (id, name_ar, name_en, cas, formula, concentration, purity, solvent, formulation, physical_state, category, hazard_evidence, waste_category, status, provenance_json, updated_at)
VALUES ('reference-potassium-dichromate', 'ثنائي كرومات البوتاسيوم', 'Potassium dichromate', '7778-50-9', 'K2Cr2O7', '0.05–0.25 M', NULL, 'water', 'مائي', 'محلول برتقالي محمر', 'metal-salt', 'عالية جداً (مسرطن ومؤكسد وسمّي)', 'نفايات كروم ومعادن ثقيلة', 'unverified', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":4,"row":22}', '2026-11-27T00:00:00.000Z');
INSERT INTO chemical_price_versions (id, chemical_id, kind, value, currency, package_quantity, unit, source_json, status, created_at)
VALUES ('reference-potassium-dichromate-combined', 'reference-potassium-dichromate', 'combined', 40, 'JOD', 1, 'L', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":4,"row":22,"column":"د/لتر","suppliedValue":"40"}', 'unverified', '2026-11-27T00:00:00.000Z');
INSERT INTO carbon_factor_versions (id, chemical_id, value, unit, source_json, status, created_at)
VALUES ('reference-potassium-dichromate-carbon', 'reference-potassium-dichromate', 1.80, 'L', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":4,"row":22,"column":"كغم/لتر","suppliedValue":"1.80"}', 'unverified', '2026-11-27T00:00:00.000Z');

INSERT INTO chemical_references (id, name_ar, name_en, cas, formula, concentration, purity, solvent, formulation, physical_state, category, hazard_evidence, waste_category, status, provenance_json, updated_at)
VALUES ('reference-ferric-chloride', 'كلوريد الحديديك', 'Ferric chloride', '7705-08-0', 'FeCl3', '0.1–1 M', NULL, 'water', 'مائي', 'محلول بني مصفر', 'metal-salt', 'منخفضة (آكّال خفيف ومهيّج)', 'أملاح معدنية غير عضوية', 'unverified', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":4,"row":23}', '2026-11-27T00:00:00.000Z');
INSERT INTO chemical_price_versions (id, chemical_id, kind, value, currency, package_quantity, unit, source_json, status, created_at)
VALUES ('reference-ferric-chloride-combined', 'reference-ferric-chloride', 'combined', 10, 'JOD', 1, 'L', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":4,"row":23,"column":"د/لتر","suppliedValue":"10"}', 'unverified', '2026-11-27T00:00:00.000Z');
INSERT INTO carbon_factor_versions (id, chemical_id, value, unit, source_json, status, created_at)
VALUES ('reference-ferric-chloride-carbon', 'reference-ferric-chloride', 0.30, 'L', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":4,"row":23,"column":"كغم/لتر","suppliedValue":"0.30"}', 'unverified', '2026-11-27T00:00:00.000Z');

INSERT INTO chemical_references (id, name_ar, name_en, cas, formula, concentration, purity, solvent, formulation, physical_state, category, hazard_evidence, waste_category, status, provenance_json, updated_at)
VALUES ('reference-lead-nitrate', 'نترات الرصاص', 'Lead nitrate', '10099-74-8', 'Pb(NO3)2', '0.1–0.5 M', NULL, 'water', 'مائي', 'محلول مائي شفاف', 'metal-salt', 'عالية جداً (شديد السمية وخطر إنجابي)', 'نفايات رصاص ومعادن ثقيلة', 'unverified', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":4,"row":24}', '2026-11-27T00:00:00.000Z');
INSERT INTO chemical_price_versions (id, chemical_id, kind, value, currency, package_quantity, unit, source_json, status, created_at)
VALUES ('reference-lead-nitrate-combined', 'reference-lead-nitrate', 'combined', 38, 'JOD', 1, 'L', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":4,"row":24,"column":"د/لتر","suppliedValue":"38"}', 'unverified', '2026-11-27T00:00:00.000Z');
INSERT INTO carbon_factor_versions (id, chemical_id, value, unit, source_json, status, created_at)
VALUES ('reference-lead-nitrate-carbon', 'reference-lead-nitrate', 1.70, 'L', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":4,"row":24,"column":"كغم/لتر","suppliedValue":"1.70"}', 'unverified', '2026-11-27T00:00:00.000Z');

INSERT INTO chemical_references (id, name_ar, name_en, cas, formula, concentration, purity, solvent, formulation, physical_state, category, hazard_evidence, waste_category, status, provenance_json, updated_at)
VALUES ('reference-formaldehyde', 'الفورمالديهايد', 'Formaldehyde', '50-00-0', 'CH2O', '37%', NULL, 'water', 'فورمالين', 'سائل شفاف برائحة حادة', 'organic', 'عالية (سام ومسرطن ومهيّج)', 'نفايات عضوية سامة خاصة', 'unverified', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":4,"row":25}', '2026-11-27T00:00:00.000Z');
INSERT INTO chemical_price_versions (id, chemical_id, kind, value, currency, package_quantity, unit, source_json, status, created_at)
VALUES ('reference-formaldehyde-combined', 'reference-formaldehyde', 'combined', 20, 'JOD', 1, 'L', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":4,"row":25,"column":"د/لتر","suppliedValue":"20"}', 'unverified', '2026-11-27T00:00:00.000Z');
INSERT INTO carbon_factor_versions (id, chemical_id, value, unit, source_json, status, created_at)
VALUES ('reference-formaldehyde-carbon', 'reference-formaldehyde', 0.85, 'L', '{"document":"الدليل الشامل لقاعدة بيانات المحاليل والقياس بالأرقام - Artheris Lab.pdf","sha256":"bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce","section":4,"page":4,"row":25,"column":"كغم/لتر","suppliedValue":"0.85"}', 'unverified', '2026-11-27T00:00:00.000Z');
