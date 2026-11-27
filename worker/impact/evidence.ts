import type { D1Database } from "@cloudflare/workers-types";
import { z } from "zod";
import { httpsUrl, referenceId } from "../../src/impact/model";
import type { PairEvidence } from "../../src/impact/science";
import { error, json } from "../http";
import { audit, canReview, withinScope, type Scope } from "./access";
import { body, longText, shortText, timestamp } from "./io";
import { accessibleMaterial, resolveLab } from "./laboratory";

const pair = z.object({ a: referenceId, b: referenceId, context: z.enum(["mixing", "storage"]) });
const citation = z.strictObject({
  ...pair.shape, institutionId: referenceId.optional(), labId: referenceId.optional(),
  finding: z.enum(["incompatible", "conditional", "insufficient"]),
  statement: longText, conditions: longText, title: shortText, url: httpsUrl,
  qualified: z.literal(true),
});

async function evidenceScope(db: D1Database, url: URL, scope?: Scope) {
  const institution = url.searchParams.get("institution");
  const lab = url.searchParams.get("lab");
  if (!(institution || lab)) return { institutionId: scope?.institutionId ?? null, labId: scope?.labId ?? null };
  if (!scope || [institution, lab].some((id) => id && !referenceId.safeParse(id).success)) return null;
  if (lab) {
    const target = await resolveLab(db, scope, lab);
    return target && (!institution || institution === target.institutionId) ? target : null;
  }
  return withinScope(scope, institution, scope.labId) ? { institutionId: institution, labId: scope.labId } : null;
}

export async function pairEvidence(request: Request, db: D1Database, scope?: Scope) {
  if (request.method === "GET") {
    const url = new URL(request.url);
    const target = await evidenceScope(db, url, scope);
    if (!target) return error("NOT_FOUND", 404);
    if (url.searchParams.has("ids")) return matrix(db, url, target);
    const search = pair.safeParse(Object.fromEntries(url.searchParams));
    if (!search.success) return error("INVALID_REQUEST", 400);
    const [a, b] = [search.data.a, search.data.b].sort();
    const { institutionId: tenant, labId: lab } = target;
    const { results } = await db.prepare(`SELECT id, finding, statement, conditions, title, url, verified_at AS verifiedAt
      FROM scientific_pair_evidence WHERE chemical_a = ? AND chemical_b = ? AND context = ?
      AND (institution_id IS NULL OR (? IS NOT NULL AND institution_id = ? AND (lab_id IS NULL OR lab_id = ?)))
      ORDER BY verified_at DESC, id LIMIT 100`).bind(a, b, search.data.context, tenant, tenant, lab).all<PairEvidence>();
    const findings = new Set(results.map(({ finding }) => finding));
    const assessment = findings.has("incompatible") ? "incompatible"
      : findings.size === 1 && findings.has("conditional") ? "conditional" : "insufficient";
    return json({ assessment, requiresQualifiedReview: true, conflicting: findings.size > 1, evidence: results });
  }
  if (request.method !== "POST") return error("METHOD_NOT_ALLOWED", 405);
  if (!scope || !canReview(scope)) return error("FORBIDDEN", 403);
  const data = await body(request, citation);
  if (data instanceof Response) return data;
  const labId = data.labId ?? scope.labId;
  const laboratory = labId ? await resolveLab(db, scope, labId) : null;
  const institutionId = data.institutionId ?? scope.institutionId ?? laboratory?.institutionId ?? null;
  const target = { labId, institutionId };
  if (!withinScope(scope, institutionId, labId)) return error("FORBIDDEN", 403);
  if (institutionId && !await db.prepare("SELECT id FROM institutions WHERE id = ?").bind(institutionId).first()) return error("NOT_FOUND", 404);
  if (labId && (!institutionId || laboratory?.institutionId !== institutionId)) return error("NOT_FOUND", 404);
  const materials = await Promise.all([accessibleMaterial(db, data.a, target), accessibleMaterial(db, data.b, target)]);
  if (data.a === data.b || materials.some((item) => !item)) {
    return error("DISTINCT_MATERIALS_REQUIRED", 422);
  }
  if (data.finding === "conditional" && materials.some((item) => item?.status !== "verified")) return error("PAIR_FORMULATION_REQUIRED", 422);
  const id = crypto.randomUUID();
  const [a, b] = [data.a, data.b].sort();
  await db.batch([
    db.prepare(`INSERT INTO scientific_pair_evidence (id, institution_id, lab_id, chemical_a, chemical_b, context, finding,
      statement, conditions, title, url, verified_by, verified_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, institutionId, labId, a, b, data.context, data.finding, data.statement, data.conditions, data.title, data.url,
        scope.actor, timestamp()),
    audit(db, scope, "scientific-evidence-added", id, institutionId, labId),
  ]);
  return json({ id, institutionId, labId }, 201);
}

async function matrix(db: D1Database, url: URL, { institutionId, labId }: { institutionId: string | null; labId: string | null }) {
  const ids = [...new Set((url.searchParams.get("ids") ?? "").split(","))].sort();
  const context = url.searchParams.get("context");
  if (ids.length < 2 || ids.length > 8 || ids.some((id) => !referenceId.safeParse(id).success) ||
      (context !== "mixing" && context !== "storage")) return error("INVALID_REQUEST", 400);
  const slot = ids.map(() => "?").join(",");
  const { results } = await db.prepare(`SELECT chemical_a AS a, chemical_b AS b,
    sum(CASE WHEN finding = 'incompatible' THEN 1 ELSE 0 END) AS incompatibilities,
    sum(CASE WHEN finding = 'conditional' THEN 1 ELSE 0 END) AS conditions,
    sum(CASE WHEN finding = 'insufficient' THEN 1 ELSE 0 END) AS insufficient
    FROM scientific_pair_evidence WHERE chemical_a IN (${slot}) AND chemical_b IN (${slot}) AND context = ?
      AND (institution_id IS NULL OR (institution_id = ? AND (lab_id IS NULL OR lab_id = ?)))
    GROUP BY chemical_a, chemical_b`).bind(...ids, ...ids, context, institutionId, labId)
    .all<{ a: string; b: string; incompatibilities: number; conditions: number; insufficient: number }>();
  return json({ pairs: results.map((row) => ({ a: row.a, b: row.b, assessment: row.incompatibilities ? "incompatible" :
    row.conditions && !row.insufficient ? "conditional" : "insufficient" })) });
}
