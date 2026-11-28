import type { D1Database } from "@cloudflare/workers-types";
import { z } from "zod";
import type { AssessmentImpact, ImpactBucket, ImpactLog, ImpactOverview, ImpactTotals } from "../../src/impact/contracts";
import { activityKinds, currencyPrecision, impactStates, referenceId } from "../../src/impact/model";
import { publicRequestIdSchema, trackingTokenSchema } from "../../src/domain";
import { error, json } from "../http";
import type { Scope } from "./access";
import { digest } from "./access";
import { labLabel } from "../../src/impact/labels";
import { en, ar } from "../../src/i18n";
import { statusLabel } from "../../src/reviewText";
import { receiptStatisticsBatchSize } from "../../src/impact/contracts";
import { body } from "./io";
import { comparisonAmount, statisticalLedgerJoins, supportedEstimate, supportedOutcome } from "./statisticalLedger";

type Subject = { receipts: string } | { requestId: string } | Scope;
const filters = z.object({
  from: z.iso.date().optional(), to: z.iso.date().optional(), lab: referenceId.optional(),
  department: referenceId.optional(), university: referenceId.optional(), chemical: z.string().trim().max(120).optional(),
  q: z.string().trim().max(120).optional(), action: z.enum(activityKinds).optional(), status: z.enum(impactStates).optional(),
  period: z.enum(["month", "quarter", "year", "all"]).default("month"), currency: z.literal("JOD").default("JOD"),
  after: z.uuidv4().optional(), lang: z.enum(["en", "ar"]).default("en"),
}).refine(({ from, to }) => !from || !to || from <= to);
type Filters = z.infer<typeof filters>;

function dataset(subject: Subject, filter: Filters) {
  const args: (string | null)[] = [];
  const criteria: string[] = [];
  const add = (where: string, ...values: string[]) => { criteria.push(where); args.push(...values); };
  const personal = "receipts" in subject;
  if (personal) add(`r.id IN (SELECT t.request_id FROM json_each(?) proof
    JOIN public_request_tokens t ON t.request_id = json_extract(proof.value, '$.id')
      AND t.token_sha256 = json_extract(proof.value, '$.proof'))`, subject.receipts);
  else if ("requestId" in subject) add("r.id = ?", subject.requestId);
  else if (!subject.global) {
    add("a.institution_id = ?", subject.institutionId!);
    if (subject.labId) add("a.lab_id = ?", subject.labId);
  }
  if (filter.university) add("a.institution_id = ?", filter.university);
  if (filter.lab) add("a.lab_id = ?", filter.lab);
  if (filter.department) add("l.department_id = ?", filter.department);
  if (filter.from) add("r.created_at >= ?", filter.from);
  if (filter.to) add("r.created_at <= ?", filter.to + "T23:59:59.999Z");
  if (filter.status) add("e.state = ?", filter.status);
  if (filter.action) add("EXISTS (SELECT 1 FROM json_each(e.activities_json) WHERE json_extract(value, '$.kind') = ?)", filter.action);
  if (filter.chemical) add(`EXISTS (SELECT 1 FROM json_each(json_array(json_extract(r.input_json, '$.a'), json_extract(r.input_json, '$.b')))
    WHERE instr(lower(json_extract(value, '$.name')), ?) OR json_extract(value, '$.cas') = ?)`, filter.chemical.toLowerCase(), filter.chemical);
  if (filter.q) add(`(instr(lower(r.id||' '||json_extract(r.input_json, '$.a.name')||' '||json_extract(r.input_json, '$.b.name')), ?)
    OR instr(lower(coalesce(json_extract(v.approved_result_json, '$.incompatibilities'), '')), ?))`, filter.q.toLowerCase(), filter.q.toLowerCase());
  const period = { month: "substr(r.created_at, 1, 7)", year: "substr(r.created_at, 1, 4)", all: "'all'",
    quarter: "substr(r.created_at, 1, 4) || '-Q' || (1 + (CAST(substr(r.created_at, 6, 2) AS INTEGER)-1)/3)" }[filter.period];
  const base = `(
    SELECT r.id, r.created_at AS date, ${period} AS period,
      w.status, e.state, coalesce(${supportedOutcome}, 0) AS verifiedOutcome, e.activities_json AS activities,
      ${personal ? "NULL" : "a.lab_id"} AS labId, ${personal ? "NULL" : "l.name_" + filter.lang} AS labName,
      json_extract(r.input_json,'$.a.name') AS nameA, json_extract(r.input_json,'$.b.name') AS nameB,
      json_extract(r.input_json,'$.a.cas') AS casA, json_extract(r.input_json,'$.b.cas') AS casB,
      json_extract(r.input_json,'$.a.classifications') AS classA, json_extract(r.input_json,'$.b.classifications') AS classB,
      CASE WHEN json_extract(r.input_json, '$.a.quantityUnit') IN ('mL','L') AND json_extract(r.input_json,'$.a.quantity') NOT IN ('Unknown','')
       THEN CAST(json_extract(r.input_json,'$.a.quantity') AS REAL) * CASE WHEN json_extract(r.input_json,'$.a.quantityUnit')='mL' THEN 0.001 ELSE 1 END END AS litersA,
      CASE WHEN json_extract(r.input_json, '$.b.quantityUnit') IN ('mL','L') AND json_extract(r.input_json,'$.b.quantity') NOT IN ('Unknown','')
       THEN CAST(json_extract(r.input_json,'$.b.quantity') AS REAL) * CASE WHEN json_extract(r.input_json,'$.b.quantityUnit')='mL' THEN 0.001 ELSE 1 END END AS litersB,
      v.created_at AS completedAt, json_extract(v.approved_result_json, '$.incompatibilities') AS findings,
      json_extract(v.approved_result_json, '$.classification') AS classification,
      json_extract(v.approved_result_json, '$.sources') AS scientificReferences,
      CASE WHEN ${supportedEstimate} THEN json_extract(s.calculation_json, '$.result.references') END AS estimatedReferences,
      json_extract(e.calculation_json, '$.result.references') AS actualReferences,
      ${comparisonAmount("s", "net", true)} AS estimate,
      ${comparisonAmount("e", "net", true)} AS realized,
      ${comparisonAmount("e", "financial.purchase", true)} AS purchase,
      ${comparisonAmount("e", "financial.replacement", true)} AS replacement,
      ${comparisonAmount("e", "financial.disposal", true)} AS disposal,
      ${comparisonAmount("s", "wasteAvoided")} AS estimatedWaste,
      ${comparisonAmount("s", "wasteAvoidedKg")} AS estimatedWasteKg,
      ${comparisonAmount("e", "wasteAvoided")} AS waste,
      ${comparisonAmount("e", "wasteAvoidedKg")} AS wasteKg,
      ${comparisonAmount("s", "avoidedCo2e")} AS carbon,
      ${comparisonAmount("e", "avoidedCo2e")} AS verifiedCarbon
    FROM public_requests r JOIN public_request_workflow w ON w.request_id = r.id
    LEFT JOIN impact_affiliations a ON a.request_id = r.id LEFT JOIN institution_labs l ON l.id = a.lab_id
    LEFT JOIN public_review_decisions v ON v.request_id = r.id AND v.run_id = w.run_id AND w.status = 'Approved' AND v.decision = 'Approved'
    ${statisticalLedgerJoins}
    WHERE ${criteria.length ? criteria.join(" AND ") : "1"}
  )`;
  return { base, args };
}

const reviewed = "state IN ('verified','corrected')";
const verified = "verifiedOutcome = 1";
const activity = (kinds: string, mass = false) => `CASE WHEN ${verified} THEN (SELECT sum(
  CASE json_extract(x.value, '$.quantity.unit') ${mass ? "WHEN 'g' THEN 0.001 WHEN 'kg' THEN 1" : "WHEN 'uL' THEN 0.000001 WHEN 'mL' THEN 0.001 WHEN 'L' THEN 1"} END
  * json_extract(x.value,'$.quantity.value')) FROM json_each(activities) x WHERE json_extract(x.value,'$.kind') IN (${kinds})) END`;
const metrics = {
  estimatedFinancial: "estimate", verifiedFinancial: `CASE WHEN ${verified} THEN realized END`,
  estimatedAvoided: "estimatedWaste", estimatedAvoidedKg: "estimatedWasteKg",
  purchase: `CASE WHEN ${verified} THEN purchase END`, disposal: `CASE WHEN ${verified} THEN disposal END`,
  replacement: `CASE WHEN ${verified} THEN replacement END`,
  assessed: "CASE WHEN status = 'Approved' AND (litersA IS NOT NULL OR litersB IS NOT NULL) THEN coalesce(litersA,0)+coalesce(litersB,0) END",
  preserved: activity("'preserved','returned'"), preservedKg: activity("'preserved','returned'", true),
  avoided: `CASE WHEN ${verified} THEN waste END`, avoidedKg: `CASE WHEN ${verified} THEN wasteKg END`,
  segregated: activity("'segregation'"), segregatedKg: activity("'segregation'", true),
  recovery: activity("'recovery'"), recoveryKg: activity("'recovery'", true),
  authorizedDisposal: activity("'disposal'"), authorizedDisposalKg: activity("'disposal'", true),
  carbon: "carbon", verifiedCarbon: `CASE WHEN ${verified} THEN verifiedCarbon END`,
};
const moneyMetrics = new Set(["estimatedFinancial", "verifiedFinancial", "purchase", "replacement", "disposal"]);
const summation = (digits: number) => `count(*) AS assessments, count(CASE WHEN status = 'Approved' THEN 1 END) AS approved,
  count(CASE WHEN status IN ('Approved','Rejected') THEN 1 END) AS completed,
  count(CASE WHEN state IN ('pending-verification','verified','corrected','rejected','cancelled') THEN 1 END) AS reported,
  count(CASE WHEN ${verified} THEN 1 END) AS verified,
  count(CASE WHEN ${reviewed} AND NOT ${verified} THEN 1 END) AS needsRecheck,
  count(CASE WHEN ${verified} AND EXISTS (SELECT 1 FROM json_each(activities) WHERE json_extract(value,'$.kind') <> 'no-action') THEN 1 END) AS confirmedActions,
  count(CASE WHEN state = 'pending-verification' THEN 1 END) AS pending,
  count(CASE WHEN ${verified} AND EXISTS (SELECT 1 FROM json_each(activities) WHERE json_extract(value,'$.kind') = 'abandoned') THEN 1 END) AS prevention,
  count(CASE WHEN classification = 'Incompatible' OR json_array_length(findings) > 0 THEN 1 END) AS incompatibilities,
  ${Object.entries(metrics).map(([name, expr]) => {
    const sum = moneyMetrics.has(name) ? `round(sum(${expr}), ${digits})` : `sum(${expr})`;
    return `${sum} AS ${name}, count(${expr}) AS ${name}Covered`;
  }).join(", ")}`;
const summaryColumns = ["assessments", "approved", "completed", "reported", "verified", "needsRecheck", "confirmedActions",
  "pending", "prevention", "incompatibilities", ...Object.keys(metrics).flatMap((name) => [name, name + "Covered"])];

function aggregateJson(columns: readonly string[], sql: string) {
  const groups: string[] = [];
  // D1 allows 32 SQL arguments per function, or at most 16 key/value pairs per json_object call.
  for (let offset = 0; offset < columns.length; offset += 16) {
    const fields = columns.slice(offset, offset + 16).map((key) => `'${key}', "${key}"`).join(", ");
    groups.push(`json_object(${fields})`);
  }
  return `(SELECT json_group_array(json_array(${groups.join(", ")})) FROM (${sql}))`;
}

function totals(row: Record<string, number | null>): ImpactTotals {
  const values = { ...row };
  for (const name of Object.keys(metrics)) {
    delete values[name];
    delete values[name + "Covered"];
  }
  return {
    ...values,
    ...Object.fromEntries(Object.keys(metrics).map((name) => [name, { value: row[name], covered: row[name + "Covered"] }])),
  } as unknown as ImpactTotals;
}

type LogRow = Omit<ImpactLog, "names" | "actions" | "findings" | "reviewRequired"> & {
  nameA: string; nameB: string; activities: string | null; findings: string | null; reviewRequired: number;
};
function logRow(row: LogRow): ImpactLog {
  const { nameA, nameB, activities, findings, reviewRequired, ...rest } = row;
  return { ...rest, reviewRequired: Boolean(reviewRequired), names: [nameA, nameB], actions: activities ? (JSON.parse(activities) as { kind: ImpactLog["actions"][number] }[]).map((a) => a.kind) : [],
    findings: findings ? JSON.parse(findings) as string[] : [] };
}

function cell(value: string | number | null) {
  const text = String(value ?? "");
  // Prevent spreadsheet formula evaluation of submitted fields.
  return '"' + (typeof value !== "number" && /^(?:[\t\r\n]|[\s\p{Cf}]*[=+@\-＝＋＠－])/u.test(text) ? "'" : "") + text.replaceAll('"', '""') + '"';
}

function csv(rows: ImpactLog[], filter: Filters) {
  const header = filter.lang === "ar"
    ? ["العملية", "التاريخ", "المختبر", "التقييم", "التحقق", "الإجراءات", "المادة أ", "المادة ب", "تقدير " + filter.currency, "صافي موثّق " + filter.currency,
      "تقدير النفايات المتجنبة (لتر)", "تقدير النفايات المتجنبة (كغم)", "النفايات المتجنبة (لتر)", "النفايات المتجنبة (كغم)", "تقدير مكافئ ثاني أكسيد الكربون (كغم)", "تقدير مكافئ ثاني أكسيد الكربون لنشاط موثّق (كغم)", "حدود البيانات"]
    : ["Operation", "Date", "Laboratory", "Assessment", "Verification", "Actions", "Material A", "Material B", "Estimated " + filter.currency,
      "Documented net " + filter.currency, "Hypothetical waste avoided (L)", "Hypothetical waste avoided (kg)", "Waste avoided (L)", "Waste avoided (kg)", "Estimated avoided kg CO2e", "Estimated avoided kg CO2e from verified activity", "Data limitations"];
  const limitations = filter.lang === "ar" ? "الخانات الفارغة تعني أن القيم غير متاحة. الانبعاثات تقديرات نموذجية." :
    "Blank cells are unavailable values. Emissions are modeled estimates.";
  const lines = [header, ...rows.map((row) => [row.id, row.date, row.labName,
    (filter.lang === "ar" ? ar[statusLabel[row.status]] : undefined) ?? en[statusLabel[row.status]],
    row.reviewRequired ? (filter.lang === "ar" ? "يتطلب مراجعة جديدة" : "Requires re-review") : row.state ? labLabel(filter.lang, row.state) : null,
    row.actions.map((kind) => labLabel(filter.lang, kind)).join(" | "),
    ...row.names, row.estimate, row.realized, row.estimatedWaste, row.estimatedWasteKg, row.waste, row.wasteKg, row.carbon, row.verifiedCarbon, limitations])].map((row) => row.map(cell).join(","));
  return new Response("\uFEFF" + lines.join("\r\n") + "\r\n", { headers: {
    "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    "Content-Disposition": 'attachment; filename="aetheris-impact.csv"',
  } });
}

const log = `SELECT id, date, completedAt, status, state, verifiedOutcome, activities, nameA, nameB, labId, labName,
  estimate, estimatedWaste, estimatedWasteKg, carbon, findings, CASE WHEN ${reviewed} AND NOT ${verified} THEN 1 ELSE 0 END AS reviewRequired,
  realized, waste, wasteKg, verifiedCarbon FROM base`;

const receiptProofs = z.strictObject({
  receipts: z.array(z.strictObject({ id: publicRequestIdSchema, receipt: trackingTokenSchema })).min(1).max(receiptStatisticsBatchSize),
});

function toAssessment(row: LogRow): AssessmentImpact {
  const { id, date, completedAt, status, nameA, nameB, estimate, realized, estimatedWaste, estimatedWasteKg,
    waste, wasteKg, carbon, verifiedCarbon } = row;
  return { id, date, completedAt, status, names: [nameA, nameB], estimate, realized, estimatedWaste, estimatedWasteKg,
    waste, wasteKg, carbon, verifiedCarbon };
}

export async function singleAssessmentStatistics(db: D1Database, requestId: string) {
  const { base, args } = dataset({ requestId }, filters.parse({}));
  const row = await db.prepare(`WITH base AS ${base} ${log}`).bind(...args).first<LogRow>();
  return row ? toAssessment(row) : null;
}

export async function receiptStatistics(request: Request, db: D1Database) {
  const data = await body(request, receiptProofs);
  if (data instanceof Response) return data;
  const pairs = new Map(data.receipts.map(({ id, receipt }) => [id + ":" + receipt, { id, receipt }]));
  const proofs = await Promise.all([...pairs.values()].map(async ({ id, receipt }) => ({ id, proof: await digest(receipt) })));
  const { base, args } = dataset({ receipts: JSON.stringify(proofs) }, filters.parse({}));
  const rows = await db.prepare(`WITH base AS ${base} ${log} ORDER BY date DESC, id DESC`).bind(...args).all<LogRow>();
  return json({ assessments: rows.results.map(toAssessment) });
}

export async function analytics(db: D1Database, url: URL, subject: Scope, format: "json" | "csv") {
  const parsed = filters.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return error("INVALID_FILTER", 400);
  const filter = parsed.data;
  const { base, args } = dataset(subject, filter);
  const query = (sql: string, ...extra: string[]) => db.prepare(`WITH base AS ${base} ${sql}`).bind(...args, ...extra);
  const digits = currencyPrecision(filter.currency);
  const summary = summation(digits);
  if (format === "csv") {
    const rows = await query(log + " ORDER BY date DESC, id DESC LIMIT 1001").all<LogRow>();
    return rows.results.length > 1000 ? error("EXPORT_LIMIT", 422) : csv(rows.results.map(logRow), filter);
  }
  const cursor = filter.after ? " WHERE (date, id) < (SELECT date, id FROM base WHERE id = ?)" : "";
  const labels = ["label", "count"];
  // Materialize the authorized dataset once for the eight aggregate views. Keep the paginated history separate.
  const querySummary = `SELECT
    ${aggregateJson(summaryColumns, "SELECT " + summary + " FROM base")} AS aggregate,
    ${aggregateJson(["period", ...summaryColumns], "SELECT period, " + summary + " FROM base GROUP BY period ORDER BY period DESC LIMIT 120")} AS trend,
    ${aggregateJson(labels, `SELECT json_extract(x.value,'$.kind') AS label, count(*) AS count FROM base, json_each(activities) x WHERE ${verified} GROUP BY label ORDER BY count DESC, label`)} AS actions,
    ${aggregateJson([...labels, "liters"], `SELECT min(label) AS label, count(*) AS count, sum(liters) AS liters FROM (
      SELECT nameA AS label, casA AS cas, CASE WHEN status = 'Approved' THEN litersA END AS liters FROM base
      UNION ALL SELECT nameB, casB, CASE WHEN status = 'Approved' THEN litersB END FROM base
    ) WHERE label NOT IN ('', 'Unknown') GROUP BY CASE WHEN cas IS NULL OR cas = 'Unknown' THEN lower(label) ELSE cas END ORDER BY count DESC, label LIMIT 25`)} AS chemicals,
    ${aggregateJson(labels, `SELECT label, count(*) AS count FROM (
      SELECT value AS label FROM base, json_each(classA) UNION ALL SELECT value FROM base, json_each(classB)
    ) WHERE label <> 'Unknown' GROUP BY label ORDER BY count DESC, label LIMIT 25`)} AS categories,
    ${aggregateJson(labels, `SELECT value AS label, count(*) AS count FROM base, json_each(findings) GROUP BY label ORDER BY count DESC, label LIMIT 25`)} AS incompatibilities,
    ${aggregateJson([...labels, "value"], `SELECT labName AS label, count(*) AS count, round(sum(CASE WHEN ${verified} THEN realized END), ${digits}) AS value
      FROM base WHERE labId IS NOT NULL GROUP BY labId, labName ORDER BY count DESC, labName LIMIT 50`)} AS laboratories,
    ${aggregateJson(["title", "url"], `SELECT json_extract(item,'$.title') AS title, json_extract(item,'$.url') AS url FROM (
      SELECT x.value AS item FROM base, json_each(scientificReferences) x
      UNION ALL SELECT x.value FROM base, json_each(estimatedReferences) x
      UNION ALL SELECT x.value FROM base, json_each(actualReferences) x WHERE ${verified}
    ) GROUP BY title, url ORDER BY count(*) DESC, title LIMIT 30`)} AS sourceReferences`;
  const [overview, history] = await db.batch([
    db.prepare(`WITH base AS MATERIALIZED ${base} ${querySummary}`).bind(...args),
    query(log + cursor + " ORDER BY date DESC, id DESC LIMIT 51", ...(filter.after ? [filter.after] : [])),
  ]);
  const aggregates = overview.results[0] as Record<string, string>;
  const records = <T>(key: string): T[] => (JSON.parse(aggregates[key]) as Partial<T>[][])
    .map((parts) => Object.assign({}, ...parts) as T);
  const series = records<Record<string, number | null> & { period: string }>("trend").reverse().map((row): ImpactBucket =>
    ({ ...totals(row), period: row.period }));
  const logRecords = (history.results as unknown as LogRow[]).slice(0, 50).map(logRow);
  const output: ImpactOverview = {
    totals: totals(records<Record<string, number | null>>("aggregate")[0]),
    series, actions: records("actions"), chemicals: records("chemicals"),
    categories: records("categories"), incompatibilities: records("incompatibilities"),
    laboratories: records("laboratories"), references: records("sourceReferences"),
    log: logRecords, next: history.results.length > 50 ? logRecords.at(-1)?.id ?? null : null, currency: filter.currency,
  };
  return json(output);
}
