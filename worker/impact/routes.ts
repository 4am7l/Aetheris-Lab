import type { Env } from "../index";
import { error, json } from "../http";
import { referenceId, scenarioSchema } from "../../src/impact/model";
import { catalogDetail, catalogSearch, addChemical, addVersion } from "./catalog";
import { operationImpact, evaluateScenario } from "./ledger";
import { analytics } from "./analytics";
import { attachAffiliation, authenticateMember, directory, membershipRoute, profileRoute, redeem, writeStructure } from "./organizations";
import { canManage, profile, type Scope } from "./access";
import { body, timestamp } from "./io";
import { emergency, inventory, sds } from "./laboratory";
import { pairEvidence } from "./evidence";
import { chemicalKnowledge, chemicalModel, chemicalSearch, pictogram } from "../sources";

function knowledgeRoute(route: string, url: URL) {
  if (route === "/knowledge") return chemicalSearch(url);
  const compound = /^\/knowledge\/([1-9][0-9]{0,9})(?:\/(2d|3d))?$/.exec(route);
  if (compound) return compound[2] ? chemicalModel(Number(compound[1]), compound[2] === "2d" ? "2d" : "3d") :
    chemicalKnowledge(Number(compound[1]));
  const graphic = /^\/pictograms\/(GHS0[1-9])$/.exec(route)?.[1];
  return graphic ? pictogram(graphic) : null;
}

export async function publicImpact(request: Request, env: Env) {
  const url = new URL(request.url);
  const route = url.pathname.slice("/api/impact".length);
  const { DB } = env;
  if (route === "/chemicals" && request.method === "GET") return catalogSearch(DB, url);
  const chemical = /^\/chemicals\/([^/]+)$/.exec(route)?.[1];
  if (chemical && request.method === "GET" && referenceId.safeParse(chemical).success) return catalogDetail(DB, chemical);
  if (route === "/pairs" && request.method === "GET") return pairEvidence(request, DB);
  const reference = request.method === "GET" ? knowledgeRoute(route, url) : null;
  if (reference) return reference;
  if (route === "/calculator" && request.method === "POST") {
    const scenario = await body(request, scenarioSchema);
    if (scenario instanceof Response) return scenario;
    const result = await evaluateScenario(DB, scenario, { institutionId: null, labId: null, geography: null }, timestamp());
    return json(result.result);
  }
  const operation = /^\/operations\/([^/]+)(?:\/(report|withdraw))?$/.exec(route);
  if (operation) {
    const mode = operation[2] as "report" | "withdraw" | undefined;
    return request.method === (mode ? "POST" : "GET") ? operationImpact(request, DB, operation[1], mode ?? "view") :
      error("METHOD_NOT_ALLOWED", 405);
  }
  const profileAction = /^\/profile\/(create|link|revoke)$/.exec(route)?.[1] as "create" | "link" | "revoke" | undefined;
  if (profileAction && request.method === "POST") return profileRoute(request, DB, profileAction);
  if (route === "/personal" && request.method === "GET") {
    const subject = await profile(DB, request);
    return subject ? analytics(DB, url, { profileId: subject.id }, "json") : error("UNAUTHORIZED", 401);
  }
  if (route === "/workspace/redeem" && request.method === "POST") return redeem(request, DB);
  if (!route.startsWith("/workspace/")) return error("NOT_FOUND", 404);
  const scope = await authenticateMember(request, DB);
  if (!scope) return error("UNAUTHORIZED", 401);
  const workspace = route.slice("/workspace".length);
  if (workspace === "/identity" && request.method === "GET") {
    const { actor, role, institutionId, labId } = scope;
    return json({ actor, role, institutionId, labId });
  }
  if (workspace === "/affiliate" && request.method === "POST") return attachAffiliation(request, DB, scope);
  return managedImpact(request, env, workspace, scope);
}

export async function managedImpact(request: Request, env: Env, route: string, scope: Scope) {
  const { DB } = env;
  const read = request.method === "GET";
  const write = request.method === "POST";
  const url = new URL(request.url);
  const reference = read ? knowledgeRoute(route, url) : null;
  if (reference) return reference;
  if (write && route === "/calculator") {
    const scenario = await body(request, scenarioSchema);
    if (scenario instanceof Response) return scenario;
    const { institutionId, labId } = scope;
    const organization = institutionId ? await DB.prepare("SELECT geography FROM institutions WHERE id = ?").bind(institutionId).first<{ geography: string }>() : null;
    const geography = organization?.geography ?? null;
    const result = await evaluateScenario(DB, scenario, { institutionId, labId, geography }, timestamp());
    return json(result.result);
  }
  if (read && (route === "/overview" || route === "/overview.csv")) return analytics(DB, url, scope, route.endsWith(".csv") ? "csv" : "json");
  if (route === "/directory") {
    if (read) return directory(DB, scope);
    if (write) return writeStructure(request, DB, scope);
  }
  if (route === "/memberships") {
    if (read) return membershipRoute(request, DB, scope, "list");
    if (write) return membershipRoute(request, DB, scope, "issue");
  }
  if (write && route === "/memberships/revoke") return membershipRoute(request, DB, scope, "revoke");
  if (route === "/chemicals") {
    if (read) return catalogSearch(DB, url, scope);
    if (write) return addChemical(request, DB, scope);
  }
  const chemical = /^\/chemicals\/([^/]+)$/.exec(route)?.[1];
  if (read && chemical && referenceId.safeParse(chemical).success) return catalogDetail(DB, chemical, scope);
  const version = /^\/versions\/(price|carbon|density)$/.exec(route)?.[1] as "price" | "carbon" | "density" | undefined;
  if (write && version) return addVersion(request, DB, scope, version);
  if (route === "/pairs") return pairEvidence(request, DB, scope);
  if (route === "/emergency") return emergency(request, DB, scope);
  const stock = /^\/inventory(?:\/([A-Za-z0-9-]+)(?:\/(movement|reconcile))?)?$/.exec(route);
  if (stock) return inventory(request, DB, scope, stock[1], stock[2]);
  const document = /^\/sds(?:\/([A-Za-z0-9-]+)(?:\/(file|review))?)?$/.exec(route);
  if (document) return sds(request, env, scope, document[1], document[2]);
  const operation = /^\/operations\/([^/]+)(?:\/(estimate|review|guide-match))?$/.exec(route);
  if (operation) {
    const mode = operation[2] as "estimate" | "review" | "guide-match" | undefined;
    return request.method === (mode ? "POST" : "GET") ? operationImpact(request, DB, operation[1], mode ?? "view", scope) :
      error("METHOD_NOT_ALLOWED", 405);
  }
  if (read && route === "/audit") {
    if (!canManage(scope)) return error("FORBIDDEN", 403);
    const list = await DB.prepare(`
      SELECT 'audit-' || id AS id, institution_id AS institutionId, lab_id AS labId, actor, action,
        resource_id AS resourceId, created_at AS createdAt FROM sustainability_audit WHERE (? OR institution_id = ?)
      UNION ALL SELECT 'impact-' || e.id, a.institution_id, a.lab_id, e.actor, e.state, e.request_id, e.created_at
        FROM impact_events e LEFT JOIN impact_affiliations a USING(request_id) WHERE (? OR a.institution_id = ?)
      UNION ALL SELECT 'stock-' || m.id, i.institution_id, i.lab_id, m.actor, 'stock-' || m.kind, i.id, m.created_at
        FROM inventory_movements m JOIN inventory_items i ON i.id = m.item_id WHERE (? OR i.institution_id = ?)
      UNION ALL SELECT 'sds-' || id, institution_id, lab_id, reviewed_by, 'sds-' || review_status, id, reviewed_at
        FROM sds_documents WHERE reviewed_at IS NOT NULL AND (? OR institution_id = ?)
      ORDER BY createdAt DESC, id DESC LIMIT 100`)
      .bind(...Array.from({ length: 4 }, () => [Number(scope.global), scope.institutionId]).flat()).all();
    return json({ events: list.results });
  }
  return error("NOT_FOUND", 404);
}
