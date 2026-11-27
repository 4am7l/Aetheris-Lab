import type { D1Database } from "@cloudflare/workers-types";
import { z } from "zod";
import { eventKey, httpsUrl, quantitySchema, quantityUnits, referenceId, unitsIn } from "../../src/impact/model";
import type { InventoryItem } from "../../src/impact/contracts";
import { sdsCandidates } from "../../src/impact/sds";
import type { Env } from "../index";
import { error, hex, identityEncoding, json, readBytes } from "../http";
import { audit, canHandleStock, canManage, canReview, digest, withinScope, type Scope } from "./access";
import { body, longText, shortText, timestamp } from "./io";

interface Target { institutionId: string; labId: string }
export async function resolveLab(db: D1Database, scope: Scope, id?: string) {
  const chosen = id ?? scope.labId;
  if (!chosen) return null;
  const lab = await db.prepare("SELECT institution_id AS institutionId, id AS labId FROM institution_labs WHERE id = ?")
    .bind(chosen).first<Target>();
  return lab && withinScope(scope, lab.institutionId, lab.labId) ? lab : null;
}

export async function accessibleMaterial(db: D1Database, id: string, target: { institutionId: string | null; labId: string | null }) {
  return db.prepare(`SELECT id, status FROM chemical_references WHERE id = ? AND
    (institution_id IS NULL OR (institution_id = ? AND (lab_id IS NULL OR lab_id = ?)))`)
    .bind(id, target.institutionId, target.labId).first<{ id: string; status: "verified" | "unverified" }>();
}

const listFilter = z.object({ q: z.string().trim().max(120).default(""), lab: referenceId.optional(), after: referenceId.optional() });
const inventorySchema = z.strictObject({
  id: referenceId.optional(), labId: referenceId.optional(), chemicalId: referenceId, container: shortText,
  batch: shortText.optional(), unit: z.enum(quantityUnits), location: shortText, bought: z.iso.date().optional(),
  reviewBy: z.iso.date().optional(), priceId: referenceId.optional(),
});
const movementSchema = z.strictObject({
  key: eventKey, kind: z.enum(["received", "consumed", "adjustment", "returned", "preserved", "recovery", "disposal"]),
  quantity: quantitySchema.optional(), decrease: z.boolean().default(false), reason: longText,
  requestId: z.uuidv4().optional(), impactEventId: z.number().int().positive().optional(),
}).refine(({ kind, quantity, requestId, impactEventId, decrease }) => (!decrease || kind === "adjustment") &&
  (["returned", "preserved", "recovery", "disposal"].includes(kind) ? requestId && impactEventId && !quantity :
    !requestId && !impactEventId && quantity && quantity.value > 0));

const reconciliationSchema = z.strictObject({ movementId: z.number().int().positive(), eventId: z.number().int().positive() });
const activeReconciliation = `r.adjustment_id IS NULL AND r.event_id = coalesce(
  (SELECT max(id) FROM impact_events WHERE request_id = m.request_id AND integrity_version = 2
    AND state IN ('verified','corrected','cancelled')),
  (SELECT max(event_id) FROM inventory_impact_reconciliations WHERE movement_id = m.id)
)`;

const stockColumns = `i.id, i.lab_id AS labId, i.institution_id AS institutionId, chemical_id AS chemicalId, c.name_en AS name,
  i.container, i.batch, i.quantity, i.unit, i.location, i.bought, i.review_by AS reviewBy, i.price_id AS priceId, i.updated_at AS updatedAt`;
export async function inventory(request: Request, db: D1Database, scope: Scope, id?: string, action?: string) {
  if (request.method === "GET") {
    if (action) return error("METHOD_NOT_ALLOWED", 405);
    if (id) {
      const item = await db.prepare(`SELECT ${stockColumns} FROM inventory_items i JOIN chemical_references c ON c.id = i.chemical_id WHERE i.id = ?`)
        .bind(id).first<InventoryItem & Target>();
      if (!item || !withinScope(scope, item.institutionId, item.labId)) return error("NOT_FOUND", 404);
      const [movements, reconciliations] = await db.batch([
        db.prepare(`SELECT id, kind, delta, reason, impact_event_id AS impactEventId, actor, created_at AS createdAt
          FROM inventory_movements WHERE item_id = ? ORDER BY id DESC LIMIT 100`).bind(id),
        db.prepare(`SELECT r.movement_id AS movementId, r.event_id AS eventId, r.delta
          FROM inventory_movements m JOIN inventory_impact_reconciliations r ON r.movement_id = m.id
          WHERE m.item_id = ? AND ${activeReconciliation} ORDER BY r.event_id, m.id LIMIT 100`).bind(id),
      ]);
      return json({ item, movements: movements.results, reconciliations: reconciliations.results });
    }
    const filter = listFilter.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!filter.success) return error("INVALID_FILTER", 400);
    const { q, after, lab } = filter.data;
    const { results } = await db.prepare(`SELECT ${stockColumns} FROM inventory_items i JOIN chemical_references c ON c.id = i.chemical_id
      WHERE (? OR i.institution_id = ?) AND (? IS NULL OR i.lab_id = ?) AND (? IS NULL OR i.lab_id = ?) AND i.id > ?
       AND instr(lower(i.container||' '||i.location||' '||c.name_en||' '||c.name_ar), ?) > 0
      ORDER BY i.id LIMIT 51`).bind(Number(scope.global), scope.institutionId, scope.labId, scope.labId, lab ?? null, lab ?? null, after ?? "", q.toLowerCase()).all<InventoryItem>();
    const items = results.slice(0, 50);
    return json({ items, next: results.length > 50 ? items.at(-1)?.id : null });
  }
  if (request.method !== "POST") return error("METHOD_NOT_ALLOWED", 405);
  if (!canHandleStock(scope)) return error("FORBIDDEN", 403);
  if (id && action === "movement") return addMovement(request, db, scope, id);
  if (id && action === "reconcile") return reconcileMovement(request, db, scope, id);
  if (id) return error("NOT_FOUND", 404);
  const data = await body(request, inventorySchema);
  if (data instanceof Response) return data;
  const target = await resolveLab(db, scope, data.labId);
  if (!target || !await accessibleMaterial(db, data.chemicalId, target)) return error("NOT_FOUND", 404);
  if (data.priceId && !await db.prepare(`SELECT id FROM chemical_price_versions WHERE id = ? AND chemical_id = ?
    AND kind = 'purchase' AND status = 'verified' AND (institution_id IS NULL OR institution_id = ?)`)
    .bind(data.priceId, data.chemicalId, target.institutionId).first()) return error("INVALID_PRICE", 422);
  const itemId = data.id ?? crypto.randomUUID();
  const values = [data.batch ?? null, data.location, data.bought ?? null, data.reviewBy ?? null, data.priceId ?? null, timestamp()];
  if (data.id && !await db.prepare(`SELECT id FROM inventory_items WHERE id = ? AND lab_id = ? AND chemical_id = ? AND unit = ? AND container = ?`)
    .bind(data.id, target.labId, data.chemicalId, data.unit, data.container).first()) return error("NOT_FOUND", 404);
  try {
    await db.batch([
      data.id ? db.prepare(`UPDATE inventory_items SET batch = ?, location = ?, bought = ?, review_by = ?, price_id = ?, updated_at = ?
        WHERE id = ? AND lab_id = ?`).bind(...values, itemId, target.labId)
        : db.prepare(`INSERT INTO inventory_items (batch, location, bought, review_by, price_id, updated_at, id, lab_id, institution_id,
          chemical_id, container, unit, quantity) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`)
          .bind(...values, itemId, target.labId, target.institutionId, data.chemicalId, data.container, data.unit),
      audit(db, scope, data.id ? "inventory-updated" : "inventory-created", itemId, target.institutionId, target.labId),
    ]);
  } catch (cause) {
    if (!data.id && await db.prepare("SELECT id FROM inventory_items WHERE lab_id = ? AND container = ?").bind(target.labId, data.container).first()) {
      return error("DUPLICATE_CONTAINER", 409);
    }
    throw cause;
  }
  return json({ id: itemId }, data.id ? 200 : 201);
}

async function reconcileMovement(request: Request, db: D1Database, scope: Scope, id: string) {
  const data = await body(request, reconciliationSchema);
  if (data instanceof Response) return data;
  const item = await db.prepare("SELECT institution_id AS institutionId, lab_id AS labId FROM inventory_items WHERE id = ?")
    .bind(id).first<Target>();
  if (!item || !withinScope(scope, item.institutionId, item.labId)) return error("NOT_FOUND", 404);
  const key = `impact:${data.movementId}:${data.eventId}`;
  const [, resolution] = await db.batch([
    db.prepare(`INSERT INTO inventory_movements(item_id, key, input_digest, kind, delta, reason, actor, created_at)
      SELECT i.id, ?, 'reviewed-impact', 'adjustment', r.delta, ?, ?, ?
      FROM inventory_items i JOIN inventory_movements m ON m.item_id = i.id
      JOIN inventory_impact_reconciliations r ON r.movement_id = m.id WHERE i.id = ?
        AND m.id = ? AND r.event_id = ? AND i.quantity + r.delta >= 0 AND ${activeReconciliation}
      ON CONFLICT DO NOTHING`).bind(key, `Review of linked impact event ${data.eventId}`, scope.actor, timestamp(), id, data.movementId, data.eventId),
    db.prepare(`UPDATE inventory_impact_reconciliations SET adjustment_id =
      (SELECT id FROM inventory_movements WHERE item_id = ? AND key = ?)
      WHERE movement_id = ? AND event_id = ? AND adjustment_id IS NULL AND EXISTS
        (SELECT 1 FROM inventory_movements WHERE item_id = ? AND key = ?)
      RETURNING adjustment_id AS id`).bind(id, key, data.movementId, data.eventId, id, key),
  ]);
  const resolved = resolution.results[0] ?? await db.prepare(
    "SELECT id FROM inventory_movements WHERE item_id = ? AND key = ?",
  ).bind(id, key).first();
  return resolved ? json(resolved) : error("RECONCILIATION_PENDING", 409);
}

async function addMovement(request: Request, db: D1Database, scope: Scope, id: string) {
  const data = await body(request, movementSchema);
  if (data instanceof Response) return data;
  const item = await db.prepare(`SELECT ${stockColumns} FROM inventory_items i JOIN chemical_references c ON c.id = i.chemical_id WHERE i.id = ?`)
    .bind(id).first<InventoryItem & Target>();
  if (!item || !withinScope(scope, item.institutionId, item.labId)) return error("NOT_FOUND", 404);
  const hash = await digest(JSON.stringify([scope.actor, data]));
  const replay = await db.prepare("SELECT id, input_digest AS digest FROM inventory_movements WHERE item_id = ? AND key = ?")
    .bind(id, data.key).first<{ id: number; digest: string }>();
  if (replay) return replay.digest === hash ? json({ id: replay.id }) : error("KEY_REUSED", 409);
  let quantity = data.quantity;
  if (data.requestId) {
    const action = await db.prepare(`SELECT x.value AS activity FROM impact_events e JOIN impact_affiliations a USING (request_id)
      JOIN public_request_workflow w ON w.request_id = e.request_id AND w.status = 'Approved'
      JOIN chemical_references c ON c.id = ?
      JOIN json_each(e.activities_json) x
      WHERE e.request_id = ? AND e.id = ? AND a.lab_id = ? AND a.institution_id = ?
      AND e.integrity_version = 2 AND e.state IN ('verified','corrected')
      AND e.id = (SELECT max(id) FROM impact_events WHERE request_id = e.request_id)
      AND c.status = 'verified' AND json_extract(x.value, '$.materialId') = c.id
      AND json_extract(x.value, '$.side') IN ('A','B')
      AND json_extract(x.value,'$.kind') = ?`)
      .bind(item.chemicalId, data.requestId, data.impactEventId, item.labId, item.institutionId, data.kind).first<{ activity: string }>();
    if (!action) return error("VERIFIED_ACTIVITY_REQUIRED", 422);
    quantity = quantitySchema.parse(JSON.parse(action.activity).quantity);
  }
  if (!quantity) return error("INVALID_REQUEST", 400);
  const inStockUnit = unitsIn(quantity, item.unit);
  if (inStockUnit === null) return error("INCOMPATIBLE_UNITS", 422);
  const out = ["consumed", "recovery", "disposal"].includes(data.kind) || (data.kind === "adjustment" && data.decrease);
  const delta = data.kind === "preserved" ? 0 : inStockUnit * (out ? -1 : 1);
  const result = await db.prepare(`INSERT INTO inventory_movements
    (item_id, key, input_digest, kind, delta, reason, request_id, impact_event_id, actor, created_at)
    SELECT i.id, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM inventory_items i WHERE i.id = ? AND i.quantity + ? >= 0
      AND (? IS NULL OR (? = (SELECT max(id) FROM impact_events WHERE request_id = ?)
        AND NOT EXISTS (SELECT 1 FROM inventory_movements m JOIN inventory_impact_reconciliations r ON r.movement_id = m.id
          WHERE m.request_id = ? AND r.adjustment_id IS NULL AND r.event_id = ?)))
    ON CONFLICT DO NOTHING RETURNING id`).bind(data.key, hash, data.kind, delta, data.reason,
      data.requestId ?? null, data.impactEventId ?? null, scope.actor, timestamp(),
      id, delta, data.requestId ?? null, data.impactEventId ?? null, data.requestId ?? null, data.requestId ?? null, data.impactEventId ?? null).first();
  if (result) return json(result, 201);
  const duplicate = await db.prepare("SELECT id FROM inventory_movements WHERE item_id = ? AND key = ? AND input_digest = ?")
    .bind(id, data.key, hash).first();
  return duplicate ? json(duplicate) : error("MOVEMENT_CONFLICT", 409);
}

const sdsMeta = z.strictObject({
  title: shortText, labId: referenceId.optional(), chemicalId: referenceId.optional(),
  revisionDate: z.iso.date().optional(), candidates: sdsCandidates, confirmed: z.literal(true),
});
const sdsReview = z.strictObject({ verified: z.boolean(), reason: longText });

function hasPdfEnvelope(pdf: ArrayBuffer) {
  const decoder = new TextDecoder();
  const header = decoder.decode(pdf.slice(0, 16));
  if (!/^%PDF-(?:1\.[0-7]|2\.0)[\r\n]/.test(header)) return false;
  const tail = decoder.decode(pdf.slice(Math.max(0, pdf.byteLength - 1024)));
  const match = /startxref[\r\n]+(\d+)[\r\n]+%%EOF[\r\n\t ]*$/.exec(tail);
  if (!match) return false;
  const offset = Number(match[1]);
  if (!Number.isSafeInteger(offset) || offset < 9 || offset >= pdf.byteLength) return false;
  return /^(?:xref[\s]|\d+\s+\d+\s+obj[\s])/.test(decoder.decode(pdf.slice(offset, offset + 32)));
}

type SdsAccess = { id: string; status: string; createdBy: string };
function canReadSds(scope: Scope, doc: SdsAccess) {
  return doc.status === "verified" || doc.createdBy === scope.actor || canReview(scope);
}

function duplicateSds(scope: Scope, doc: SdsAccess) {
  return canReadSds(scope, doc) ? json({ id: doc.id }) : error("UPLOAD_CONFLICT", 409);
}

export async function sds(request: Request, env: Env, scope: Scope, id?: string, action?: string) {
  const { DB: db, IMAGES: bucket } = env;
  if (request.method === "GET" && !id) {
    const filter = listFilter.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!filter.success) return error("INVALID_FILTER", 400);
    const { q, after, lab } = filter.data;
    const { results } = await db.prepare(`SELECT id, lab_id AS labId, title, revision_date AS revisionDate, review_status AS status,
      created_at AS createdAt FROM sds_documents WHERE (? OR institution_id = ?)
      AND (? IS NULL OR lab_id = ?) AND (? IS NULL OR lab_id = ?) AND id > ? AND instr(lower(title), ?) > 0
      AND (? OR review_status = 'verified' OR created_by = ?)
      ORDER BY id LIMIT 51`).bind(Number(scope.global), scope.institutionId, scope.labId, scope.labId, lab ?? null, lab ?? null, after ?? "",
      q.toLowerCase(), Number(canReview(scope)), scope.actor)
      .all<{ id: string }>();
    return json({ documents: results.slice(0, 50), next: results.length > 50 ? results[49].id : null });
  }
  if (id) {
    const doc = await db.prepare(`SELECT institution_id AS institutionId, lab_id AS labId, id, title, object_key AS objectKey,
      revision_date AS revisionDate, review_status AS status, review_reason AS reviewReason, reviewed_at AS reviewedAt,
      chemical_id AS chemicalId, extracted_json AS extracted, created_at AS createdAt, created_by AS createdBy
      FROM sds_documents WHERE id = ?`)
      .bind(id).first<Target & SdsAccess & { objectKey: string; extracted: string }>();
    if (!doc || !withinScope(scope, doc.institutionId, doc.labId)) return error("NOT_FOUND", 404);
    if (request.method === "GET" && !canReadSds(scope, doc)) return error("NOT_FOUND", 404);
    const { objectKey, extracted, createdBy: uploader, ...meta } = doc;
    if (request.method === "GET" && !action) return json({ ...meta, candidates: JSON.parse(extracted) });
    if (request.method === "GET" && action === "file") {
      if (!bucket) return error("SERVICE_UNAVAILABLE", 503);
      const payload = await bucket.get(objectKey);
      return payload ? new Response(payload.body as unknown as BodyInit, { headers: {
        "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="safety-data-sheet.pdf"',
        "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; sandbox",
        "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin",
      } }) : error("NOT_FOUND", 404);
    }
    if (request.method === "POST" && action === "review") {
      if (!canReview(scope)) return error("FORBIDDEN", 403);
      if (uploader === scope.actor) return error("INDEPENDENT_REVIEW_REQUIRED", 403);
      const data = await body(request, sdsReview);
      if (data instanceof Response) return data;
      const result = await db.prepare(`UPDATE sds_documents SET review_status = ?, review_reason = ?, reviewed_by = ?, reviewed_at = ?
        WHERE id = ? AND review_status = 'submitted' AND (? OR EXISTS (
          SELECT 1 FROM institution_memberships WHERE id = ? AND role = 'reviewer' AND accepted_at IS NOT NULL
            AND revoked_at IS NULL AND institution_id = ? AND (lab_id IS NULL OR lab_id = ?)
        )) RETURNING id`)
        .bind(data.verified ? "verified" : "rejected", data.reason, scope.actor, timestamp(), id, Number(scope.global),
          scope.actor, doc.institutionId, doc.labId).first();
      return result ? json(result) : error("STALE_REVIEW", 409);
    }
    return error("NOT_FOUND", 404);
  }
  if (request.method !== "POST") return error("METHOD_NOT_ALLOWED", 405);
  if (!canHandleStock(scope)) return error("FORBIDDEN", 403);
  if (!bucket) return error("SERVICE_UNAVAILABLE", 503);
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!/^multipart\/form-data;\s*boundary=/i.test(contentType) || !identityEncoding(request)) return error("UNSUPPORTED_MEDIA_TYPE", 415);
  const bytes = await readBytes(request, 5 * 1024 * 1024 + 100 * 1024);
  if (bytes instanceof Response) return bytes;
  let form: FormData;
  try {
    form = await new Response(bytes, { headers: { "Content-Type": contentType } }).formData();
  } catch {
    return error("INVALID_BODY", 400);
  }
  const file = form.get("pdf");
  const metadata = form.get("metadata");
  if ([...form.keys()].some((key) => key !== "pdf" && key !== "metadata") ||
      form.getAll("pdf").length !== 1 || form.getAll("metadata").length !== 1 || typeof metadata !== "string" ||
      !file || typeof file === "string" || file.size === 0 || file.size > 5 * 1024 * 1024 || file.type !== "application/pdf") {
    return error("INVALID_PDF", 400);
  }
  let input: unknown;
  try { input = JSON.parse(metadata); } catch { return error("INVALID_REQUEST", 400); }
  const parsed = sdsMeta.safeParse(input);
  if (!parsed.success) return error("INVALID_REQUEST", 400);
  const data = parsed.data;
  const target = await resolveLab(db, scope, data.labId);
  if (!target || (data.chemicalId && !await accessibleMaterial(db, data.chemicalId, target))) return error("NOT_FOUND", 404);
  const pdf = await file.arrayBuffer();
  if (!hasPdfEnvelope(pdf)) return error("INVALID_PDF", 400);
  const hash = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", pdf)));
  const findDuplicate = "SELECT id, review_status AS status, created_by AS createdBy FROM sds_documents WHERE lab_id = ? AND sha256 = ?";
  const existing = await db.prepare(findDuplicate).bind(target.labId, hash).first<SdsAccess>();
  if (existing) return duplicateSds(scope, existing);
  const docId = crypto.randomUUID();
  const objectKey = `sds/${target.institutionId}/${target.labId}/${docId}`;
  await bucket.put(objectKey, pdf, { httpMetadata: { contentType: "application/pdf" } });
  try {
    await db.batch([
      db.prepare(`INSERT INTO sds_documents(id, institution_id, lab_id, object_key, sha256, size_bytes, title, chemical_id, revision_date,
        extracted_json, review_status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?)`)
        .bind(docId, target.institutionId, target.labId, objectKey, hash, pdf.byteLength, data.title, data.chemicalId ?? null, data.revisionDate ?? null,
          JSON.stringify(data.candidates), scope.actor, timestamp()),
      audit(db, scope, "sds-uploaded", docId, target.institutionId, target.labId),
    ]);
  } catch (cause) {
    const committed = await db.withSession("first-primary").prepare(findDuplicate).bind(target.labId, hash).first<SdsAccess>();
    if (committed?.id !== docId) await bucket.delete(objectKey).catch(() => {});
    if (committed) return duplicateSds(scope, committed);
    throw cause;
  }
  return json({ id: docId }, 201);
}

const emergencySchema = z.strictObject({
  id: referenceId.optional(), institutionId: referenceId.optional(), labId: referenceId.optional(),
  nameEn: shortText, nameAr: shortText, contact: shortText, procedure: httpsUrl, sds: httpsUrl.optional(),
});
export async function emergency(request: Request, db: D1Database, scope: Scope) {
  if (request.method === "GET") {
    const { results } = await db.prepare(`SELECT id, institution_id AS institutionId, lab_id AS labId, name_en AS nameEn, name_ar AS nameAr,
      contact, procedure_url AS procedure, sds_url AS sds, approved_at AS approvedAt FROM emergency_directory
      WHERE (? OR institution_id = ?) AND (? IS NULL OR lab_id IS NULL OR lab_id = ?) ORDER BY name_en LIMIT 100`)
      .bind(Number(scope.global), scope.institutionId, scope.labId, scope.labId).all();
    return json({ contacts: results });
  }
  if (request.method !== "POST") return error("METHOD_NOT_ALLOWED", 405);
  if (!canManage(scope)) return error("FORBIDDEN", 403);
  const data = await body(request, emergencySchema);
  if (data instanceof Response) return data;
  const institutionId = data.institutionId ?? scope.institutionId;
  const labId = data.labId ?? null;
  if (!institutionId || !withinScope(scope, institutionId, labId)) return error("FORBIDDEN", 403);
  if (!await db.prepare("SELECT id FROM institutions WHERE id = ?").bind(institutionId).first()) return error("NOT_FOUND", 404);
  const target = labId ? await resolveLab(db, scope, labId) : null;
  if (labId && target?.institutionId !== institutionId) return error("NOT_FOUND", 404);
  const id = data.id ?? crypto.randomUUID();
  if (data.id && !await db.prepare("SELECT id FROM emergency_directory WHERE id = ? AND institution_id = ? AND lab_id IS ?")
    .bind(id, institutionId, labId).first()) return error("NOT_FOUND", 404);
  const common = [data.nameEn, data.nameAr, data.contact, data.procedure, data.sds ?? null, scope.actor, timestamp()];
  await db.batch([
    data.id ? db.prepare(`UPDATE emergency_directory SET name_en = ?, name_ar = ?, contact = ?, procedure_url = ?, sds_url = ?,
      approved_by = ?, approved_at = ? WHERE id = ? AND institution_id = ? AND lab_id IS ?`).bind(...common, id, institutionId, labId)
      : db.prepare(`INSERT INTO emergency_directory (name_en, name_ar, contact, procedure_url, sds_url, approved_by, approved_at, id, institution_id, lab_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(...common, id, institutionId, labId),
    audit(db, scope, "emergency-directory-updated", id, institutionId, labId),
  ]);
  return json({ id }, data.id ? 200 : 201);
}
