import type { D1Database } from "@cloudflare/workers-types";
import { z } from "zod";
import { solventName, unknown, type Solution } from "../../src/domain";
import type { FixedGuideEstimate, ImpactEvent } from "../../src/impact/contracts";
import { evidenceKey, liters, type Activity } from "../../src/impact/model";
import { error } from "../http";
import type { Scope } from "./access";
import { body, longText, timestamp } from "./io";
import { formulaKey, type Stocks } from "./quantities";

type Side = FixedGuideEstimate["side"];
const sides = ["A", "B"] as const;
type GuideRow = Omit<FixedGuideEstimate, "side" | "materialId" | "decisionId" | "status" | "assessedVolume" |
  "reviewedMatch" | "inputEstimate" | "actionEstimate" | "canReviewMatch"> & {
  id: string; price: number; factor: number; formula: string;
};
type GuideReview = { id: number; referenceId: string; side: Side; applicable: number };
type Context = { runId: string; institutionId: string | null; labId: string | null };
const reviewShape = z.strictObject({ side: z.enum(sides), expectedId: z.number().int().nonnegative(),
  applicable: z.boolean(), reason: longText });

const waterAliases = new Set(["water", "distilled water", "deionized water", "h2o", "ماء", "الماء", "ماء مقطر"]);
const nominalRange = /^(\d+(?:\.\d+)?)(?:\s*[–-]\s*(\d+(?:\.\d+)?))?\s*(%|M)/;
const molarityInParentheses = /\((\d+(?:\.\d+)?)\s*M\)/;

function includesValue(value: number, lower: string, upper?: string) {
  return Number.isFinite(value) && value >= Number(lower) && value <= Number(upper ?? lower);
}

function formulationMatch(solution: Solution, reference: GuideRow): "match" | "review" | "different" {
  if (solution.state === "Solid" || solution.state === "Gas") return "different";
  const submittedFormula = formulaKey(solution.formula);
  const guideFormula = formulaKey(reference.formula);
  const formulaMatches = submittedFormula === guideFormula;
  if (!formulaMatches && submittedFormula.startsWith("[") && guideFormula.startsWith("[")) return "different";
  const solvent = solventName(solution);
  const water = waterAliases.has(evidenceKey(solvent));
  if (reference.solvent === "water" && solvent !== unknown && !water) return "different";
  if (reference.formulation === "لا مائي" && water) return "different";
  const range = nominalRange.exec(reference.concentration);
  const parenthetical = molarityInParentheses.exec(reference.concentration);
  const strength = Number(solution.concentration);
  if (solution.unit === "mol/L" && Number.isFinite(strength)) {
    const molar = parenthetical ? [parenthetical[1], undefined] : range?.[3] === "M" ? [range[1], range[2]] : null;
    if (molar && !includesValue(strength, molar[0]!, molar[1])) return "different";
    if (molar && water && reference.solvent === "water" && solution.state === "Liquid" && formulaMatches) return "match";
  }
  // A percentage with an unspecified basis is not equivalent to declared w/w or v/v.
  // Active chlorine and labelled product grade also require review of the original documentation.
  if (range?.[3] === "%" && !reference.concentration.includes("كلور نشط")) {
    const percent = solution.unit.startsWith("%") ? strength : Number(solution.purity);
    if (Number.isFinite(percent) && !includesValue(percent, range[1], range[2])) return "different";
  }
  return "review";
}

function documentedVolume(activities: Activity[], side: Side) {
  const sameSide = activities.filter((a) => a.side === side && a.quantity);
  const retained = sameSide.filter(({ kind }) => ["preserved", "returned", "recovery"].includes(kind))
    .flatMap((a) => { const volume = liters(a.quantity!); return volume === null ? [] : [volume]; });
  const disposal = activities.some((a) => a.kind === "disposal" && (!a.side || a.side === side));
  const segregated = sameSide.find((a) => a.kind === "segregation");
  const segregatedVolume = !disposal && segregated?.quantity ? liters(segregated.quantity) : null;
  return retained.length || segregatedVolume !== null
    ? Math.max(retained.reduce((sum, volume) => sum + volume, 0), segregatedVolume ?? 0)
    : null;
}

export async function fixedGuideEstimates(db: D1Database, id: string, runId: string, stocks: Stocks, current?: ImpactEvent) {
  const [a, b] = sides.map((side) => stocks[side].input.cas);
  if (a === unknown && b === unknown) return [];
  const [source, decisions] = await db.batch([
    db.prepare("SELECT * FROM fixed_guide_reference WHERE cas IN (?, ?) ORDER BY rowNumber").bind(a, b),
    db.prepare(`SELECT id, reference_id AS referenceId, side, applicable FROM assessment_guide_reviews g
      WHERE request_id = ? AND run_id = ? AND id = (SELECT max(prior.id) FROM assessment_guide_reviews prior
        WHERE prior.request_id = g.request_id AND prior.run_id = g.run_id AND prior.side = g.side)`).bind(id, runId),
  ]);
  return sides.flatMap((side): FixedGuideEstimate[] => {
    const stock = stocks[side];
    const reference = (source.results as GuideRow[]).find(({ cas }) => cas === stock.input.cas);
    if (!reference) return [];
    const decision = (decisions.results as GuideReview[]).find((record) => record.side === side && record.referenceId === reference.id);
    const match = formulationMatch(stock.input, reference);
    const volume = stock.measure ? liters(stock.measure) : null;
    const assessedVolume = stock.input.state === "Liquid" ? volume : null;
    const applicable = match !== "different" && (decision ? Boolean(decision.applicable) : match === "match");
    const status = match === "different" || decision?.applicable === 0 ? "not-applicable"
      : assessedVolume === null ? "volume-unavailable" : applicable ? "applied" : "needs-review";
    const compute = (volume: number) => ({
      volume,
      combinedCost: Number((volume * reference.price).toPrecision(15)),
      co2e: Number((volume * reference.factor).toPrecision(15)),
    });
    const verified = current && !current.reviewRequired && ["verified", "corrected"].includes(current.state);
    const actionVolume = status === "applied" && verified ? documentedVolume(current.activities, side) : null;
    const eligibleAction = actionVolume !== null && assessedVolume !== null &&
      actionVolume <= assessedVolume * (1 + Number.EPSILON * 16);
    const { id: materialId, nameAr, nameEn, cas, concentration, formulation, solvent, sourcePrice, sourcePriceUnit, currency,
      sourceFactor, sourceFactorUnit, denominator, sourceHash, document, page, rowNumber } = reference;
    return [{ side, materialId, nameAr, nameEn, cas, concentration, formulation, solvent, sourcePrice, sourcePriceUnit, currency, sourceFactor,
      sourceFactorUnit, denominator, sourceHash, document, page, rowNumber, decisionId: decision?.id ?? 0,
      reviewedMatch: decision ? Boolean(decision.applicable) : null, status, assessedVolume,
      canReviewMatch: match !== "different" && assessedVolume !== null,
      inputEstimate: status === "applied" && assessedVolume !== null ? compute(assessedVolume) : null,
      actionEstimate: eligibleAction ? compute(actionVolume) : null }];
  });
}

export async function reviewGuideMatch(request: Request, db: D1Database, id: string, context: Context, stocks: Stocks, scope: Scope) {
  const input = await body(request, reviewShape, 4096);
  if (input instanceof Response) return input;
  const candidate = (await fixedGuideEstimates(db, id, context.runId, stocks)).find(({ side }) => side === input.side);
  if (!candidate?.canReviewMatch) return error("GUIDE_MATCH_UNAVAILABLE", 422);
  if (candidate.decisionId !== input.expectedId) return error("STALE_IMPACT", 409);
  if (candidate.reviewedMatch === input.applicable) return null;
  const membership = scope.global ? null : scope.actor;
  const inserted = await db.prepare(`INSERT INTO assessment_guide_reviews
    (request_id, run_id, side, reference_id, applicable, reason, actor, created_at)
    SELECT w.request_id, w.run_id, ?, ?, ?, ?, ?, ? FROM public_request_workflow w
    LEFT JOIN impact_affiliations a ON a.request_id = w.request_id
    WHERE w.request_id = ? AND w.run_id = ? AND w.status = 'Approved' AND w.archived_at IS NULL
      AND a.institution_id IS ? AND a.lab_id IS ?
      AND (? IS NULL OR EXISTS (SELECT 1 FROM institution_memberships m WHERE m.id = ?
        AND m.revoked_at IS NULL AND m.accepted_at IS NOT NULL AND m.role = 'reviewer'
        AND m.institution_id = a.institution_id AND (m.lab_id IS NULL OR m.lab_id = a.lab_id)))
      AND coalesce((SELECT max(g.id) FROM assessment_guide_reviews g
        WHERE g.request_id = w.request_id AND g.run_id = w.run_id AND g.side = ?), 0) = ?
    RETURNING id`).bind(input.side, candidate.materialId, Number(input.applicable), input.reason, scope.actor, timestamp(),
      id, context.runId, context.institutionId, context.labId, membership, membership, input.side, input.expectedId).first();
  return inserted ? null : error("STALE_IMPACT", 409);
}
