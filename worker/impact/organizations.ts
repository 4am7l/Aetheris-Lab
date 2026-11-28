import type { D1Database } from "@cloudflare/workers-types";
import { z } from "zod";
import { trackingTokenSchema } from "../../src/domain";
import type { Department, Laboratory, Organization } from "../../src/impact/contracts";
import { referenceId } from "../../src/impact/model";
import { error, json } from "../http";
import { audit, bearer, canManage, digest, member, token, withinScope, type Scope } from "./access";
import { body, shortText, timestamp } from "./io";
import { receiptAuthorized } from "./ledger";

const names = { nameAr: shortText, nameEn: shortText };
const structure = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("institution"), ...names, geography: shortText, id: referenceId.optional() }),
  z.strictObject({ kind: z.literal("department"), ...names, institutionId: referenceId, id: referenceId.optional() }),
  z.strictObject({ kind: z.literal("lab"), ...names, institutionId: referenceId, departmentId: referenceId, id: referenceId.optional() }),
]);
const invite = z.strictObject({
  institutionId: referenceId, labId: referenceId.optional(),
  role: z.enum(["institution-admin", "reviewer", "lab-manager", "viewer"]),
}).refine(({ labId, role }) => role !== "institution-admin" || !labId);
const inviteToken = z.strictObject({ invitation: trackingTokenSchema });
const revoke = z.strictObject({ id: referenceId });
const link = z.strictObject({ id: z.uuidv4(), receipt: trackingTokenSchema, labId: referenceId.optional() });

export async function directory(db: D1Database, scope: Scope) {
  const tenant = scope.global ? "1" : "institution_id = ?";
  const lab = scope.labId ? " AND id = ?" : "";
  const tenantArgs = scope.global ? [] : [scope.institutionId];
  const [institutions, departments, labs] = await db.batch<Organization & Department & Laboratory>([
    db.prepare(`SELECT id, name_en AS nameEn, name_ar AS nameAr, geography FROM institutions WHERE ${scope.global ? "1" : "id = ?"} ORDER BY name_en`).bind(...tenantArgs),
    db.prepare(`SELECT id, institution_id AS institutionId, name_en AS nameEn, name_ar AS nameAr FROM institution_departments WHERE ${tenant}
      ${scope.labId ? "AND id = (SELECT department_id FROM institution_labs WHERE id = ?)" : ""} ORDER BY name_en`).bind(...tenantArgs, ...(scope.labId ? [scope.labId] : [])),
    db.prepare(`SELECT id, institution_id AS institutionId, department_id AS departmentId, name_en AS nameEn, name_ar AS nameAr
      FROM institution_labs WHERE ${tenant}${lab} ORDER BY name_en`).bind(...tenantArgs, ...(scope.labId ? [scope.labId] : [])),
  ]);
  return json({ institutions: institutions.results, departments: departments.results, labs: labs.results });
}

export async function writeStructure(request: Request, db: D1Database, scope: Scope) {
  if (!canManage(scope)) return error("FORBIDDEN", 403);
  const data = await body(request, structure);
  if (data instanceof Response) return data;
  const id = data.id ?? crypto.randomUUID();
  const institution = data.kind === "institution" ? id : data.institutionId;
  if ((data.kind === "institution" && !scope.global) || !withinScope(scope, institution, null)) return error("FORBIDDEN", 403);
  if (data.kind !== "institution" && !await db.prepare("SELECT id FROM institutions WHERE id = ?").bind(institution).first()) {
    return error("NOT_FOUND", 404);
  }
  if (data.kind === "lab" && !await db.prepare("SELECT id FROM institution_departments WHERE id = ? AND institution_id = ?")
    .bind(data.departmentId, institution).first()) return error("NOT_FOUND", 404);
  const nameValues = [data.nameEn, data.nameAr];
  const statement = data.kind === "institution"
    ? data.id ? db.prepare("UPDATE institutions SET name_en = ?, name_ar = ?, geography = ? WHERE id = ? RETURNING id")
      .bind(...nameValues, data.geography, id) : db.prepare("INSERT INTO institutions (name_en, name_ar, geography, id, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id")
      .bind(...nameValues, data.geography, id, timestamp())
    : data.kind === "department"
      ? data.id ? db.prepare("UPDATE institution_departments SET name_en = ?, name_ar = ? WHERE id = ? AND institution_id = ? RETURNING id")
        .bind(...nameValues, id, institution) : db.prepare("INSERT INTO institution_departments(name_en, name_ar, id, institution_id) VALUES (?, ?, ?, ?) RETURNING id")
        .bind(...nameValues, id, institution)
      : data.id ? db.prepare("UPDATE institution_labs SET name_en = ?, name_ar = ? WHERE id = ? AND institution_id = ? AND department_id = ? RETURNING id")
        .bind(...nameValues, id, institution, data.departmentId)
        : db.prepare("INSERT INTO institution_labs(name_en, name_ar, id, institution_id, department_id) VALUES (?, ?, ?, ?, ?) RETURNING id")
          .bind(...nameValues, id, institution, data.departmentId);
  if (data.id) {
    const table = { institution: "institutions", department: "institution_departments", lab: "institution_labs" }[data.kind];
    if (!await db.prepare(`SELECT id FROM ${table} WHERE id = ? ${data.kind === "institution" ? "" : "AND institution_id = ?"}
      ${data.kind === "lab" ? "AND department_id = ?" : ""}`).bind(id, ...(data.kind === "institution" ? [] :
        data.kind === "lab" ? [institution, data.departmentId] : [institution])).first()) return error("NOT_FOUND", 404);
  }
  const [written] = await db.batch([statement, audit(db, scope, data.kind + (data.id ? "-updated" : "-created"), id,
    institution, data.kind === "lab" ? id : null)]);
  return written.results.length ? json({ id }, data.id ? 200 : 201) : error("NOT_FOUND", 404);
}

export async function membershipRoute(request: Request, db: D1Database, scope: Scope, action: "issue" | "list" | "revoke") {
  if (!canManage(scope)) return error("FORBIDDEN", 403);
  if (action === "list") {
    const args = scope.global ? [] : [scope.institutionId];
    const { results } = await db.prepare(`SELECT id, institution_id AS institutionId, lab_id AS labId, role,
      invite_expires_at AS expiresAt, accepted_at AS acceptedAt, revoked_at AS revokedAt, created_at AS createdAt
      FROM institution_memberships ${scope.global ? "" : "WHERE institution_id = ?"} ORDER BY created_at DESC, id LIMIT 100`).bind(...args).all();
    return json({ memberships: results });
  }
  if (action === "revoke") {
    const data = await body(request, revoke);
    if (data instanceof Response) return data;
    const row = await db.prepare("SELECT institution_id AS institutionId, lab_id AS labId, role FROM institution_memberships WHERE id = ? AND revoked_at IS NULL")
      .bind(data.id).first<{ institutionId: string; labId: string | null; role: string }>();
    if (!row || !withinScope(scope, row.institutionId, row.labId) ||
        (!scope.global && row.role === "institution-admin" && scope.actor !== data.id)) return error("NOT_FOUND", 404);
    await db.batch([
      db.prepare("UPDATE institution_memberships SET revoked_at = ?, token_hash = NULL WHERE id = ? AND revoked_at IS NULL").bind(timestamp(), data.id),
      audit(db, scope, "membership-revoked", data.id, row.institutionId, row.labId),
    ]);
    return json({ revoked: true });
  }
  const data = await body(request, invite);
  if (data instanceof Response) return data;
  const labId = data.labId ?? null;
  if (!withinScope(scope, data.institutionId, labId) || (!scope.global && data.role === "institution-admin")) return error("FORBIDDEN", 403);
  if (!await db.prepare("SELECT id FROM institutions WHERE id = ?").bind(data.institutionId).first()) return error("NOT_FOUND", 404);
  if (labId && !await db.prepare("SELECT id FROM institution_labs WHERE institution_id = ? AND id = ?").bind(data.institutionId, labId).first()) {
    return error("NOT_FOUND", 404);
  }
  const id = crypto.randomUUID();
  const credential = token();
  const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
  await db.batch([
    db.prepare(`INSERT INTO institution_memberships(id, institution_id, lab_id, role, invitation_hash, invite_expires_at, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, data.institutionId, labId, data.role, await digest("invitation:" + credential), expiresAt, timestamp(), scope.actor),
    audit(db, scope, "membership-issued", id, data.institutionId, labId),
  ]);
  return json({ id, invitation: credential, expiresAt }, 201);
}

export async function redeem(request: Request, db: D1Database) {
  const data = await body(request, inviteToken, 1024);
  if (data instanceof Response) return data;
  const credential = token();
  const now = timestamp();
  const row = await db.prepare(`UPDATE institution_memberships SET token_hash = ?, accepted_at = ?
    WHERE invitation_hash = ? AND accepted_at IS NULL AND revoked_at IS NULL AND invite_expires_at > ?
    RETURNING id AS actor, institution_id AS institutionId, lab_id AS labId, role`)
    .bind(await digest("membership:" + credential), now, await digest("invitation:" + data.invitation), now).first();
  return row ? json({ membership: row, token: credential }, 201) : error("INVALID_INVITATION", 404);
}

export async function attachAffiliation(request: Request, db: D1Database, scope: Scope) {
  const data = await body(request, link, 1024);
  if (data instanceof Response) return data;
  if (!await receiptAuthorized(db, data.id, data.receipt)) return error("NOT_FOUND", 404);
  const lab = scope.labId ?? (canManage(scope) ? data.labId : undefined);
  if (!lab || (data.labId && data.labId !== lab) || !scope.institutionId) return error("LAB_MEMBERSHIP_REQUIRED", 403);
  const inserted = await db.prepare(`INSERT INTO impact_affiliations(request_id, institution_id, lab_id, attached_at)
    SELECT r.id, l.institution_id, l.id, ? FROM public_requests r
    JOIN public_request_workflow w ON w.request_id = r.id
    JOIN institution_labs l ON l.id = ? AND l.institution_id = ?
    JOIN institution_memberships m ON m.id = ? AND m.revoked_at IS NULL
    WHERE r.id = ? AND w.archived_at IS NULL AND NOT EXISTS (SELECT 1 FROM impact_events WHERE request_id = r.id)
    ON CONFLICT (request_id) DO NOTHING RETURNING request_id`)
    .bind(timestamp(), lab, scope.institutionId, scope.actor, data.id).first();
  if (inserted || await db.prepare("SELECT 1 FROM impact_affiliations WHERE request_id = ? AND institution_id = ? AND lab_id = ?")
    .bind(data.id, scope.institutionId, lab).first()) return json({ linked: true });
  return error("AFFILIATION_UNAVAILABLE", 409);
}

export function authenticateMember(request: Request, db: D1Database) {
  return member(db, bearer(request));
}
