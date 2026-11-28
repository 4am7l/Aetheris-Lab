// The assessment approval anchors the ledger. A prior or inactive review cannot contribute.
export const statisticalLedgerJoins = `
  LEFT JOIN impact_events e ON e.id = (
    SELECT id FROM impact_events WHERE request_id = v.request_id AND created_at >= v.created_at ORDER BY id DESC LIMIT 1)
  LEFT JOIN impact_events s ON e.state NOT IN ('cancelled', 'rejected') AND s.id = (
    SELECT id FROM impact_events WHERE request_id = v.request_id AND state = 'estimated'
    AND created_at >= v.created_at ORDER BY id DESC LIMIT 1)`;

export const supportedEstimate = "s.integrity_version = 2";
export const supportedOutcome = `e.integrity_version = 2 AND e.state IN ('verified', 'corrected')
  AND json_array_length(e.evidence_keys) > 0
  AND NOT EXISTS (
    SELECT 1 FROM json_each(e.evidence_keys) proof
    WHERE NOT EXISTS (
      SELECT 1 FROM impact_evidence_claims claim WHERE claim.evidence_hash = proof.value AND claim.request_id = e.request_id
    ) OR EXISTS (
      SELECT 1 FROM impact_evidence_claims claim WHERE claim.evidence_hash = proof.value AND claim.request_id IS NOT e.request_id
    )
  )`;

export function comparisonAmount(event: "s" | "e", metric: string, money = false) {
  const path = `$.result.${metric}`;
  const value = (field: string) => `json_extract(${event}.calculation_json, '${path}.${field}')`;
  const validType = (field: string) => `json_type(${event}.calculation_json, '${path}.${field}') IN ('integer', 'real')`;
  return `CASE WHEN ${event === "s" ? supportedEstimate : supportedOutcome}
    ${event === "e" ? "AND length(trim(json_extract(e.calculation_json, '$.realizedEvidence'))) > 0" : ""}
    ${money ? `AND json_extract(${event}.calculation_json, '$.result.currency') = 'JOD'` : ""}
    AND ${validType("baseline")} AND ${validType("actual")} AND ${validType("difference")}
    AND ${value("baseline")} >= 0 AND ${value("actual")} >= 0
    AND abs(${value("difference")} - (${value("baseline")} - ${value("actual")}))
      <= max(abs(${value("baseline")}), abs(${value("actual")})) * 0.000000000001
    THEN ${value("difference")} END`;
}
