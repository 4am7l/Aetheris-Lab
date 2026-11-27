import type { D1Database } from "@cloudflare/workers-types";
import { z } from "zod";
import type { ImpactBucket, ImpactLog, ImpactOverview, ImpactTotals } from "../../src/impact/contracts";
import { activityKinds, currencyCode, impactStates, referenceId } from "../../src/impact/model";
import { error, json } from "../http";
import type { Scope } from "./access";
import { labLabel } from "../../src/impact/labels";
import { en, ar } from "../../src/i18n";
import { statusLabel } from "../../src/reviewText";

type Subject = { profileId: string } | Scope;
const filters = z.object({
  from: z.iso.date().optional(), to: z.iso.date().optional(), lab: referenceId.optional(),
  department: referenceId.optional(), university: referenceId.optional(), chemical: z.string().trim().max(120).optional(),
  q: z.string().trim().max(120).optional(), action: z.enum(activityKinds).optional(), status: z.enum(impactStates).optional(),
  period: z.enum(["month", "quarter", "year", "all"]).default("month"), currency: currencyCode.default("JOD"),
  after: z.uuidv4().optional(), lang: z.enum(["en", "ar"]).default("en"),
}).refine(({ from, to }) => !from || !to || from <= to);
type Filters = z.infer<typeof filters>;

function dataset(subject: Subject, filter: Filters) {
  const args: (string | null)[] = [];
  const criteria: string[] = [];
  const add = (where: string, ...values: string[]) => { criteria.push(where); args.push(...values); };
  const personal = "profileId" in subject;
  if (personal) add("p.profile_id = ?", subject.profileId);
  else if (!subject.global) {
    add("a.institution_id = ?", subject.institutionId!);
    if (subject.labId) add("a.lab_id = ?", subject.labId);
  }
  if (filter.university) add("a.institution_id = ?", filter.university);
  if (filter.lab) add("a.lab_id = ?", filter.lab);
  if (filter.department) add("l.department_id = ?", filter.department);
  if (filter.from) add("substr(r.created_at, 1, 10) >= ?", filter.from);
  if (filter.to) add("substr(r.created_at, 1, 10) <= ?", filter.to);
  if (filter.status) add("e.state = ?", filter.status);
  if (filter.action) add("EXISTS (SELECT 1 FROM json_each(e.activities_json) WHERE json_extract(value, '$.kind') = ?)", filter.action);
  if (filter.chemical) add(`EXISTS (SELECT 1 FROM json_each(json_array(json_extract(r.input_json, '$.a'), json_extract(r.input_json, '$.b')))
    WHERE instr(lower(json_extract(value, '$.name')), ?) OR json_extract(value, '$.cas') = ?)`, filter.chemical.toLowerCase(), filter.chemical);
  if (filter.q) add(`(instr(lower(r.id||' '||json_extract(r.input_json, '$.a.name')||' '||json_extract(r.input_json, '$.b.name')), ?)
    OR instr(lower(coalesce(json_extract(v.approved_result_json, '$.incompatibilities'), '')), ?))`, filter.q.toLowerCase(), filter.q.toLowerCase());
  const beneficiary = personal ? "personal" : "institution";
  const amount = (snapshot: string, metric: string, money = false) => money
    ? `CASE WHEN json_extract(${snapshot}, '$.result.currency') = '${filter.currency}' AND
          json_extract(${snapshot}, '$.result.beneficiary') = '${beneficiary}' THEN json_extract(${snapshot}, '$.result.${metric}.difference') END`
    : `json_extract(${snapshot}, '$.result.${metric}.difference')`;
  const period = { month: "substr(r.created_at, 1, 7)", year: "substr(r.created_at, 1, 4)", all: "'all'",
    quarter: "substr(r.created_at, 1, 4) || '-Q' || (1 + (CAST(substr(r.created_at, 6, 2) AS INTEGER)-1)/3)" }[filter.period];
  const cte = `WITH base AS (
    SELECT r.id, r.created_at AS date, substr(r.created_at, 1, 10) AS day, ${period} AS period,
      w.status, e.state, e.activities_json AS activities, a.lab_id AS labId, l.name_${filter.lang} AS labName,
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
      json_extract(s.calculation_json, '$.result.references') AS estimatedReferences,
      json_extract(e.calculation_json, '$.result.references') AS actualReferences,
      ${amount("s.calculation_json", "net", true)} AS estimate,
      ${amount("e.calculation_json", "net", true)} AS realized,
      coalesce(${amount("e.calculation_json", "financial.purchase", true)}, ${amount("e.calculation_json", "financial.replacement", true)}) AS purchase,
      ${amount("e.calculation_json", "financial.disposal", true)} AS disposal,
      ${amount("e.calculation_json", "wasteAvoided")} AS waste,
      ${amount("e.calculation_json", "wasteAvoidedKg")} AS wasteKg,
      ${amount("s.calculation_json", "avoidedCo2e")} AS carbon,
      ${amount("e.calculation_json", "avoidedCo2e")} AS verifiedCarbon
    FROM public_requests r JOIN public_request_workflow w ON w.request_id = r.id
    ${personal ? "JOIN impact_profile_requests p ON p.request_id = r.id" : ""}
    LEFT JOIN impact_affiliations a ON a.request_id = r.id LEFT JOIN institution_labs l ON l.id = a.lab_id
    LEFT JOIN public_review_decisions v ON v.request_id = r.id AND v.run_id = w.run_id AND w.status = 'Approved' AND v.decision = 'Approved'
    LEFT JOIN impact_events e ON w.status = 'Approved' AND e.id = (SELECT id FROM impact_events WHERE request_id = r.id ORDER BY id DESC LIMIT 1)
    LEFT JOIN impact_events s ON w.status = 'Approved' AND s.id = (SELECT id FROM impact_events WHERE request_id = r.id AND state = 'estimated' ORDER BY id DESC LIMIT 1)
    WHERE ${criteria.length ? criteria.join(" AND ") : "1"}
  )`;
  return { cte, args };
}

const verified = "state IN ('verified','corrected')";
const activity = (kinds: string, mass = false) => `CASE WHEN ${verified} THEN (SELECT sum(
  CASE json_extract(x.value, '$.quantity.unit') ${mass ? "WHEN 'g' THEN 0.001 WHEN 'kg' THEN 1" : "WHEN 'uL' THEN 0.000001 WHEN 'mL' THEN 0.001 WHEN 'L' THEN 1"} END
  * json_extract(x.value,'$.quantity.value')) FROM json_each(activities) x WHERE json_extract(x.value,'$.kind') IN (${kinds})) END`;
const metrics = {
  estimatedFinancial: "estimate", verifiedFinancial: `CASE WHEN ${verified} THEN realized END`,
  purchase: `CASE WHEN ${verified} THEN purchase END`, disposal: `CASE WHEN ${verified} THEN disposal END`,
  assessed: "CASE WHEN status = 'Approved' AND (litersA IS NOT NULL OR litersB IS NOT NULL) THEN coalesce(litersA,0)+coalesce(litersB,0) END",
  preserved: activity("'preserved','returned'"), preservedKg: activity("'preserved','returned'", true),
  avoided: `CASE WHEN ${verified} THEN waste END`, avoidedKg: `CASE WHEN ${verified} THEN wasteKg END`,
  segregated: activity("'segregation'"), segregatedKg: activity("'segregation'", true),
  recovery: activity("'recovery'"), recoveryKg: activity("'recovery'", true),
  authorizedDisposal: activity("'disposal'"), authorizedDisposalKg: activity("'disposal'", true),
  carbon: "carbon", verifiedCarbon: `CASE WHEN ${verified} THEN verifiedCarbon END`,
};
const summation = `count(*) AS assessments, count(CASE WHEN status = 'Approved' THEN 1 END) AS approved,
  count(CASE WHEN status IN ('Approved','Rejected') THEN 1 END) AS completed,
  count(CASE WHEN state IN ('pending-verification','verified','corrected','rejected','cancelled') THEN 1 END) AS reported,
  count(CASE WHEN ${verified} THEN 1 END) AS verified,
  count(CASE WHEN state = 'pending-verification' THEN 1 END) AS pending,
  count(CASE WHEN ${verified} AND EXISTS (SELECT 1 FROM json_each(activities) WHERE json_extract(value,'$.kind') = 'abandoned') THEN 1 END) AS prevention,
  count(CASE WHEN classification = 'Incompatible' OR json_array_length(findings) > 0 THEN 1 END) AS incompatibilities,
  ${Object.entries(metrics).map(([name, expr]) => `sum(${expr}) AS ${name}, count(${expr}) AS ${name}Covered`).join(", ")}`;

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

type LogRow = Omit<ImpactLog, "names" | "actions" | "findings"> & { nameA: string; nameB: string; activities: string | null; findings: string | null };
function logRow(row: LogRow): ImpactLog {
  const { nameA, nameB, activities, findings, ...rest } = row;
  return { ...rest, names: [nameA, nameB], actions: activities ? (JSON.parse(activities) as { kind: ImpactLog["actions"][number] }[]).map((a) => a.kind) : [],
    findings: findings ? JSON.parse(findings) as string[] : [] };
}

function cell(value: string | number | null) {
  const text = String(value ?? "");
  // Prevent spreadsheet formula evaluation of submitted fields.
  return '"' + (typeof value !== "number" && /^[\s]*[=+@\-\t\r]/.test(text) ? "'" : "") + text.replaceAll('"', '""') + '"';
}

function csv(rows: ImpactLog[], filter: Filters) {
  const header = filter.lang === "ar"
    ? ["العملية", "التاريخ", "المختبر", "التقييم", "التحقق", "الإجراءات", "المادة أ", "المادة ب", "تقدير " + filter.currency, "محقق " + filter.currency, "النفايات المتجنبة (لتر)", "كغم مكافئ ثاني أكسيد الكربون"]
    : ["Operation", "Date", "Laboratory", "Assessment", "Verification", "Actions", "Material A", "Material B", "Estimated " + filter.currency, "Documented " + filter.currency, "Waste avoided (L)", "Estimated avoided kg CO2e"];
  const lines = [header, ...rows.map((row) => [row.id, row.date, row.labName,
    (filter.lang === "ar" ? ar[statusLabel[row.status]] : undefined) ?? en[statusLabel[row.status]],
    row.state ? labLabel(filter.lang, row.state) : null, row.actions.map((kind) => labLabel(filter.lang, kind)).join(" | "),
    ...row.names, row.estimate, row.realized, row.waste, row.carbon])].map((row) => row.map(cell).join(","));
  return new Response("\uFEFF" + lines.join("\r\n") + "\r\n", { headers: {
    "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    "Content-Disposition": 'attachment; filename="aetheris-impact.csv"',
  } });
}

export async function analytics(db: D1Database, url: URL, subject: Subject, format: "json" | "csv") {
  const parsed = filters.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return error("INVALID_FILTER", 400);
  const filter = parsed.data;
  const { cte, args } = dataset(subject, filter);
  const query = (sql: string, ...extra: string[]) => db.prepare(cte + " " + sql).bind(...args, ...extra);
  const log = "SELECT id, date, completedAt, status, state, activities, nameA, nameB, labId, labName, estimate, realized, waste, carbon, findings FROM base";
  if (format === "csv") {
    const rows = await query(log + " ORDER BY date DESC, id DESC LIMIT 1001").all<LogRow>();
    return rows.results.length > 1000 ? error("EXPORT_LIMIT", 422) : csv(rows.results.map(logRow), filter);
  }
  const cursor = filter.after ? " WHERE (date, id) < (SELECT created_at, id FROM public_requests WHERE id = ?)" : "";
  const [aggregate, trend, actions, chemicals, categories, incompatibilities, laboratories, references, history] = await db.batch([
    query("SELECT " + summation + " FROM base"),
    query("SELECT period, " + summation + " FROM base GROUP BY period ORDER BY period DESC LIMIT 120"),
    query(`SELECT json_extract(x.value,'$.kind') AS label, count(*) AS count FROM base, json_each(activities) x WHERE ${verified} GROUP BY label ORDER BY count DESC, label`),
    query(`SELECT min(label) AS label, count(*) AS count, sum(liters) AS liters FROM (
      SELECT nameA AS label, casA AS cas, CASE WHEN status = 'Approved' THEN litersA END AS liters FROM base
      UNION ALL SELECT nameB, casB, CASE WHEN status = 'Approved' THEN litersB END FROM base
    ) WHERE label NOT IN ('', 'Unknown') GROUP BY CASE WHEN cas IS NULL OR cas = 'Unknown' THEN lower(label) ELSE cas END ORDER BY count DESC, label LIMIT 25`),
    query(`SELECT label, count(*) AS count FROM (
      SELECT value AS label FROM base, json_each(classA) UNION ALL SELECT value FROM base, json_each(classB)
    ) WHERE label <> 'Unknown' GROUP BY label ORDER BY count DESC, label LIMIT 25`),
    query(`SELECT value AS label, count(*) AS count FROM base, json_each(findings) GROUP BY label ORDER BY count DESC, label LIMIT 25`),
    query(`SELECT labName AS label, count(*) AS count, sum(CASE WHEN ${verified} THEN realized END) AS value
      FROM base WHERE labId IS NOT NULL GROUP BY labId, labName ORDER BY count DESC, labName LIMIT 50`),
    query(`SELECT json_extract(item,'$.title') AS title, json_extract(item,'$.url') AS url FROM (
      SELECT x.value AS item FROM base, json_each(scientificReferences) x
      UNION ALL SELECT x.value FROM base, json_each(estimatedReferences) x
      UNION ALL SELECT x.value FROM base, json_each(actualReferences) x WHERE ${verified}
    ) GROUP BY title, url ORDER BY count(*) DESC, title LIMIT 30`),
    query(log + cursor + " ORDER BY date DESC, id DESC LIMIT 51", ...(filter.after ? [filter.after] : [])),
  ]);
  const series = (trend.results as (Record<string, number | null> & { period: string })[]).reverse().map((row): ImpactBucket =>
    ({ ...totals(row), period: row.period }));
  const logRecords = (history.results as unknown as LogRow[]).slice(0, 50).map(logRow);
  const output: ImpactOverview = {
    totals: totals(aggregate.results[0] as Record<string, number | null>),
    series, actions: actions.results as ImpactOverview["actions"],
    chemicals: chemicals.results as ImpactOverview["chemicals"],
    categories: categories.results as ImpactOverview["categories"],
    incompatibilities: incompatibilities.results as ImpactOverview["incompatibilities"],
    laboratories: laboratories.results as ImpactOverview["laboratories"], references: references.results as ImpactOverview["references"],
    log: logRecords, next: history.results.length > 50 ? logRecords.at(-1)?.id ?? null : null, currency: filter.currency,
  };
  return json(output);
}
