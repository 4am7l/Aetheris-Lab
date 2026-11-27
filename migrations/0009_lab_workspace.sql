CREATE TABLE inventory_items (
  id TEXT PRIMARY KEY NOT NULL,
  institution_id TEXT NOT NULL,
  lab_id TEXT NOT NULL,
  chemical_id TEXT NOT NULL REFERENCES chemical_references(id),
  container TEXT NOT NULL,
  batch TEXT,
  quantity REAL NOT NULL CHECK (quantity >= 0),
  unit TEXT NOT NULL CHECK (unit IN ('uL', 'mL', 'L', 'g', 'kg')),
  location TEXT NOT NULL,
  bought TEXT,
  review_by TEXT,
  price_id TEXT REFERENCES chemical_price_versions(id),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (institution_id, lab_id) REFERENCES institution_labs(institution_id, id),
  UNIQUE (lab_id, container)
);
CREATE INDEX inventory_scope ON inventory_items(institution_id, lab_id, id);
CREATE TABLE inventory_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL REFERENCES inventory_items(id),
  key TEXT NOT NULL,
  input_digest TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('received', 'consumed', 'adjustment', 'returned', 'preserved', 'recovery', 'disposal')),
  delta REAL NOT NULL,
  reason TEXT NOT NULL,
  request_id TEXT,
  impact_event_id INTEGER,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (item_id, key),
  UNIQUE (request_id, kind)
);
CREATE TRIGGER inventory_post_movement AFTER INSERT ON inventory_movements
BEGIN
  UPDATE inventory_items SET quantity = quantity + NEW.delta, updated_at = NEW.created_at WHERE id = NEW.item_id;
END;
CREATE TRIGGER inventory_movement_no_update BEFORE UPDATE ON inventory_movements
BEGIN SELECT RAISE(ABORT, 'Movement history is append-only'); END;
CREATE TRIGGER inventory_movement_no_delete BEFORE DELETE ON inventory_movements
BEGIN SELECT RAISE(ABORT, 'Movement history is append-only'); END;

CREATE TABLE sds_documents (
  id TEXT PRIMARY KEY NOT NULL,
  institution_id TEXT NOT NULL,
  lab_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  title TEXT NOT NULL,
  chemical_id TEXT REFERENCES chemical_references(id),
  revision_date TEXT,
  extracted_json TEXT NOT NULL CHECK (json_valid(extracted_json)),
  review_status TEXT NOT NULL CHECK (review_status IN ('submitted','verified','rejected')),
  created_by TEXT NOT NULL,
  reviewed_by TEXT,
  review_reason TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (lab_id, sha256),
  FOREIGN KEY (institution_id, lab_id) REFERENCES institution_labs(institution_id, id)
);
CREATE INDEX sds_scope ON sds_documents(institution_id, lab_id, id);

CREATE TABLE scientific_pair_evidence (
  id TEXT PRIMARY KEY NOT NULL,
  institution_id TEXT REFERENCES institutions(id),
  lab_id TEXT,
  chemical_a TEXT NOT NULL REFERENCES chemical_references(id),
  chemical_b TEXT NOT NULL REFERENCES chemical_references(id),
  context TEXT NOT NULL CHECK (context IN ('mixing', 'storage')),
  finding TEXT NOT NULL CHECK (finding IN ('incompatible', 'conditional', 'insufficient')),
  statement TEXT NOT NULL,
  conditions TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  verified_by TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  CHECK (chemical_a < chemical_b AND (lab_id IS NULL OR institution_id IS NOT NULL)),
  FOREIGN KEY (institution_id, lab_id) REFERENCES institution_labs(institution_id, id)
);
CREATE INDEX scientific_pair_lookup ON scientific_pair_evidence(chemical_a, chemical_b, context, institution_id, lab_id);
CREATE TRIGGER scientific_pair_no_update BEFORE UPDATE ON scientific_pair_evidence
BEGIN SELECT RAISE(ABORT, 'Scientific evidence is append-only'); END;
CREATE TRIGGER scientific_pair_no_delete BEFORE DELETE ON scientific_pair_evidence
BEGIN SELECT RAISE(ABORT, 'Scientific evidence is append-only'); END;

CREATE TABLE emergency_directory (
  id TEXT PRIMARY KEY NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id),
  lab_id TEXT,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  contact TEXT NOT NULL,
  procedure_url TEXT NOT NULL,
  sds_url TEXT,
  approved_by TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  FOREIGN KEY (institution_id, lab_id) REFERENCES institution_labs(institution_id, id)
);
