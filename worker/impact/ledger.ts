import type { D1Database } from "@cloudflare/workers-types";
import { z } from "zod";
import { publicRequestIdSchema, publicResultSchema, type PublicResult } from "../../src/domain";
import type { ImpactEvent, OperationImpact } from "../../src/impact/contracts";
import { activityList, calculateImpact, evidenceKey, eventKey, scenarioSchema,
  type Activity, type ImpactCalculation, type ImpactState, type Scenario } from "../../src/impact/model";
import { error, json } from "../http";
import { bearer, canReview, digest, withinScope, type Scope } from "./access";
import { calculationReferences } from "./catalog";
import { body, longText, timestamp } from "./io";
import { activityFormulations, assessedStocks, assessedTotals, preservationTotals, validateActivities, validateScenario, type Stocks } from "./quantities";

const change = { key: eventKey, expectedId: z.number().int().min(0) };
const reportSchema = z.strictObject({ ...change, activities: activityList });
const cancelSchema = z.strictObject({ ...change });
const estimateSchema = z.strictObject({ ...change, scenario: scenarioSchema });
const reviewSchema = z.strictObject({
  ...change, decision: z.enum(["verify", "clarify", "reject", "correct", "cancel"]),
  reason: longText,
  activities: activityList.optional(),
  scenario: scenarioSchema.optional(),
  realizedEvidence: longText.optional(),
  evidenceReference: z.string().trim().min(3).max(240).optional(),
}).refine(({ decision, activities, scenario, realizedEvidence, evidenceReference }) =>
  (decision === "verify" && !activities && (!scenario || Boolean(realizedEvidence))) ||
  (decision === "correct" && Boolean(activities) && (!scenario || Boolean(realizedEvidence))) ||
  (["clarify", "reject", "cancel"].includes(decision) && !activities && !scenario && !realizedEvidence && !evidenceReference));

interface ApprovedRow {
  runId: string; submittedAt: string; approvedAt: string; archivedAt: string | null; institutionId: string | null;
  labId: string | null; geography: string | null; input: string; result: string;
}
interface EventRow {
  id: number; state: ImpactState; createdAt: string; activitiesJson: string | null;
  calculationJson: string | null; reason: string | null; inputDigest: string | null;
  integrityVersion: number;
}
interface CalculationSnapshot {
  result: ImpactCalculation; input: Scenario; rates: unknown[]; realizedEvidence?: string;
}

function jsonValue<T>(value: string | null): T | null {
  return value === null ? null : JSON.parse(value) as T;
}

function asEvent(row: EventRow): ImpactEvent {
  return {
    id: row.id, state: row.state, createdAt: row.createdAt, reason: row.reason,
    activities: jsonValue<Activity[]>(row.activitiesJson) ?? [],
    calculation: jsonValue<CalculationSnapshot>(row.calculationJson)?.result ?? null,
    reviewRequired: row.integrityVersion !== 2 && ["estimated", "verified", "corrected"].includes(row.state),
  };
}

const fields = `id, state, created_at AS createdAt, activities_json AS activitiesJson,
  calculation_json AS calculationJson, reason, input_digest AS inputDigest, integrity_version AS integrityVersion`;

export async function receiptAuthorized(db: D1Database, id: string, credential: string | undefined) {
  if (!credential || !publicRequestIdSchema.safeParse(id).success) return false;
  return Boolean(await db.prepare("SELECT request_id FROM public_request_tokens WHERE request_id = ? AND token_sha256 = ?")
    .bind(id, await digest(credential)).first());
}

async function approved(db: D1Database, id: string) {
  return db.prepare(`SELECT w.run_id AS runId, r.created_at AS submittedAt, v.created_at AS approvedAt, w.archived_at AS archivedAt,
    a.institution_id AS institutionId, a.lab_id AS labId, i.geography, r.input_json AS input, v.approved_result_json AS result
    FROM public_requests r JOIN public_request_workflow w ON w.request_id = r.id
    JOIN public_review_decisions v ON v.request_id = r.id AND v.run_id = w.run_id AND v.decision = 'Approved'
    LEFT JOIN impact_affiliations a ON a.request_id = r.id LEFT JOIN institutions i ON i.id = a.institution_id
    WHERE r.id = ? AND w.status = 'Approved'`).bind(id).first<ApprovedRow>();
}

async function currentEvent(db: D1Database, id: string) {
  return db.prepare(`SELECT ${fields} FROM impact_events WHERE request_id = ? ORDER BY id DESC LIMIT 1`).bind(id).first<EventRow>();
}

async function show(db: D1Database, id: string, row: ApprovedRow) {
  const [history, estimates, evidence] = await db.batch<EventRow & { identifiedSides: number }>([
    db.prepare(`SELECT ${fields} FROM impact_events WHERE request_id = ? ORDER BY id DESC LIMIT 100`).bind(id),
    db.prepare(`SELECT ${fields} FROM impact_events WHERE request_id = ? AND state = 'estimated' ORDER BY id DESC LIMIT 1`).bind(id),
    db.prepare("SELECT count(DISTINCT solution) AS identifiedSides FROM public_assessment_evidence WHERE run_id = ? AND kind = 'identity'")
      .bind(row.runId),
  ]);
  const result = publicResultSchema.parse(JSON.parse(row.result));
  const estimate = estimates.results[0] ? asEvent(estimates.results[0]).calculation : null;
  const events = history.results.map(asEvent);
  const covered = estimate ?? events[0]?.calculation;
  const operation: OperationImpact = {
    writable: !row.archivedAt,
    assessed: assessedTotals(assessedStocks(row.input)),
    evidence: {
      identifiedSides: evidence.results[0].identifiedSides,
      citedSources: result.sources.length,
      conditionsDocumented: Boolean(result.conditions.trim()),
      uncertaintyDocumented: Boolean(result.limitations.length),
      coveredFinancialCategories: covered ? Object.values(covered.financial).filter((x) => x.difference !== null).length : 0,
      coveredCarbonStages: covered ? Object.values(covered.emissions).filter((x) => x.difference !== null).length : 0,
    },
    findings: result.incompatibilities, classification: result.classification,
    reviewedWaste: result.wasteAssessment,
    estimate, estimateReviewRequired: Boolean(estimates.results[0] && estimates.results[0].integrityVersion !== 2),
    current: events[0] ?? null, events, sourceReferences: result.sources,
  };
  return json(operation);
}

export async function evaluateScenario(db: D1Database, input: Scenario, row: {
  institutionId: string | null; labId: string | null; geography: string | null;
}, date: string): Promise<CalculationSnapshot>;
export async function evaluateScenario(db: D1Database, input: Scenario, row: {
  institutionId: string | null; labId: string | null; geography: string | null;
}, date: string, context: { stocks: Stocks; activities?: Activity[] }): Promise<CalculationSnapshot | Response>;
export async function evaluateScenario(db: D1Database, input: Scenario, row: {
  institutionId: string | null; labId: string | null; geography: string | null;
}, date: string, context?: { stocks: Stocks; activities?: Activity[] }): Promise<CalculationSnapshot | Response> {
  const { refs, densities, snapshots } = await calculationReferences(db, input, row.institutionId, row.labId);
  const result = calculateImpact(input, { references: refs, densities, institutionId: row.institutionId,
    geography: row.geography, date: date.slice(0, 10) });
  const issue = context && validateScenario(context.stocks, input, refs, densities, result, context.activities);
  if (context?.activities) result.preserved = preservationTotals(context.activities);
  return issue ? error(issue, 422) : { input, result, rates: snapshots };
}

async function append(db: D1Database, id: string, row: ApprovedRow, data: { key: string; expectedId: number },
  inputDigest: string, event: { state: ImpactState; activities?: Activity[]; calculation?: CalculationSnapshot; reason?: string; actor: string;
    corrects?: number; evidenceHashes?: string[] }, scope?: Scope) {
  const membership = scope && !scope.global ? scope.actor : null;
  try {
    const inserted = await db.prepare(`
    INSERT INTO impact_events (request_id, state, key, input_digest, actor, created_at, activities_json, calculation_json,
      reason, corrects_id, integrity_version, evidence_keys)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 2, ? FROM public_request_workflow w
    LEFT JOIN impact_affiliations a ON a.request_id = w.request_id
    WHERE w.request_id = ? AND w.run_id = ? AND w.status = 'Approved' AND w.archived_at IS NULL
      AND a.institution_id IS ? AND a.lab_id IS ?
      AND (? IS NULL OR EXISTS (SELECT 1 FROM institution_memberships m WHERE m.id = ?
        AND m.revoked_at IS NULL AND m.accepted_at IS NOT NULL AND m.role = 'reviewer'
        AND m.institution_id = a.institution_id AND (m.lab_id IS NULL OR m.lab_id = a.lab_id)))
      AND coalesce((SELECT max(id) FROM impact_events WHERE request_id = w.request_id), 0) = ?
    ON CONFLICT (request_id, key) DO NOTHING RETURNING id`)
    .bind(id, event.state, data.key, inputDigest, event.actor, timestamp(),
      event.activities ? JSON.stringify(event.activities) : null, event.calculation ? JSON.stringify(event.calculation) : null,
      event.reason ?? null, event.corrects ?? null, event.evidenceHashes ? JSON.stringify(event.evidenceHashes) : null,
      id, row.runId, row.institutionId, row.labId, membership, membership, data.expectedId).first();
    if (inserted) return show(db, id, row);
  } catch (cause) {
    if (String(cause).includes("Duplicate impact evidence")) return error("DUPLICATE_IMPACT_EVIDENCE", 409);
    throw cause;
  }
  const replay = await db.prepare("SELECT input_digest AS digest FROM impact_events WHERE request_id = ? AND key = ?")
    .bind(id, data.key).first<{ digest: string }>();
  return replay?.digest === inputDigest ? show(db, id, row) : error("STALE_IMPACT", 409);
}

const reviewState = { verify: "verified", clarify: "pending-verification", reject: "rejected", correct: "corrected", cancel: "cancelled" } as const;

async function evidenceHashes(reference: string | undefined, scenario?: Scenario) {
  const documents = new Set(reference ? [evidenceKey(reference)] : []);
  for (const group of Object.values(scenario?.financial ?? {})) {
    for (const line of group.actual) if ("evidence" in line && line.amount > 0) documents.add(evidenceKey(line.evidence));
  }
  return documents.size ? Promise.all([...documents].sort().map((key) => digest("impact-proof:" + key))) : undefined;
}

export async function operationImpact(request: Request, db: D1Database, id: string, mode: "view" | "report" | "withdraw" | "estimate" | "review", scope?: Scope) {
  if (!publicRequestIdSchema.safeParse(id).success || (!scope && !await receiptAuthorized(db, id, bearer(request)))) return error("NOT_FOUND", 404);
  const row = await approved(db, id);
  if (!row || (scope && !withinScope(scope, row.institutionId, row.labId))) return error("NOT_FOUND", 404);
  if (mode === "view") return show(db, id, row);
  if (row.archivedAt) return error("ARCHIVED", 409);
  if ((mode === "estimate" || mode === "review") && (!scope || !canReview(scope))) return error("FORBIDDEN", 403);
  const data = mode === "report" ? await body(request, reportSchema)
    : mode === "withdraw" ? await body(request, cancelSchema)
    : mode === "estimate" ? await body(request, estimateSchema) : await body(request, reviewSchema);
  if (data instanceof Response) return data;
  const actor = scope?.actor ?? "requester";
  const inputDigest = await digest(JSON.stringify([mode, actor, data]));
  const replay = await db.prepare("SELECT input_digest AS digest FROM impact_events WHERE request_id = ? AND key = ?")
    .bind(id, data.key).first<{ digest: string }>();
  if (replay) return replay.digest === inputDigest ? show(db, id, row) : error("KEY_REUSED", 409);
  const current = await currentEvent(db, id);
  if ((current?.id ?? 0) !== data.expectedId) return error("STALE_IMPACT", 409);
  const stocks = assessedStocks(row.input);
  const today = timestamp().slice(0, 10);
  const dateInvalid = (date: string) => date < row.submittedAt.slice(0, 10) || date > today;
  if (mode === "review") {
    const review = data as z.infer<typeof reviewSchema>;
    if (!current) return error("STALE_IMPACT", 409);
    const allowed = current.state === "pending-verification" ||
      (["verified", "corrected"].includes(current.state) && ["correct", "cancel"].includes(review.decision));
    if (!allowed || (review.decision === "correct" && current.state === "pending-verification")) return error("STALE_IMPACT", 409);
    const previous = asEvent(current);
    const activities = review.activities ?? previous.activities;
    const result: PublicResult = publicResultSchema.parse(JSON.parse(row.result));
    if (["verify", "correct"].includes(review.decision)) {
      if (activities.some(({ date }) => dateInvalid(date))) return error("INVALID_ACTION_DATE", 422);
      if (activities.some(({ kind }) => kind !== "no-action") && !review.evidenceReference) return error("ACTION_EVIDENCE_REQUIRED", 422);
      const checked = activityList.safeParse(activities);
      if (!checked.success) return error("INVALID_ACTIVITY", 422);
      const issue = validateActivities(stocks, checked.data, await activityFormulations(db, checked.data, row));
      if (issue) return error(issue, 422);
    }
    if (["verify", "correct"].includes(review.decision) && activities.some(({ kind }) => kind === "abandoned") &&
        !result.incompatibilities.length && result.classification !== "Incompatible") {
      return error("REVIEWED_FINDING_REQUIRED", 422);
    }
    const eligible = activities.some(({ kind }) => !["no-action", "abandoned"].includes(kind));
    if (review.scenario && !eligible) return error("NO_ELIGIBLE_ACTION", 422);
    const materialPreserved = activities.some(({ kind }) => kind === "preserved" || kind === "returned");
    let calculation: CalculationSnapshot | undefined;
    if (review.scenario) {
      if (review.scenario.beneficiary === "institution" && !row.institutionId) return error("LAB_AFFILIATION_REQUIRED", 422);
      if (!materialPreserved && (review.scenario.wasteActual || review.scenario.wasteBaseline)) return error("WASTE_PREVENTION_EVIDENCE_REQUIRED", 422);
      const actionDate = activities.filter(({ kind }) => !["no-action", "abandoned"].includes(kind)).map(({ date }) => date).sort()[0];
      if (review.scenario.preserve) return error("REVIEW_PRESERVATION_FROM_ACTIONS", 422);
      const evaluated = await evaluateScenario(db, review.scenario, row, actionDate, { stocks, activities });
      if (evaluated instanceof Response) return evaluated;
      calculation = evaluated;
      calculation.realizedEvidence = review.realizedEvidence;
    }
    return append(db, id, row, data, inputDigest, {
      actor, state: reviewState[review.decision], activities, calculation, reason: review.reason,
      evidenceHashes: await evidenceHashes(review.evidenceReference, review.scenario),
      corrects: ["correct", "cancel"].includes(review.decision) ? current.id : undefined,
    }, scope);
  }
  if (mode === "estimate") {
    if (current && current.state !== "estimated") return error("STALE_IMPACT", 409);
    const { scenario } = data as z.infer<typeof estimateSchema>;
    if (scenario.beneficiary === "institution" && !row.institutionId) return error("LAB_AFFILIATION_REQUIRED", 422);
    const calculation = await evaluateScenario(db, scenario, row, row.approvedAt, { stocks });
    if (calculation instanceof Response) return calculation;
    return append(db, id, row, data, inputDigest, { actor, state: "estimated", calculation }, scope);
  }
  if (mode === "report") {
    const { activities } = data as z.infer<typeof reportSchema>;
    if (current && !["estimated", "rejected", "cancelled"].includes(current.state) &&
        !(current.state === "pending-verification" && current.reason)) return error("STALE_IMPACT", 409);
    if (activities.some(({ date }) => dateInvalid(date))) return error("INVALID_ACTION_DATE", 422);
    const issue = validateActivities(stocks, activities, await activityFormulations(db, activities, row));
    if (issue) return error(issue, 422);
    return append(db, id, row, data, inputDigest, { actor, state: "action-reported", activities });
  }
  if (current?.state !== "pending-verification") return error("STALE_IMPACT", 409);
  return append(db, id, row, data, inputDigest, { actor, state: "cancelled", activities: asEvent(current).activities, corrects: current.id });
}
