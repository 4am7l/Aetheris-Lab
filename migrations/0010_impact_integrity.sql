-- Earlier snapshots retain their original values and can be re-reviewed explicitly.
ALTER TABLE impact_events ADD COLUMN integrity_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE impact_events ADD COLUMN evidence_keys TEXT CHECK (evidence_keys IS NULL OR json_valid(evidence_keys));
CREATE INDEX impact_affiliations_lab ON impact_affiliations(lab_id, request_id);
CREATE INDEX impact_departments_labs ON institution_labs(department_id, id);
ALTER TABLE chemical_density_versions ADD COLUMN measurement_temperature_c REAL CHECK (measurement_temperature_c >= -273.15);
ALTER TABLE chemical_density_versions ADD COLUMN measurement_state TEXT CHECK (measurement_state IN ('Liquid','Solid'));

CREATE TABLE impact_evidence_claims (
  scope_key TEXT NOT NULL,
  evidence_hash TEXT NOT NULL,
  request_id TEXT,
  PRIMARY KEY (scope_key, evidence_hash)
);
CREATE INDEX impact_claim_request ON impact_evidence_claims(request_id);
-- Evidence remains spent after cancellation or deletion. Purging a receipt removes its claim linkage.
CREATE TRIGGER impact_anonymize_claims AFTER DELETE ON public_requests
BEGIN UPDATE impact_evidence_claims SET request_id = NULL WHERE request_id = OLD.id; END;
CREATE TRIGGER impact_claim_evidence AFTER INSERT ON impact_events
WHEN NEW.integrity_version = 2 AND NEW.state IN ('verified','corrected') AND NEW.evidence_keys IS NOT NULL
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.evidence_keys) x JOIN impact_evidence_claims c ON c.evidence_hash = x.value
    WHERE c.scope_key = coalesce((SELECT institution_id FROM impact_affiliations WHERE request_id = NEW.request_id), '')
      AND c.request_id IS NOT NEW.request_id
  ) THEN RAISE(ABORT, 'Duplicate impact evidence') END;
  INSERT OR IGNORE INTO impact_evidence_claims(scope_key, evidence_hash, request_id)
  SELECT coalesce((SELECT institution_id FROM impact_affiliations WHERE request_id = NEW.request_id), ''), value, NEW.request_id
    FROM json_each(NEW.evidence_keys);
END;

CREATE TABLE inventory_impact_reconciliations (
  movement_id INTEGER NOT NULL REFERENCES inventory_movements(id),
  event_id INTEGER NOT NULL,
  delta REAL NOT NULL,
  adjustment_id INTEGER UNIQUE REFERENCES inventory_movements(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (movement_id, event_id)
);
CREATE TRIGGER inventory_reconciliation_no_delete BEFORE DELETE ON inventory_impact_reconciliations
BEGIN SELECT RAISE(ABORT, 'Inventory reconciliation is append-only'); END;
CREATE TRIGGER inventory_reconciliation_only_resolve BEFORE UPDATE ON inventory_impact_reconciliations
WHEN OLD.adjustment_id IS NOT NULL OR NEW.adjustment_id IS NULL OR OLD.movement_id <> NEW.movement_id
  OR OLD.event_id <> NEW.event_id OR OLD.delta <> NEW.delta OR OLD.created_at <> NEW.created_at
BEGIN SELECT RAISE(ABORT, 'Inventory reconciliation may only be resolved once'); END;

-- Apply a compensating movement with the existing stock trigger. If the
-- quantity has already been consumed, keep the reconciliation pending.
CREATE TRIGGER inventory_reconcile_stock AFTER INSERT ON inventory_impact_reconciliations
BEGIN
  INSERT INTO inventory_movements(item_id, key, input_digest, kind, delta, reason, actor, created_at)
  SELECT i.id, 'impact:' || NEW.movement_id || ':' || NEW.event_id, 'reviewed-impact',
    'adjustment', NEW.delta, 'Review of linked impact event ' || NEW.event_id, 'impact-ledger', NEW.created_at
  FROM inventory_movements m JOIN inventory_items i ON i.id = m.item_id
  WHERE m.id = NEW.movement_id AND i.quantity + NEW.delta >= 0;
  UPDATE inventory_impact_reconciliations
  SET adjustment_id = (
    SELECT id FROM inventory_movements WHERE key = 'impact:' || NEW.movement_id || ':' || NEW.event_id
      AND item_id = (SELECT item_id FROM inventory_movements WHERE id = NEW.movement_id)
  )
  WHERE movement_id = NEW.movement_id AND event_id = NEW.event_id AND EXISTS (
    SELECT 1 FROM inventory_movements WHERE key = 'impact:' || NEW.movement_id || ':' || NEW.event_id
      AND item_id = (SELECT item_id FROM inventory_movements WHERE id = NEW.movement_id)
  );
END;

CREATE TRIGGER inventory_impact_review AFTER INSERT ON impact_events
WHEN NEW.integrity_version = 2 AND NEW.state IN ('verified', 'corrected', 'cancelled')
BEGIN
  INSERT INTO inventory_impact_reconciliations(movement_id, event_id, delta, created_at)
  SELECT id, NEW.id, desired - posted, NEW.created_at FROM (
    SELECT m.id,
      m.delta + coalesce((SELECT sum(r.delta) FROM inventory_impact_reconciliations r
        WHERE r.movement_id = m.id AND r.adjustment_id IS NOT NULL), 0) AS posted,
      coalesce((SELECT (CASE m.kind WHEN 'returned' THEN 1 ELSE -1 END)
        * CAST(json_extract(x.value, '$.quantity.value') AS REAL)
        * CASE json_extract(x.value, '$.quantity.unit') WHEN 'uL' THEN 0.000001 WHEN 'mL' THEN 0.001 WHEN 'g' THEN 0.001 ELSE 1 END
        / CASE i.unit WHEN 'uL' THEN 0.000001 WHEN 'mL' THEN 0.001 WHEN 'g' THEN 0.001 ELSE 1 END
        FROM json_each(NEW.activities_json) x
        WHERE NEW.state <> 'cancelled' AND json_extract(x.value, '$.kind') = m.kind
          AND json_extract(x.value, '$.materialId') = i.chemical_id
          AND (json_extract(x.value, '$.quantity.unit') IN ('g','kg')) = (i.unit IN ('g','kg'))
          AND json_extract(x.value, '$.side') IN ('A','B')
          AND (m.impact_event_id IS NULL OR
            (SELECT json_extract(old.value, '$.side') FROM impact_events prior, json_each(prior.activities_json) old
              WHERE prior.id = m.impact_event_id AND json_extract(old.value,'$.kind') = m.kind)
            IS json_extract(x.value,'$.side'))
        LIMIT 1), 0) AS desired
    FROM inventory_movements m JOIN inventory_items i ON i.id = m.item_id
    WHERE m.request_id = NEW.request_id AND m.kind IN ('returned','recovery','disposal')
  ) WHERE abs(desired - posted) > max(abs(desired), abs(posted)) * 0.000000000000001;
END;
