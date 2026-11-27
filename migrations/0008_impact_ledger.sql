CREATE TABLE impact_profiles (
  id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE TABLE impact_profile_requests (
  request_id TEXT PRIMARY KEY NOT NULL REFERENCES public_requests(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES impact_profiles(id),
  linked_at TEXT NOT NULL
);
CREATE INDEX impact_profile_history ON impact_profile_requests(profile_id, linked_at DESC, request_id);

CREATE TABLE institution_memberships (
  id TEXT PRIMARY KEY NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id),
  lab_id TEXT,
  role TEXT NOT NULL CHECK (role IN ('institution-admin', 'reviewer', 'lab-manager', 'viewer')),
  token_hash TEXT UNIQUE,
  invitation_hash TEXT NOT NULL UNIQUE,
  invite_expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  accepted_at TEXT,
  revoked_at TEXT,
  CHECK (role <> 'institution-admin' OR lab_id IS NULL),
  FOREIGN KEY (institution_id, lab_id) REFERENCES institution_labs(institution_id, id)
);
CREATE INDEX institution_memberships_scope ON institution_memberships(institution_id, lab_id, id);
CREATE TABLE impact_affiliations (
  request_id TEXT PRIMARY KEY NOT NULL REFERENCES public_requests(id) ON DELETE CASCADE,
  institution_id TEXT NOT NULL,
  lab_id TEXT NOT NULL,
  attached_at TEXT NOT NULL,
  FOREIGN KEY (institution_id, lab_id) REFERENCES institution_labs(institution_id, id)
);
CREATE INDEX impact_affiliations_scope ON impact_affiliations(institution_id, lab_id, request_id);

CREATE TABLE impact_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL REFERENCES public_requests(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('estimated', 'action-reported', 'pending-verification', 'verified', 'rejected', 'corrected', 'cancelled')),
  key TEXT,
  input_digest TEXT,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL,
  activities_json TEXT CHECK (activities_json IS NULL OR json_valid(activities_json)),
  calculation_json TEXT CHECK (calculation_json IS NULL OR json_valid(calculation_json)),
  reason TEXT,
  corrects_id INTEGER,
  UNIQUE (request_id, key)
);
CREATE INDEX impact_events_history ON impact_events(request_id, id DESC);
CREATE INDEX impact_events_estimates ON impact_events(request_id, id DESC) WHERE state = 'estimated';
CREATE TRIGGER impact_events_no_update BEFORE UPDATE ON impact_events
BEGIN SELECT RAISE(ABORT, 'Impact events are append-only'); END;
CREATE TRIGGER impact_events_no_delete BEFORE DELETE ON impact_events
WHEN NOT EXISTS (
  SELECT 1 FROM public_request_management_events WHERE action = 'delete' AND request_id = OLD.request_id
)
BEGIN SELECT RAISE(ABORT, 'Impact events are append-only'); END;
CREATE TRIGGER impact_queue_action AFTER INSERT ON impact_events
WHEN NEW.state = 'action-reported'
BEGIN
  INSERT INTO impact_events(request_id, state, actor, created_at, activities_json)
  VALUES (NEW.request_id, 'pending-verification', NEW.actor, NEW.created_at, NEW.activities_json);
END;

CREATE TABLE sustainability_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  institution_id TEXT,
  lab_id TEXT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX sustainability_audit_scope ON sustainability_audit(institution_id, lab_id, id DESC);
CREATE TRIGGER sustainability_audit_no_update BEFORE UPDATE ON sustainability_audit
BEGIN SELECT RAISE(ABORT, 'Audit is append-only'); END;
CREATE TRIGGER sustainability_audit_no_delete BEFORE DELETE ON sustainability_audit
BEGIN SELECT RAISE(ABORT, 'Audit is append-only'); END;
