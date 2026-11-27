import { z } from "zod";
import type { D1Database } from "@cloudflare/workers-types";
import { validCas } from "../../src/domain";
import type { CatalogChemical } from "../../src/impact/contracts";
import { carbonStages, currencyCode, httpsUrl, quantityUnits, referenceId, type Reference, type Density, type Scenario } from "../../src/impact/model";
import { error, json } from "../http";
import { audit, canManage, withinScope, type Scope } from "./access";
import { body, decimal, longText, shortText, timestamp } from "./io";
import type { Formulation } from "./quantities";

const casSchema = z.string().regex(/^\d{2,7}-\d{2}-\d$/).refine(validCas);
const chemicalSchema = z.strictObject({
  nameAr: shortText, nameEn: shortText, cas: casSchema.optional(), formula: shortText.optional(),
  cid: z.number().int().positive().max(1e9).optional(), concentration: shortText.optional(),
  purity: shortText.optional(), solvent: shortText.optional(), formulation: shortText.optional(),
  physicalState: shortText.optional(), category: shortText.optional(), hazardEvidence: longText.optional(),
  wasteCategory: shortText.optional(), source: httpsUrl, verified: z.boolean().default(false),
  institutionId: referenceId.optional(), labId: referenceId.optional(),
});
const versionScope = {
  chemicalId: referenceId, institutionId: referenceId.optional(), supersedes: referenceId.optional(),
};
const priceSchema = z.strictObject({
  ...versionScope, kind: z.enum(["purchase", "disposal", "combined"]), value: decimal,
  currency: currencyCode.default("JOD"), packageQuantity: decimal.positive(), unit: z.enum(quantityUnits),
  supplier: shortText.optional(), invoice: shortText.optional(), date: z.iso.date().optional(),
  verified: z.boolean(),
}).refine(({ verified, kind, invoice, date }) => !verified || (kind !== "combined" && invoice && date));

const factorSchema = z.strictObject({
  ...versionScope, value: decimal, unit: z.enum(quantityUnits), stage: z.enum(carbonStages).optional(),
  geography: shortText.optional(), boundary: shortText.optional(), source: httpsUrl.optional(),
  publicationDate: z.iso.date().optional(), methodology: longText.optional(), uncertainty: shortText.optional(),
  stageExclusive: z.boolean().optional(), verified: z.boolean(),
}).refine((x) => !x.verified || (x.stage && x.geography && x.boundary && x.source && x.publicationDate && x.methodology && x.uncertainty && x.stageExclusive));

const densitySchema = z.strictObject({
  ...versionScope, kgPerLiter: decimal.positive(), conditions: longText, source: httpsUrl,
  temperatureC: z.number().min(-273.15), state: z.enum(["Liquid", "Solid"]),
});

const chemicalColumns = `id, name_ar AS nameAr, name_en AS nameEn, cas, formula, pubchem_cid AS cid,
  concentration, purity, solvent, formulation, physical_state AS state, category, hazard_evidence AS hazards,
  waste_category AS wasteCategory, status, updated_at AS updatedAt, provenance_json AS provenance,
  institution_id AS institutionId, lab_id AS labId`;

function readerScope(scope?: Scope) {
  if (scope?.global) return { sql: "1", values: [] };
  if (!scope?.institutionId) return { sql: "institution_id IS NULL", values: [] };
  return {
    sql: "(institution_id IS NULL OR (institution_id = ? AND (? IS NULL OR lab_id IS NULL OR lab_id = ?)))",
    values: [scope.institutionId, scope.labId, scope.labId],
  };
}

export async function catalogSearch(db: D1Database, url: URL, scope?: Scope) {
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 160).toLowerCase();
  const after = url.searchParams.get("after") ?? "";
  if (after && !referenceId.safeParse(after).success) return error("INVALID_REQUEST", 400);
  const access = readerScope(scope);
  const rows = await db.prepare(`SELECT ${chemicalColumns} FROM chemical_references WHERE ${access.sql}
    AND id > ? AND (? = '' OR instr(lower(name_en), ?) OR instr(name_ar, ?) OR instr(cas, ?)
      OR instr(lower(formula), ?) OR CAST(pubchem_cid AS TEXT) = ?)
    ORDER BY id LIMIT 51`).bind(...access.values, after, q, q, q, q, q, q).all<CatalogChemical>();
  const chemicals = rows.results.slice(0, 50);
  return json({ chemicals, next: rows.results.length > 50 ? chemicals.at(-1)?.id : null });
}

export async function catalogDetail(db: D1Database, id: string, scope?: Scope) {
  const access = readerScope(scope);
  const chemical = await db.prepare(`SELECT ${chemicalColumns} FROM chemical_references WHERE id = ? AND ${access.sql}`)
    .bind(id, ...access.values).first<CatalogChemical>();
  if (!chemical) return error("NOT_FOUND", 404);
  const history = Boolean(scope && canManage(scope));
  const restrict = scope?.global ? "1" : "(v.institution_id IS NULL OR v.institution_id = ?)";
  const args = scope?.global ? [id] : [id, scope?.institutionId ?? null];
  const invoice = scope?.global ? "v.invoice_reference" : history ? "CASE WHEN v.institution_id IS NOT NULL THEN v.invoice_reference END" : "NULL";
  const [prices, factors, densities] = await db.batch([
    db.prepare(`SELECT v.id, kind, value, v.currency, package_quantity AS packageQuantity, v.unit, status,
        supplier, effective_date AS date, created_at AS createdAt, v.supersedes,
        ${invoice} AS invoice, ${history || !scope ? "source_json" : "NULL"} AS source,
        (SELECT sourcePrice FROM fixed_guide_reference WHERE priceId = v.id) AS fixedSourceValue,
        (SELECT sourcePriceUnit FROM fixed_guide_reference WHERE priceId = v.id) AS fixedSourceUnit
      FROM chemical_price_versions v WHERE chemical_id = ? AND ${restrict}
      ${history ? "" : "AND (EXISTS (SELECT 1 FROM fixed_guide_reference WHERE priceId = v.id) OR NOT EXISTS (SELECT 1 FROM chemical_price_versions n WHERE n.supersedes = v.id))"}
      ORDER BY fixedSourceValue IS NOT NULL DESC, created_at DESC, id LIMIT 100`).bind(...args),
    db.prepare(`SELECT v.id, value, unit, stage, geography, boundary, source_url AS url, publication_date AS publicationDate,
        methodology, uncertainty, status, source_json AS source, created_at AS createdAt, v.supersedes,
        (SELECT sourceFactor FROM fixed_guide_reference WHERE factorId = v.id) AS fixedSourceValue,
        (SELECT sourceFactorUnit FROM fixed_guide_reference WHERE factorId = v.id) AS fixedSourceUnit
      FROM carbon_factor_versions v WHERE chemical_id = ? AND ${restrict}
      ${history ? "" : "AND (EXISTS (SELECT 1 FROM fixed_guide_reference WHERE factorId = v.id) OR NOT EXISTS (SELECT 1 FROM carbon_factor_versions n WHERE n.supersedes = v.id))"}
      ORDER BY fixedSourceValue IS NOT NULL DESC, created_at DESC, id LIMIT 100`).bind(...args),
    db.prepare(`SELECT v.id, kg_per_liter AS kgPerLiter, conditions, source_url AS url, v.supersedes,
        measurement_temperature_c AS temperatureC, measurement_state AS state
      FROM chemical_density_versions v WHERE chemical_id = ? AND ${restrict}
      ${history ? "" : "AND NOT EXISTS (SELECT 1 FROM chemical_density_versions n WHERE n.supersedes = v.id)"}
      ORDER BY created_at DESC, id LIMIT 100`).bind(...args),
  ]);
  return json({ chemical, prices: prices.results, factors: factors.results, densities: densities.results });
}

export async function addChemical(request: Request, db: D1Database, scope: Scope) {
  if (!canManage(scope)) return error("FORBIDDEN", 403);
  const data = await body(request, chemicalSchema);
  if (data instanceof Response) return data;
  const institutionId = data.institutionId ?? scope.institutionId;
  const labId = data.labId ?? null;
  if (!withinScope(scope, institutionId, labId) || (labId && !institutionId)) return error("FORBIDDEN", 403);
  if (data.verified && (!data.cas || !data.formulation || (!data.concentration && !data.purity) || !data.solvent)) {
    return error("FORMULATION_REQUIRED", 422);
  }
  if (institutionId && !await db.prepare("SELECT id FROM institutions WHERE id = ?").bind(institutionId).first()) return error("NOT_FOUND", 404);
  if (labId && !await db.prepare("SELECT id FROM institution_labs WHERE id = ? AND institution_id = ?").bind(labId, institutionId).first()) {
    return error("NOT_FOUND", 404);
  }
  const id = crypto.randomUUID();
  await db.batch([
    db.prepare(`INSERT INTO chemical_references (id, institution_id, lab_id, name_ar, name_en, cas, formula, pubchem_cid,
      concentration, purity, solvent, formulation, physical_state, category, hazard_evidence, waste_category, status, provenance_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, institutionId, labId, data.nameAr, data.nameEn, data.cas ?? null, data.formula ?? null, data.cid ?? null,
        data.concentration ?? null, data.purity ?? null, data.solvent ?? null, data.formulation ?? null,
        data.physicalState ?? null, data.category ?? null, data.hazardEvidence ?? null, data.wasteCategory ?? null,
        data.verified ? "verified" : "unverified", JSON.stringify({ url: data.source }), timestamp()),
    audit(db, scope, "chemical-created", id, institutionId, labId),
  ]);
  return json({ id }, 201);
}

const versionTables = { price: "chemical_price_versions", carbon: "carbon_factor_versions", density: "chemical_density_versions" } as const;
export async function addVersion(request: Request, db: D1Database, scope: Scope, type: keyof typeof versionTables) {
  if (!canManage(scope)) return error("FORBIDDEN", 403);
  const input = type === "price" ? await body(request, priceSchema)
    : type === "carbon" ? await body(request, factorSchema) : await body(request, densitySchema);
  if (input instanceof Response) return input;
  const material = await db.prepare("SELECT institution_id AS institutionId, lab_id AS labId, status FROM chemical_references WHERE id = ?")
    .bind(input.chemicalId).first<{ institutionId: string | null; labId: string | null; status: string }>();
  if (!material || (material.institutionId !== null && !withinScope(scope, material.institutionId, material.labId))) return error("NOT_FOUND", 404);
  const institutionId = input.institutionId ?? scope.institutionId ?? material.institutionId;
  if (!withinScope(scope, institutionId, material.labId) || (material.institutionId && material.institutionId !== institutionId)) {
    return error("FORBIDDEN", 403);
  }
  if (institutionId && !await db.prepare("SELECT id FROM institutions WHERE id = ?").bind(institutionId).first()) return error("NOT_FOUND", 404);
  const table = versionTables[type];
  if (input.supersedes) {
    if (type !== "density") {
      const column = type === "price" ? "priceId" : "factorId";
      if (await db.prepare(`SELECT id FROM fixed_guide_reference WHERE id = ? AND ${column} = ?`)
        .bind(input.chemicalId, input.supersedes).first()) return error("FIXED_GUIDE_REFERENCE", 409);
    }
    const parent = await db.prepare(`SELECT id ${"kind" in input ? ", kind, currency, supplier" : "unit" in input ? ", stage, geography, boundary" : ""}
      FROM ${table} WHERE id = ? AND chemical_id = ? AND institution_id IS ?`)
      .bind(input.supersedes, input.chemicalId, institutionId).first<Record<string, unknown>>();
    if (!parent || ("kind" in input && (parent.kind !== input.kind || parent.currency !== input.currency || parent.supplier !== (input.supplier ?? null))) ||
      ("unit" in input && !("kind" in input) && (parent.stage !== (input.stage ?? null) ||
        parent.geography !== (input.geography ?? null) || parent.boundary !== (input.boundary ?? null)))) return error("INVALID_VERSION", 422);
  }
  if ((("verified" in input && input.verified) || type === "density") && material.status !== "verified") {
    return error("VERIFIED_IDENTITY_REQUIRED", 422);
  }
  const id = crypto.randomUUID();
  const date = timestamp();
  const common = [id, input.chemicalId, institutionId];
  const statement = "kind" in input ? db.prepare(`INSERT INTO chemical_price_versions
      (id, chemical_id, institution_id, kind, value, currency, package_quantity, unit, supplier, invoice_reference,
       effective_date, source_json, status, supersedes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(...common, input.kind, input.value, input.currency, input.packageQuantity, input.unit, input.supplier ?? null,
      input.invoice ?? null, input.date ?? null, JSON.stringify({ type: "institutional-record" }),
      input.verified ? "verified" : "unverified", input.supersedes ?? null, date)
    : "unit" in input ? db.prepare(`INSERT INTO carbon_factor_versions
      (id, chemical_id, institution_id, value, unit, stage, geography, boundary, source_url, publication_date, methodology,
      uncertainty, source_json, status, supersedes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(...common, input.value, input.unit, input.stage ?? null, input.geography ?? null, input.boundary ?? null, input.source ?? null,
      input.publicationDate ?? null, input.methodology ?? null, input.uncertainty ?? null,
      JSON.stringify({ type: "reviewer-entry", stageExclusive: Boolean(input.stageExclusive) }),
        input.verified ? "verified" : "unverified", input.supersedes ?? null, date)
    : db.prepare(`INSERT INTO chemical_density_versions (id, chemical_id, institution_id, kg_per_liter, conditions, source_url, supersedes,
        created_at, measurement_temperature_c, measurement_state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(...common, input.kgPerLiter, input.conditions, input.source, input.supersedes ?? null, date, input.temperatureC, input.state);
  try {
    await db.batch([statement, audit(db, scope, type + "-version", id, institutionId, material.labId)]);
  } catch (cause) {
    if (input.supersedes && await db.prepare(`SELECT id FROM ${table} WHERE supersedes = ?`).bind(input.supersedes).first()) {
      return error("STALE_VERSION", 409);
    }
    throw cause;
  }
  return json({ id }, 201);
}

export async function calculationReferences(db: D1Database, scenario: Scenario, institutionId: string | null, labId: string | null) {
  const lines = (x: typeof scenario.financial | typeof scenario.emissions) =>
    Object.values(x).flatMap((entry) => [...entry.baseline, ...entry.actual]).filter((item) => "versionId" in item);
  const price = lines(scenario.financial);
  const carbon = lines(scenario.emissions);
  const refs = new Map<string, Reference & Formulation>();
  const densities = new Map<string, Density>();
  const slots = (ids: string[]) => ids.map(() => "?").join(",");
  const material = `AND (c.institution_id IS NULL OR (c.institution_id = ? AND (c.lab_id IS NULL OR c.lab_id = ?)))`;
  const referenceQueries = (["price", "carbon", "density"] as const).map((type) => {
    const ids = [...new Set(type === "density"
      ? [...price, ...carbon].flatMap((line) => line.densityVersionId ? [line.densityVersionId] : [])
      : (type === "price" ? price : carbon).map((line) => line.versionId))];
    const columns = type === "price" ? `v.kind, v.currency, v.package_quantity AS divisor, v.supplier, v.effective_date AS effectiveDate,
       v.invoice_reference AS invoiceReference`
      : type === "carbon" ? "v.stage, v.geography, v.boundary, v.source_url AS sourceUrl, v.methodology, v.publication_date AS publicationDate, v.uncertainty"
        : "v.kg_per_liter AS kgPerLiter, v.conditions, v.source_url AS sourceUrl, v.measurement_temperature_c AS temperatureC, v.measurement_state AS state";
    const verification = type === "carbon" ? " AND json_extract(v.source_json, '$.stageExclusive') = 1" : "";
    const data = type === "density" ? "" : `, (v.status = 'verified'${verification}) AS verified, v.value, v.unit, v.source_json AS provenance`;
    const conditions = type === "density" ? "AND v.measurement_temperature_c IS NOT NULL AND v.measurement_state IS NOT NULL" : "";
    // D1 accepts 100 bound parameters per query. Chunk selections to accommodate a full set of scenarios.
    const statements = [];
    for (let i = 0; i < ids.length; i += 90) {
      const chunk = ids.slice(i, i + 90);
      statements.push(db.prepare(`SELECT '${type}' AS type, v.id, v.chemical_id AS materialId, v.institution_id AS institutionId,
          c.status = 'verified' AS materialVerified, c.cas, c.formula, c.concentration, c.purity, c.solvent, c.formulation,
          c.physical_state AS physicalState, ${columns}${data}
        FROM ${versionTables[type]} v JOIN chemical_references c ON c.id = v.chemical_id
        WHERE v.id IN (${slots(chunk)}) AND (v.institution_id IS NULL OR v.institution_id = ?) ${material} ${conditions}`)
        .bind(...chunk, institutionId, institutionId, labId));
    }
    return { type, statements };
  });
  const snapshots: unknown[] = [];
  await Promise.all(referenceQueries.map(async ({ type, statements }) => {
    if (!statements.length) return;
    const batches = await db.batch<Reference & Density & Formulation>(statements);
    for (const { results } of batches) for (const value of results) {
      snapshots.push(value);
      if (type === "density") densities.set(value.id, value);
      else refs.set(value.id, value);
    }
  }));
  return { refs, densities, snapshots };
}
