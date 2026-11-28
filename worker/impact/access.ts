import type { D1Database } from "@cloudflare/workers-types";
import { hex } from "../http";

export type Role = "institution-admin" | "reviewer" | "lab-manager" | "viewer";
export interface Scope {
  actor: string;
  global: boolean;
  institutionId: string | null;
  labId: string | null;
  role: Role | "platform-admin";
}
export const platform = (actor: string): Scope => ({
  actor, global: true, institutionId: null, labId: null, role: "platform-admin",
});

export function token() {
  return hex(crypto.getRandomValues(new Uint8Array(32)));
}

export async function digest(value: string) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

export function bearer(request: Request) {
  return /^Bearer ([a-f0-9]{64})$/i.exec(request.headers.get("Authorization") ?? "")?.[1];
}

export async function member(db: D1Database, credential: string | undefined) {
  if (!credential) return null;
  const row = await db.prepare(`
    SELECT id AS actor, institution_id AS institutionId, lab_id AS labId, role
    FROM institution_memberships WHERE token_hash = ? AND accepted_at IS NOT NULL AND revoked_at IS NULL
  `).bind(await digest("membership:" + credential)).first<Omit<Scope, "global">>();
  return row ? { ...row, global: false } : null;
}

export function canReview(scope: Scope) {
  return scope.global || scope.role === "reviewer";
}

export function canManage(scope: Scope) {
  return scope.global || scope.role === "institution-admin";
}

export function canHandleStock(scope: Scope) {
  return canManage(scope) || scope.role === "lab-manager";
}

export function withinScope(scope: Scope, institution: string | null, lab: string | null) {
  return scope.global || (institution === scope.institutionId && (scope.labId === null || lab === scope.labId));
}

export function audit(db: D1Database, scope: Scope, action: string, resource: string,
  institutionId: string | null, labId: string | null = null) {
  return db.prepare(`INSERT INTO sustainability_audit(institution_id, lab_id, actor, action, resource_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`).bind(institutionId, labId, scope.actor, action, resource, new Date().toISOString());
}
