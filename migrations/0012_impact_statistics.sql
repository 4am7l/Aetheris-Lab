-- Support read-only statistics that check historical evidence across scopes.
CREATE INDEX impact_claim_hash_request ON impact_evidence_claims(evidence_hash, request_id);
