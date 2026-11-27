import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { jsPDF } from "jspdf";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../../worker";
import { testDatabase } from "../../tests/d1";
import { blankSolution, type CreatedReceipt } from "../domain";
import type { CatalogChemical, ImpactOverview, OperationImpact } from "./contracts";

const base = "/api/impact";
const ws = base + "/workspace";
const platformPath = "/api/admin/impact";
const origin = "https://laboratory.example.test";
const adminOrigin = "https://admin.example.test";
const adminPassword = "test-fixture-password";
const adminSecret = "a".repeat(64);
const csrfTokenValue = randomBytes(32).toString("hex");
const csrf = createHash("sha256").update("csrf:" + csrfTokenValue).digest("hex");
const reviewerToken = "b".repeat(64);
const viewerToken = "c".repeat(64);
const otherToken = "d".repeat(64);
const tenantToken = "e".repeat(64);
const secondManagerToken = "f".repeat(64);
const foreignManagerToken = "1".repeat(64);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const solution = { ...blankSolution, name: "Sodium chloride", cas: "7647-14-5", formula: "NaCl", quantity: "250", quantityUnit: "mL",
  concentration: "0.1", unit: "mol/L", solvent: "Water", state: "Liquid", temperature: "25" };
const water = { ...blankSolution, name: "Water", cas: "7732-18-5", formula: "H2O", quantity: "0.5", quantityUnit: "L",
  solvent: "Water", state: "Liquid", temperature: "25" };
const scenarioMeta = { assumptions: "Measured baseline and documented comparison", references: [{ title: "Fixture documented evidence" }] };
const actualDate = "2025-06-01";
let migrations: string[];
let db: DatabaseSync;
let env: Env;
let files: Map<string, ArrayBuffer>;

beforeAll(async () => {
  const location = new URL("../../migrations/", import.meta.url);
  const names = (await readdir(location)).filter((name) => name.endsWith(".sql")).sort();
  migrations = await Promise.all(names.map((name) => readFile(new URL(name, location), "utf8")));
});
beforeEach(() => {
  db = new DatabaseSync(":memory:");
  for (const sql of migrations) db.exec(sql);
  files = new Map();
  const imageStore = {
    put: (key: string, value: ArrayBuffer) => { files.set(key, value); },
    get: (key: string) => files.has(key) ? { body: files.get(key) } : null,
    delete: (key: string) => { files.delete(key); },
  };
  const limit = { limit: () => Promise.resolve({ success: true }) };
  env = { DB: testDatabase(db), IMAGES: imageStore as unknown as Env["IMAGES"], SUBMISSION_LIMIT: limit,
    TRACKING_LIMIT: limit, ADMIN_ORIGIN: adminOrigin, ADMIN_PROXY_SECRET: adminSecret, ADMIN_PASSWORD: adminPassword };
  db.prepare("INSERT INTO admin_sessions(token_sha256, expires_at) VALUES (?, ?)")
    .run(createHmac("sha256", JSON.stringify(adminPassword)).update("session:" + csrfTokenValue).digest("hex"), Math.floor(Date.now() / 1000) + 3600);
  for (const suffix of ["a", "b"]) {
    db.prepare("INSERT INTO institutions VALUES (?, ?, ?, 'JO', ?)").run("uni-" + suffix, "جامعة " + suffix, "University " + suffix, actualDate);
    db.prepare("INSERT INTO institution_departments VALUES (?, ?, ?, ?)").run("dept-" + suffix, "uni-" + suffix, "قسم " + suffix, "Department " + suffix);
    db.prepare("INSERT INTO institution_labs VALUES (?, ?, ?, ?, ?)").run("lab-" + suffix, "uni-" + suffix, "dept-" + suffix, "مختبر " + suffix, "Laboratory " + suffix);
  }
  for (const [actor, credential, institution, lab, role] of [
    ["reviewer-a", reviewerToken, "uni-a", "lab-a", "reviewer"],
    ["viewer-a", viewerToken, "uni-a", "lab-a", "viewer"],
    ["reviewer-b", otherToken, "uni-b", "lab-b", "reviewer"],
    ["manager-a", tenantToken, "uni-a", null, "institution-admin"],
    ["stock-a", secondManagerToken, "uni-a", "lab-a", "lab-manager"],
    ["stock-b", foreignManagerToken, "uni-b", "lab-b", "lab-manager"],
  ] as const) {
    db.prepare(`INSERT INTO institution_memberships(id,institution_id,lab_id,role,token_hash,invitation_hash,invite_expires_at,created_at,created_by,accepted_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(actor, institution, lab, role, hash("membership:" + credential), hash("invite:" + credential), "2999-01-01",
      actualDate, "fixture", actualDate);
  }
});
afterEach(() => { db.close(); vi.unstubAllGlobals(); });

async function call(path: string, data?: unknown, token?: string, admin = false) {
  const headers = new Headers();
  if (data !== undefined && !(data instanceof FormData)) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", "Bearer " + token);
  if (admin) {
    headers.set("Origin", adminOrigin);
    headers.set("Cookie", "__Host-aetheris-session=" + csrfTokenValue);
    headers.set("X-Aetheris-Admin-Proxy", adminSecret);
    if (data !== undefined) headers.set("X-CSRF-Token", csrf);
  }
  return worker.fetch(new Request((admin ? adminOrigin : origin) + path, {
    method: data === undefined ? "GET" : "POST", headers,
    body: data === undefined ? undefined : data instanceof FormData ? data : JSON.stringify(data),
  }), env);
}

async function ok<T>(response: Response, status = 200) {
  const text = await response.text();
  expect(response.status, text).toBe(status);
  return JSON.parse(text) as T;
}
function admin(path: string, data?: unknown) { return call(platformPath + path, data, undefined, true); }
async function submit(name = solution.name, patch = {}) {
  return ok<CreatedReceipt>(await call("/api/requests", {
    a: { ...solution, name, ...patch }, b: water, conditions: "",
  }), 201);
}
async function affiliate(receipt: CreatedReceipt, token = viewerToken) {
  return ok(await call(ws + "/affiliate", { id: receipt.id, receipt: receipt.trackingToken }, token));
}
function approve(id: string, classification = "Insufficient information") {
  const runId = randomUUID();
  const now = new Date().toISOString();
  db.prepare("INSERT INTO public_agent_runs(id,request_id,status,started_at,lease_until) VALUES(?,?,'running',?,?)").run(runId, id, now, now);
  db.prepare("UPDATE public_agent_runs SET status='completed', finished_at=? WHERE id=?").run(now, runId);
  db.prepare(`INSERT INTO public_review_decisions(id,request_id,run_id,reviewer_id,decision,notes,approved_result_json,created_at)
    VALUES (?,?,?,'reviewer','Approved','reviewed',?,?)`).run(randomUUID(), id, runId, JSON.stringify({
    classification, conditions: "Applicability is limited to reviewed conditions.",
    hazards: [], incompatibilities: classification === "Incompatible" ? ["Reviewed incompatibility"] : [],
    storage: "", container: "", limitations: ["Model limitations"],
    sources: [{ title: "Reviewed reference", url: "https://pubchem.ncbi.nlm.nih.gov/compound/962" }], reviewedAt: now,
  }), now);
}
const changes = (expectedId = 0) => ({ key: randomUUID(), expectedId });
const report = (receipt: CreatedReceipt, payload: unknown) => call(base + "/operations/" + receipt.id + "/report", payload, receipt.trackingToken);
const operation = (receipt: CreatedReceipt) => base + "/operations/" + receipt.id;
const caseFor = (x: number, y: number, record = "fixture") => ({
  baseline: [{ amount: x, evidence: record + " baseline" }], actual: [{ amount: y, evidence: record + " actual" }],
});
const financial = { purchase: caseFor(10, 0, "purchase"), disposal: caseFor(5, 0, "disposal"), handling: caseFor(0, 20, "handling"),
  treatment: caseFor(0, 2, "treatment"), recovery: caseFor(0, 0, "recovery") };
const action = (kind: string, q?: number, materialId?: string) => ({ kind, date: new Date().toISOString().slice(0, 10),
  quantity: q === undefined ? undefined : { value: q, unit: "mL" }, materialId, side: materialId ? "A" : undefined });
async function verify(receipt: CreatedReceipt, impact: OperationImpact, scenario?: unknown, extra = {}) {
  return call(ws + "/operations/" + receipt.id + "/review", { ...changes(impact.current?.id), decision: "verify", reason: "Qualified review of activity records",
    evidenceReference: impact.current?.activities.some(({ kind }) => kind !== "no-action") ? "operation/" + receipt.id : undefined,
    ...(scenario ? { scenario, realizedEvidence: "Invoice and activity evidence" } : {}), ...extra }, reviewerToken);
}
async function formulation(overrides = {}) {
  return (await ok<{ id: string }>(await call(ws + "/chemicals", {
    nameEn: "Sodium chloride solution", nameAr: "محلول كلوريد الصوديوم", cas: "7647-14-5", formula: "NaCl",
    concentration: "0.1 mol/L", solvent: "Water", physicalState: "Liquid", formulation: "Supplier label lot A",
    source: "https://pubchem.ncbi.nlm.nih.gov/compound/5234", verified: true, ...overrides,
  }, tenantToken), 201)).id;
}
const outcome = (token = reviewerToken) => call(ws + "/overview", undefined, token).then((response) => ok<ImpactOverview>(response));

describe("sustainability reference and tenant access", () => {
  it("enforces the stricter rate budget for profile creation, redemption and original PDF upload", async () => {
    const calls: string[] = [];
    env.SUBMISSION_LIMIT = { limit: ({ key }) => { calls.push(key); return Promise.resolve({ success: false }); } };
    expect((await call(base + "/profile/create", {})).status).toBe(429);
    expect((await call(ws + "/redeem", {})).status).toBe(429);
    expect((await call(ws + "/sds", {}, secondManagerToken)).status).toBe(429);
    expect((await call(ws + "/sds", undefined, secondManagerToken)).status).toBe(200);
    expect(new Set(calls).size).toBe(3);
    expect(calls.join(" ")).not.toContain(secondManagerToken);
  });

  it("shares neither reference nor workspace request budgets with public receipt tracking", async () => {
    const keys = new Set<string>();
    env.TRACKING_LIMIT = {
      limit: ({ key }) => {
        if (keys.has(key)) return Promise.resolve({ success: false });
        keys.add(key);
        return Promise.resolve({ success: true });
      },
    };
    expect((await call(base + "/chemicals")).status).toBe(200);
    expect((await call(base + "/chemicals")).status).toBe(429);
    expect((await call(ws + "/overview", undefined, viewerToken)).status).toBe(200);
    const receipt = await submit();
    expect((await call("/api/requests/" + receipt.id, undefined, receipt.trackingToken)).status).toBe(200);
  });

  it("matches all 25 supplied numerical rows with exact source page, no inferred price split, no verified rates", async () => {
    const cost = [6, 8, 10, 7, 8, 5, 6, 6, 12, 14, 15, 14, 18, 22, 25, 24, 12, 16, 7, 45, 20, 40, 10, 38, 20];
    const carbon = [.10, .15, .25, .10, .20, .08, .08, .15, .45, .55, .60, .50, .70, .75, .90, .85, .25, .35, .30, 1.50, .80, 1.80, .30, 1.70, .85];
    const cas = ["7647-01-0","7664-93-9","7697-37-2","7664-38-2","64-19-7","1310-73-2","1310-58-3","1336-21-6","64-17-5",
      "67-56-1","67-64-1","67-63-0","110-54-3","60-29-7","67-66-3","75-09-2","7722-84-1","7722-64-7","7681-52-9","7761-88-8",
      "7758-98-7","7778-50-9","7705-08-0","10099-74-8","50-00-0"];
    const rows = db.prepare(`SELECT c.cas, c.name_ar, c.name_en, c.status, c.formula, p.kind, p.value AS cost, f.value AS carbon,
      json_extract(c.provenance_json, '$.row') AS row, json_extract(c.provenance_json, '$.page') AS page,
      p.status AS priceStatus, f.status AS carbonStatus, f.boundary, f.stage
      FROM chemical_references c JOIN chemical_price_versions p ON p.chemical_id=c.id
      JOIN carbon_factor_versions f ON f.chemical_id=c.id ORDER BY row`).all();
    expect(rows).toHaveLength(25);
    rows.forEach((row, i) => {
      expect(row).toMatchObject({ cas: cas[i], cost: cost[i], carbon: carbon[i], row: i + 1,
        page: i < 2 ? 1 : i < 10 ? 2 : i < 18 ? 3 : 4,
        status: "unverified", kind: "combined", priceStatus: "unverified", carbonStatus: "unverified", boundary: null, stage: null });
      expect(row.name_ar).toMatch(/[\u0600-\u06ff]/);
      expect(row.name_en).toMatch(/[A-Za-z]/);
      expect(row.formula).toBeTruthy();
    });
    const arabic = await ok<{ chemicals: CatalogChemical[] }>(await call(base + "/chemicals?q=" + encodeURIComponent("نترات الفضة")));
    expect(arabic.chemicals.map((x) => x.cas)).toEqual(["7761-88-8"]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("redeems single-use invitations atomically and rejects unauthorized dashboard and cross-tenant receipt access", async () => {
    expect((await call(ws + "/overview")).status).toBe(401);
    expect((await call(platformPath + "/overview")).status).toBe(403);
    expect((await call(ws + "/memberships", { institutionId: "uni-b", role: "viewer" }, tenantToken)).status).toBe(403);
    const invitation = await ok<{ id: string; invitation: string }>(await admin("/memberships", { institutionId: "uni-a", labId: "lab-a", role: "viewer" }), 201);
    const redeemed = await Promise.all([
      call(ws + "/redeem", { invitation: invitation.invitation }), call(ws + "/redeem", { invitation: invitation.invitation }),
    ]);
    expect(redeemed.map((x) => x.status).sort()).toEqual([201, 404]);
    const session = await redeemed.find((x) => x.status === 201)!.json() as { token: string };
    const receipt = await submit();
    await affiliate(receipt, session.token);
    expect((await call(ws + "/affiliate", { id: receipt.id, receipt: receipt.trackingToken, labId: "lab-b" }, session.token)).status).toBe(403);
    expect((await call(ws + "/operations/" + receipt.id, undefined, otherToken)).status).toBe(404);
    const view = await ok<ImpactOverview>(await call(ws + "/overview", undefined, session.token));
    expect(view.totals.assessments).toBe(1);
    expect((await ok<ImpactOverview>(await call(ws + "/overview", undefined, otherToken))).totals.assessments).toBe(0);
    await ok(await admin("/memberships/revoke", { id: invitation.id }));
    expect((await call(ws + "/overview", undefined, session.token)).status).toBe(401);
  });

  it("scopes departments, labs, pagination anchors and privileged resources on the server", async () => {
    db.prepare("INSERT INTO institution_departments VALUES ('dept-a2','uni-a','قسم مختلف','Other department')").run();
    db.prepare("INSERT INTO institution_labs VALUES ('lab-a2','uni-a','dept-a2','مختبر مختلف','Other lab')").run();
    const invitation = await ok<{ invitation: string }>(await call(ws + "/memberships", {
      institutionId: "uni-a", labId: "lab-a2", role: "viewer",
    }, tenantToken), 201);
    const sibling = await ok<{ token: string }>(await call(ws + "/redeem", { invitation: invitation.invitation }), 201);
    const first = await submit("Scoped study A");
    const second = await submit("Scoped study B");
    await affiliate(first);
    await affiliate(second, sibling.token);
    approve(first.id);
    approve(second.id);
    expect((await call(ws + "/operations/" + first.id, undefined, sibling.token)).status).toBe(404);
    expect((await call(ws + "/operations/" + first.id + "/review", {}, sibling.token)).status).toBe(404);
    expect((await call(ws + "/operations/" + second.id + "/estimate", {}, sibling.token)).status).toBe(403);
    expect((await call(ws + "/memberships", { institutionId: "uni-a", role: "institution-admin" }, sibling.token)).status).toBe(403);
    expect((await call(ws + "/audit", undefined, sibling.token)).status).toBe(403);
    expect((await call(ws + "/affiliate", { id: first.id, receipt: first.trackingToken, labId: "lab-a" }, sibling.token)).status).toBe(403);
    const foreignCursor = await ok<ImpactOverview>(await call(ws + "/overview?after=" + first.id, undefined, sibling.token));
    const unknownCursor = await ok<ImpactOverview>(await call(ws + "/overview?after=" + randomUUID(), undefined, sibling.token));
    expect(foreignCursor.log).toEqual(unknownCursor.log);
    expect(foreignCursor.log).toEqual([]);
    expect((await ok<ImpactOverview>(await call(ws + "/overview?department=dept-a2", undefined, viewerToken))).totals.assessments).toBe(0);
    expect((await ok<ImpactOverview>(await call(ws + "/overview?department=dept-a2", undefined, tenantToken))).log.map(({ id }) => id)).toEqual([second.id]);
    expect(JSON.stringify(await ok(await call(ws + "/directory", undefined, sibling.token)))).not.toContain("dept-a\"");
    const wrongOrigin = await worker.fetch(new Request(origin + ws + "/overview", {
      headers: { Origin: "https://other.example.test", Authorization: "Bearer " + sibling.token },
    }), env);
    expect(wrongOrigin.status).toBe(403);
    const response = await call(ws + "/identity", undefined, sibling.token);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).not.toContain(sibling.token);
  });

  it("keeps global invoice references private from institutional administrators", async () => {
    const material = await ok<{ id: string }>(await admin("/chemicals", { nameEn: "Public reference", nameAr: "مرجع عام",
      cas: "7647-14-5", formula: "NaCl", concentration: "0.1 mol/L", solvent: "Water",
      formulation: "Supplier label", verified: true, source: "https://example.test/material" }), 201);
    const price = { chemicalId: material.id, kind: "purchase", value: 10, unit: "L", packageQuantity: 1,
      verified: true, date: actualDate, invoice: "Global private test invoice" };
    await ok(await admin("/versions/price", price), 201);
    await ok(await call(ws + "/versions/price", { ...price, invoice: "Institution A private test invoice" }, tenantToken), 201);
    expect(await (await call(base + "/chemicals/" + material.id)).text()).not.toContain("private test invoice");
    const own = await (await call(ws + "/chemicals/" + material.id, undefined, tenantToken)).text();
    expect(own).toContain("Institution A private test invoice");
    expect(own).not.toContain("Global private test invoice");
    expect(await (await call(ws + "/chemicals/" + material.id, undefined, otherToken)).text()).not.toContain("private test invoice");
  });

  it("gates approval, links older receipts to a revocable private profile and uses no identifier as a credential", async () => {
    const receipt = await submit();
    const out = await ok<{ token: string }>(await call(base + "/profile/create", {}), 201);
    expect(out.token).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(db.prepare("SELECT * FROM impact_profiles").get())).not.toContain(out.token);
    expect((await call(base + "/personal", undefined, receipt.trackingToken)).status).toBe(401);
    expect((await call(base + "/profile/link", { id: receipt.id, receipt: "0".repeat(64) }, out.token)).status).toBe(404);
    await ok(await call(base + "/profile/link", { id: receipt.id, receipt: receipt.trackingToken }, out.token));
    expect((await call(operation(receipt), undefined, receipt.trackingToken)).status).toBe(404);
    expect((await report(receipt, { ...changes(), activities: [action("no-action")] })).status).toBe(404);
    approve(receipt.id);
    expect((await call(operation(receipt) + "?token=" + receipt.trackingToken)).status).toBe(404);
    const summary = await ok<OperationImpact>(await call(operation(receipt), undefined, receipt.trackingToken));
    expect(summary.assessed).toMatchObject({ liters: 0.75, kilograms: null });
    expect(summary.estimate).toBeNull();
    await ok(await call(base + "/profile/revoke", {}, out.token));
    expect((await call(base + "/personal", undefined, out.token)).status).toBe(401);
    expect((await call(operation(receipt), undefined, receipt.trackingToken)).status).toBe(200);
  });
});

describe("reviewed calculations and outcomes", () => {
  it("caps measured actions by assessed side and dimension, and allows separate segregation", async () => {
    const receipt = await submit();
    await affiliate(receipt);
    approve(receipt.id);
    for (const [activities, reason] of [
      [[{ ...action("returned", 251), side: "A" }], "ACTIVITY_QUANTITY_UNSUPPORTED"],
      [[{ ...action("returned", 1), quantity: { value: 1, unit: "g" } }], "ACTIVITY_QUANTITY_UNSUPPORTED"],
      [[{ ...action("returned", 150), side: "A" }, { ...action("disposal", 120), side: "A" }], "ACTIVITY_QUANTITY_OVERLAP"],
      [[{ ...action("returned", 150), side: "A", date: actualDate }], "INVALID_ACTION_DATE"],
    ] as const) {
      const response = await report(receipt, { ...changes(), activities });
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: reason });
    }
    expect((await report(receipt, { ...changes(), activities: [action("returned", -1)] })).status).toBe(400);
    const pending = await ok<OperationImpact>(await report(receipt, { ...changes(),
      activities: [{ ...action("disposal", 250), side: "A" }, { ...action("segregation", 250), side: "A" }],
    }));
    expect((await outcome()).totals).toMatchObject({ pending: 1, confirmedActions: 0, authorizedDisposal: { value: null, covered: 0 } });
    const missingEvidence = await verify(receipt, pending, undefined, { evidenceReference: undefined });
    expect(await missingEvidence.json()).toEqual({ error: "ACTION_EVIDENCE_REQUIRED" });
    await ok(await verify(receipt, pending));
    expect((await outcome()).totals).toMatchObject({ pending: 0, confirmedActions: 1, assessed: { value: 0.75, covered: 1 },
      authorizedDisposal: { value: 0.25, covered: 1 }, segregated: { value: 0.25, covered: 1 }, preserved: { value: null, covered: 0 } });
  });

  it("matches verified rates to assessed formulation and density conditions", async () => {
    const exact = await formulation();
    const molal = await formulation({ concentration: "0.1 m" });
    const differentSolvent = await formulation({ solvent: "Ethanol" });
    const wrongState = await formulation({ physicalState: "Solid" });
    const receipt = await submit();
    await affiliate(receipt);
    approve(receipt.id);
    const reportWith = (materialId: string) => report(receipt, { ...changes(), activities: [action("returned", 100, materialId)] });
    for (const id of [molal, differentSolvent, wrongState]) {
      expect(await (await reportWith(id)).json()).toEqual({ error: "ACTIVITY_FORMULATION_MISMATCH" });
    }
    expect(await (await report(receipt, { ...changes(), activities: [{ ...action("returned", 100, exact), side: undefined }] })).json())
      .toEqual({ error: "ACTIVITY_FORMULATION_REQUIRED" });
    const pending = await ok<OperationImpact>(await reportWith(exact));
    const price = { chemicalId: exact, currency: "JOD", kind: "purchase", packageQuantity: 1, unit: "kg",
      verified: true, value: 40, invoice: "Invoice unit price", date: actualDate };
    const verifiedPrice = await ok<{ id: string }>(await call(ws + "/versions/price", price, tenantToken), 201);
    const unverifiedPrice = await ok<{ id: string }>(await call(ws + "/versions/price", { ...price, verified: false }, tenantToken), 201);
    const density = { chemicalId: exact, kgPerLiter: 1.05, state: "Liquid", temperatureC: 25,
      source: "https://example.test/source", conditions: "Fixture at atmospheric pressure" };
    const valid = await ok<{ id: string }>(await call(ws + "/versions/density", density, tenantToken), 201);
    const wrongTemp = await ok<{ id: string }>(await call(ws + "/versions/density", { ...density, temperatureC: 30 }, tenantToken), 201);
    const scenarioWith = (densityVersionId: string, value = 100, versionId = verifiedPrice.id) => ({ ...scenarioMeta,
      beneficiary: "institution", financial: {
        purchase: { baseline: [{ materialId: exact, densityVersionId, versionId, quantity: { value, unit: "mL" } }], actual: caseFor(0, 0).actual },
      },
    });
    expect(await (await verify(receipt, pending, scenarioWith(wrongTemp.id))).json()).toEqual({ error: "SCENARIO_FORMULATION_OR_QUANTITY" });
    expect(await (await verify(receipt, pending, scenarioWith(valid.id, 200))).json()).toEqual({ error: "SCENARIO_ACTION_QUANTITY" });
    expect(await (await verify(receipt, pending, scenarioWith(valid.id, 100, unverifiedPrice.id))).json()).toEqual({ error: "SCENARIO_EVIDENCE_UNAVAILABLE" });
    const saved = await ok<OperationImpact>(await verify(receipt, pending, scenarioWith(valid.id)));
    expect(saved.current?.calculation?.financial.purchase.difference).toBe(4.2);
    expect(saved.current?.calculation?.net.difference).toBeNull();
    expect((await outcome()).totals.purchase).toEqual({ value: 4.2, covered: 1 });
  });

  it("verifies only stage-exclusive carbon factors and exports verified activity estimates separately", async () => {
    const materialId = await formulation();
    const carbon = { chemicalId: materialId, value: 3, unit: "L", stage: "manufacturing", geography: "JO",
      boundary: "Factory process at stated conditions", source: "https://example.test/source", publicationDate: actualDate,
      methodology: "Measured process with a defined factory boundary", uncertainty: "Fixture uncertainty", verified: true };
    expect((await call(ws + "/versions/carbon", carbon, tenantToken)).status).toBe(400);
    const unsupported = await ok<{ id: string }>(await call(ws + "/versions/carbon", { ...carbon, verified: false }, tenantToken), 201);
    const supported = await ok<{ id: string }>(await call(ws + "/versions/carbon", { ...carbon, stageExclusive: true }, tenantToken), 201);
    const receipt = await submit();
    await affiliate(receipt);
    approve(receipt.id, "Incompatible");
    expect((await outcome()).totals).toMatchObject({ incompatibilities: 1, prevention: 0 });
    const pending = await ok<OperationImpact>(await report(receipt, { ...changes(), activities: [action("returned", 250, materialId)] }));
    const noActivity = [{ zero: true, evidence: "Documented zero activity" }];
    const zeroes = { baseline: noActivity, actual: noActivity };
    const scenario = (versionId: string) => ({ ...scenarioMeta, emissions: {
      manufacturing: { baseline: [{ materialId, versionId, quantity: { value: 0.25, unit: "L" } }], actual: noActivity },
      transportation: zeroes, treatment: zeroes, disposal: zeroes,
    } });
    expect(await (await verify(receipt, pending, scenario(unsupported.id))).json()).toEqual({ error: "SCENARIO_EVIDENCE_UNAVAILABLE" });
    await ok(await verify(receipt, pending, scenario(supported.id)));
    expect((await outcome()).totals).toMatchObject({ verifiedCarbon: { value: 0.75, covered: 1 }, carbon: { value: null, covered: 0 }, prevention: 0 });
    const csv = await call(ws + "/overview.csv", undefined, reviewerToken);
    const data = await csv.text();
    expect(data).toContain('"Estimated avoided kg CO2e from verified activity"');
    expect(data).toContain('"0.75","Blank cells are unavailable values. Emissions are modeled estimates."');
  });

  it("reserves evidence across concurrent approvals, rejects reuse, and preserves the first claim after cancellation", async () => {
    const records = [];
    for (const name of ["Claim one", "Claim two"]) {
      const receipt = await submit(name);
      await affiliate(receipt);
      approve(receipt.id);
      records.push({ receipt, pending: await ok<OperationImpact>(await report(receipt, { ...changes(), activities: [action("preserved", 100)] })) });
    }
    const replies = await Promise.all(records.map(({ receipt, pending }, i) =>
      verify(receipt, pending, undefined, { evidenceReference: i ? " register   88 " : "Register 88" })));
    expect(replies.map((response) => response.status).sort()).toEqual([200, 409]);
    const winner = replies.findIndex((response) => response.status === 200);
    const loser = 1 - winner;
    expect(await replies[loser].json()).toEqual({ error: "DUPLICATE_IMPACT_EVIDENCE" });
    const approved = await replies[winner].json() as OperationImpact;
    expect((await outcome()).totals).toMatchObject({ verified: 1, pending: 1, preserved: { value: 0.1, covered: 1 } });
    await ok(await call(ws + "/operations/" + records[winner].receipt.id + "/review",
      { ...changes(approved.current?.id), decision: "cancel", reason: "Evidence withdrawn" }, reviewerToken));
    expect((await outcome()).totals).toMatchObject({ verified: 0, pending: 1, preserved: { value: null, covered: 0 } });
    expect((await verify(records[loser].receipt, records[loser].pending, undefined, { evidenceReference: "register 88" })).status).toBe(409);
  });

  it("deduplicates reports, handles concurrent review, corrections and cancellation, and builds scoped aggregates", async () => {
    const receipt = await submit("=1+1");
    await affiliate(receipt);
    approve(receipt.id, "Incompatible");
    const scenario = { ...scenarioMeta, beneficiary: "institution", financial };
    const estimate = await ok<OperationImpact>(await call(ws + "/operations/" + receipt.id + "/estimate", { ...changes(), scenario }, reviewerToken));
    expect(estimate.estimate?.net.difference).toBe(-7);
    const input = { ...changes(estimate.current?.id), activities: [action("segregation", 250), action("preserved", 250), action("abandoned")] };
    const replies = await Promise.all([report(receipt, input), report(receipt, input)]);
    const states = await Promise.all(replies.map((reply) => ok<OperationImpact>(reply)));
    expect(states[0].current).toEqual(states[1].current);
    expect(states[0].events.map((e) => e.state)).toEqual(["pending-verification", "action-reported", "estimated"]);
    expect((await report(receipt, { ...input, activities: [action("no-action")] })).status).toBe(409);
    expect((await call(ws + "/operations/" + receipt.id + "/review", { ...changes(states[0].current?.id), decision: "verify", reason: "Viewer" }, viewerToken)).status).toBe(403);
    expect((await verify(receipt, states[0], { ...scenario, wasteBaseline: { value: 1, unit: "L" }, wasteActual: { value: 0, unit: "L" } })).status).toBe(422);
    const reviews = await Promise.all([verify(receipt, states[0], scenario), verify(receipt, states[0], scenario)]);
    expect(reviews.map((x) => x.status).sort()).toEqual([200, 409]);
    const saved = await reviews.find((x) => x.status === 200)!.json() as OperationImpact;
    const overview = await ok<ImpactOverview>(await call(ws + "/overview?period=quarter&action=segregation&status=verified", undefined, reviewerToken));
    expect(overview.totals).toMatchObject({ approved: 1, verified: 1, prevention: 1, segregated: { value: 0.25, covered: 1 },
      avoided: { value: null, covered: 0 }, estimatedFinancial: { value: -7, covered: 1 }, verifiedFinancial: { value: -7, covered: 1 } });
    expect(overview.series).toHaveLength(1);
    expect(overview.chemicals.length).toBeGreaterThan(0);
    const csv = await call(ws + "/overview.csv?lang=ar", undefined, reviewerToken);
    expect(csv.headers.get("Content-Type")).toContain("text/csv");
    const csvText = await csv.text();
    expect(csvText).toContain("العملية");
    expect(csvText).toContain("'=1+1");
    const correction = await ok<OperationImpact>(await call(ws + "/operations/" + receipt.id + "/review", {
      ...changes(saved.current?.id), decision: "correct", reason: "Corrected quantity", activities: [action("segregation", 100)],
      evidenceReference: "operation/" + receipt.id,
    }, reviewerToken));
    expect(correction.current?.state).toBe("corrected");
    const after = await ok<ImpactOverview>(await call(ws + "/overview", undefined, reviewerToken));
    expect(after.totals).toMatchObject({ verified: 1, prevention: 0, segregated: { value: 0.1, covered: 1 }, verifiedFinancial: { value: null, covered: 0 } });
    await ok(await call(ws + "/operations/" + receipt.id + "/review", { ...changes(correction.current?.id), decision: "cancel", reason: "Withdrawn evidence" }, reviewerToken));
    const cancelled = await ok<ImpactOverview>(await call(ws + "/overview", undefined, reviewerToken));
    expect(cancelled.totals).toMatchObject({ verified: 0, segregated: { value: null, covered: 0 } });
    expect(() => db.prepare("UPDATE impact_events SET reason = 'rewrite' WHERE id = ?").run(saved.current!.id)).toThrow(/append-only/);
    db.prepare("INSERT INTO public_request_management_events(request_id,action,actor,created_at) VALUES(?,'delete','fixture',?)").run(receipt.id, actualDate);
    expect((await call(operation(receipt), undefined, receipt.trackingToken)).status).toBe(404);
    expect(db.prepare("SELECT count(*) AS count FROM impact_events").get()?.count).toBe(0);
  });

  it("supports clarification, rejection, no action and requesting cancellation while preserving the scientific decision", async () => {
    const receipt = await submit();
    await affiliate(receipt);
    approve(receipt.id);
    const pending = await ok<OperationImpact>(await report(receipt, { ...changes(), activities: [action("no-action")] }));
    expect((await verify(receipt, pending, { ...scenarioMeta, financial })).status).toBe(422);
    const clarified = await ok<OperationImpact>(await verify(receipt, pending, undefined, { decision: "clarify" }));
    expect(clarified.current).toMatchObject({ state: "pending-verification", reason: "Qualified review of activity records" });
    const second = await ok<OperationImpact>(await report(receipt, { ...changes(clarified.current?.id), activities: [action("no-action")] }));
    const rejection = await ok<OperationImpact>(await verify(receipt, second, undefined, { decision: "reject" }));
    expect(rejection.current?.state).toBe("rejected");
    const third = await ok<OperationImpact>(await report(receipt, { ...changes(rejection.current?.id), activities: [action("no-action")] }));
    const cancelled = await ok<OperationImpact>(await call(operation(receipt) + "/withdraw", changes(third.current?.id), receipt.trackingToken));
    expect(cancelled.current?.state).toBe("cancelled");
    const fourth = await ok<OperationImpact>(await report(receipt, { ...changes(cancelled.current?.id), activities: [action("no-action")] }));
    const confirmed = await ok<OperationImpact>(await verify(receipt, fourth));
    expect(confirmed.current?.state).toBe("verified");
    const result = await ok<ImpactOverview>(await call(ws + "/overview", undefined, reviewerToken));
    expect(result.totals).toMatchObject({ verified: 1, confirmedActions: 0, prevention: 0, verifiedFinancial: { value: null, covered: 0 }, avoided: { value: null, covered: 0 } });
    expect(db.prepare("SELECT decision FROM public_review_decisions WHERE request_id=?").get(receipt.id)?.decision).toBe("Approved");
  });

  it("versions institution prices without rewriting stored estimates and blocks provisional rate use", async () => {
    const chemical = { nameEn: "Sodium chloride solution", nameAr: "محلول كلوريد الصوديوم", cas: "7647-14-5", formula: "NaCl",
      concentration: "0.1 mol/L", solvent: "Water", formulation: "Supplier label, lot A", source: "https://pubchem.ncbi.nlm.nih.gov/compound/5234", verified: true };
    const { id } = await ok<{ id: string }>(await call(ws + "/chemicals", chemical, tenantToken), 201);
    expect((await call(base + "/chemicals/" + id)).status).toBe(404);
    expect((await call(ws + "/chemicals/" + id, undefined, otherToken)).status).toBe(404);
    const price = { chemicalId: id, currency: "JOD", kind: "purchase", packageQuantity: 1, unit: "L", verified: true,
      value: 10, invoice: "invoice-v1", date: actualDate };
    const version = await ok<{ id: string }>(await call(ws + "/versions/price", price, tenantToken), 201);
    const receipt = await submit();
    await affiliate(receipt);
    approve(receipt.id);
    const scenario = { ...scenarioMeta, beneficiary: "institution", financial: {
      ...financial, purchase: { baseline: [{ materialId: id, versionId: version.id, quantity: { value: 0.25, unit: "L" } }], actual: caseFor(0, 0).actual },
    } };
    expect((await ok<OperationImpact>(await call(ws + "/operations/" + receipt.id + "/estimate", { ...changes(), scenario }, reviewerToken))).estimate?.net.difference).toBe(-14.5);
    await ok(await call(ws + "/versions/price", { ...price, supersedes: version.id, value: 30, invoice: "invoice-v2" }, tenantToken), 201);
    const fetched = await ok<OperationImpact>(await call(operation(receipt), undefined, receipt.trackingToken));
    expect(fetched.estimate?.net.difference).toBe(-14.5);
    expect(JSON.stringify(fetched)).not.toContain("invoice-v1");
    expect(db.prepare("SELECT count(*) AS n FROM chemical_price_versions WHERE chemical_id = ?").get(id)?.n).toBe(2);
    const provisional = await ok<OperationImpact["estimate"]>(await call(base + "/calculator", {
      ...scenarioMeta, financial: { purchase: { baseline: [{ materialId: "reference-ethanol", versionId: "reference-ethanol-combined",
        quantity: { value: 1, unit: "L" } }], actual: caseFor(0, 0).actual } },
    }));
    expect(provisional?.financial.purchase.difference).toBeNull();
  });
});

describe("scoped laboratory tools", () => {
  it("protects inventory, applies one verified stock return and preserves the movements", async () => {
    const { id: materialId } = await ok<{ id: string }>(await call(ws + "/chemicals", { nameEn: "Sodium chloride solution",
      nameAr: "محلول الملح", cas: "7647-14-5", formulation: "stock solution", solvent: "Water", concentration: "0.1 mol/L",
      verified: true, source: "https://pubchem.ncbi.nlm.nih.gov/compound/5234" }, tenantToken), 201);
    const payload = { chemicalId: materialId, labId: "lab-a", unit: "L", container: "a-1", location: "Approved storage" };
    expect((await call(ws + "/inventory", payload, viewerToken)).status).toBe(403);
    const item = await ok<{ id: string }>(await call(ws + "/inventory", payload, tenantToken), 201);
    expect((await call(ws + "/inventory/" + item.id, undefined, otherToken)).status).toBe(404);
    const receipt = await submit();
    await affiliate(receipt);
    approve(receipt.id);
    const pending = await ok<OperationImpact>(await report(receipt, { ...changes(), activities: [action("returned", 250, materialId)] }));
    const verified = await ok<OperationImpact>(await verify(receipt, pending));
    const endpoint = ws + "/inventory/" + item.id + "/movement";
    const motion = { key: randomUUID(), kind: "returned", requestId: receipt.id, impactEventId: verified.current?.id, reason: "Documented stock return" };
    expect((await call(endpoint, motion, tenantToken)).status).toBe(201);
    expect((await call(endpoint, motion, tenantToken)).status).toBe(200);
    expect((await call(endpoint, { ...motion, key: randomUUID() }, tenantToken)).status).toBe(409);
    const stock = await ok<{ item: { quantity: number }; movements: unknown[] }>(await call(ws + "/inventory/" + item.id, undefined, viewerToken));
    expect(stock.item.quantity).toBe(0.25);
    expect(stock.movements).toHaveLength(1);
  });

  it("compensates inventory once through correction and cancellation and retries a pending adjustment", async () => {
    const materialId = await formulation();
    const item = await ok<{ id: string }>(await call(ws + "/inventory", { chemicalId: materialId, labId: "lab-a", unit: "L",
      container: "audit-container", location: "Approved storage" }, tenantToken), 201);
    const root = ws + "/inventory/" + item.id;
    const stock = () => call(root, undefined, viewerToken).then((response) => ok<{
      item: { quantity: number }; movements: { kind: string }[]; reconciliations: { movementId: number; eventId: number; delta: number }[];
    }>(response));
    const receipt = await submit();
    await affiliate(receipt);
    approve(receipt.id);
    const pending = await ok<OperationImpact>(await report(receipt, { ...changes(), activities: [action("returned", 250, materialId)] }));
    const verified = await ok<OperationImpact>(await verify(receipt, pending));
    await ok(await call(root + "/movement", { key: randomUUID(), kind: "returned", requestId: receipt.id,
      impactEventId: verified.current?.id, reason: "Return record" }, tenantToken), 201);
    const manual = (kind: string, value: number) => call(root + "/movement", { key: randomUUID(), kind,
      quantity: { value, unit: "L" }, reason: "Stock record" }, tenantToken);
    await ok(await manual("consumed", 0.2), 201);
    const corrected = await ok<OperationImpact>(await call(ws + "/operations/" + receipt.id + "/review", {
      ...changes(verified.current?.id), decision: "correct", reason: "Correct recorded return",
      activities: [action("returned", 100, materialId)], evidenceReference: "operation/" + receipt.id,
    }, reviewerToken));
    const after = await stock();
    expect(after.item.quantity).toBeCloseTo(0.05);
    expect(after.reconciliations).toHaveLength(1);
    const { movementId, eventId, delta } = after.reconciliations[0];
    expect(delta).toBeCloseTo(-0.15);
    const retry = (who = tenantToken) => call(root + "/reconcile", { movementId, eventId }, who);
    expect((await retry(viewerToken)).status).toBe(403);
    expect((await retry(otherToken)).status).toBe(403);
    expect((await retry(foreignManagerToken)).status).toBe(404);
    expect((await retry()).status).toBe(409);
    await ok(await manual("received", 0.25), 201);
    const receipts = await Promise.all([retry(), retry()]);
    expect(receipts.map((response) => response.status)).toEqual([200, 200]);
    expect((await stock()).item.quantity).toBeCloseTo(0.15);
    expect((await stock()).reconciliations).toEqual([]);
    const cancellation = { ...changes(corrected.current?.id), decision: "cancel", reason: "Withdrawn evidence" };
    const reviewPath = ws + "/operations/" + receipt.id + "/review";
    await ok(await call(reviewPath, cancellation, reviewerToken));
    await ok(await call(reviewPath, cancellation, reviewerToken));
    const final = await stock();
    expect(final.item.quantity).toBeCloseTo(0.05);
    expect(final.movements.filter(({ kind }) => kind === "adjustment")).toHaveLength(2);
    expect((await outcome()).totals.preserved).toEqual({ value: null, covered: 0 });
  });

  it("stores original SDS privately, validates PDF signatures, and records a qualified decision", async () => {
    const fixture = new jsPDF().text("Fixture SDS", 20, 20).output("arraybuffer");
    const form = (pdf: BlobPart = fixture) => {
      const data = new FormData();
      data.set("pdf", new Blob([pdf], { type: "application/pdf" }), "fixture.pdf");
      data.set("metadata", JSON.stringify({ title: "Fixture SDS", labId: "lab-a", confirmed: true,
        candidates: [{ section: "hazards", page: 2, text: "Original page excerpt" }] }));
      return data;
    };
    expect((await call(ws + "/sds", form("not a PDF"), tenantToken)).status).toBe(400);
    expect((await call(ws + "/sds", form("%PDF-1.7\nOnly a header"), tenantToken)).status).toBe(400);
    const { id } = await ok<{ id: string }>(await call(ws + "/sds", form(), tenantToken), 201);
    expect((await call(ws + "/sds/" + id + "/file", undefined, otherToken)).status).toBe(404);
    expect((await call(ws + "/sds/" + id + "/file", undefined, viewerToken)).status).toBe(404);
    expect(await ok<{ documents: unknown[] }>(await call(ws + "/sds", undefined, viewerToken))).toMatchObject({ documents: [] });
    expect(await (await call(ws + "/sds", form(), secondManagerToken)).json()).toEqual({ error: "UPLOAD_CONFLICT" });
    expect((await call(ws + "/sds", form(), tenantToken)).status).toBe(200);
    expect((await call(ws + "/sds/" + id + "/review", { verified: true, reason: "Viewer" }, viewerToken)).status).toBe(403);
    await ok(await call(ws + "/sds/" + id + "/review", { verified: true, reason: "Qualified comparison to source pages" }, reviewerToken));
    const original = await call(ws + "/sds/" + id + "/file", undefined, viewerToken);
    expect(original.headers.get("Content-Type")).toBe("application/pdf");
    expect(original.headers.get("Cache-Control")).toBe("no-store");
    expect(original.headers.get("Content-Disposition")).toContain("attachment");
    expect(new Uint8Array(await original.arrayBuffer())).toEqual(new Uint8Array(fixture));
    expect(files.size).toBe(1);
  });

  it("keeps validated pair evidence tenant-scoped and renders an insufficient default", async () => {
    const pair = { a: "reference-ethanol", b: "reference-acetone", context: "storage" };
    const params = new URLSearchParams(pair);
    expect(await ok(await call(base + "/pairs?" + params))).toMatchObject({ assessment: "insufficient", requiresQualifiedReview: true });
    const input = { ...pair, finding: "insufficient", qualified: true, statement: "Review the product-specific source",
      conditions: "Test fixture for exact source conditions", title: "Reference", url: "https://pubchem.ncbi.nlm.nih.gov/compound/702" };
    expect((await call(ws + "/pairs", input, viewerToken)).status).toBe(403);
    expect(await (await call(ws + "/pairs", { ...input, finding: "conditional" }, reviewerToken)).json())
      .toEqual({ error: "PAIR_FORMULATION_REQUIRED" });
    await ok(await call(ws + "/pairs", input, reviewerToken), 201);
    const result = await ok<{ evidence: unknown[] }>(await call(ws + "/pairs?" + params, undefined, reviewerToken));
    expect(result.evidence).toHaveLength(1);
    expect(await ok(await call(ws + "/pairs?" + params, undefined, otherToken))).toMatchObject({ evidence: [] });
    expect(await ok(await call(ws + "/pairs?" + new URLSearchParams({ ids: pair.a + "," + pair.b, context: pair.context }), undefined, reviewerToken)))
      .toMatchObject({ pairs: [{ assessment: "insufficient" }] });
    const scoped = new URLSearchParams({ ...pair, lab: "lab-a" });
    expect((await call(ws + "/pairs?" + scoped, undefined, otherToken)).status).toBe(404);
    expect((await call(base + "/pairs?" + scoped)).status).toBe(404);
    expect(await ok(await admin("/pairs?" + scoped))).toMatchObject({ evidence: [{ statement: input.statement }] });
  });

  it("reuses mockable authoritative lookups and declines a model for a salt", async () => {
    const mock = vi.fn(async (input: string) => {
      if (!input.startsWith("https://pubchem.ncbi.nlm.nih.gov/")) throw new Error("Unexpected outbound call");
      return Response.json({ PropertyTable: { Properties: [{ CID: 5234, Title: "Sodium chloride", MolecularFormula: "ClNa",
        MolecularWeight: "58.44", ConnectivitySMILES: "[Na+].[Cl-]", Charge: 0 }] } });
    });
    vi.stubGlobal("fetch", mock);
    const search = await ok<{ compounds: unknown[] }>(await call(base + "/knowledge?q=5234"));
    expect(search.compounds).toHaveLength(1);
    expect((await call(base + "/knowledge/5234/3d")).status).toBe(404);
    expect(mock.mock.calls).toHaveLength(2);
  });
});

describe("migration and rollback compatibility", () => {
  it("upgrades a populated 0006 database while keeping receipts, reviews, login, archive and purge workflows usable", async () => {
    db.close();
    db = new DatabaseSync(":memory:");
    for (const migration of migrations.slice(0, 6)) db.exec(migration);
    env.DB = testDatabase(db);
    db.prepare("INSERT INTO admin_sessions(token_sha256, expires_at) VALUES (?, ?)")
      .run(createHmac("sha256", JSON.stringify(adminPassword)).update("session:" + csrfTokenValue).digest("hex"), Math.floor(Date.now() / 1000) + 3600);
    const approved = await submit("Historical documentation");
    const archived = await submit("Historical archive");
    const queued = await submit("Historical image and deletion");
    approve(approved.id);
    const manage = (action: string, id: string) => call("/api/admin/requests/manage", { action, ids: [id] }, undefined, true);
    await ok(await manage("archive", archived.id));
    const legacy = db.prepare("SELECT input_json FROM public_requests WHERE id = ?").get(approved.id);
    const snapshot = db.prepare("SELECT approved_result_json FROM public_review_decisions WHERE request_id = ?").get(approved.id);
    const storageKey = "requests/historical/synthetic-photo";
    db.prepare(`INSERT INTO public_request_images(id, request_id, solution, object_key, mime_type, size_bytes)
      VALUES (?,?,'A',?,'image/png',1)`).run(randomUUID(), queued.id, storageKey);
    const prior = await ok(await call("/api/requests/" + approved.id, undefined, approved.trackingToken));
    for (const migration of migrations.slice(6)) db.exec(migration);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.prepare("SELECT input_json FROM public_requests WHERE id = ?").get(approved.id)).toEqual(legacy);
    expect(db.prepare("SELECT approved_result_json FROM public_review_decisions WHERE request_id = ?").get(approved.id)).toEqual(snapshot);
    expect(await ok(await call("/api/requests/" + approved.id, undefined, approved.trackingToken))).toEqual(prior);
    expect(await ok(await call("/api/admin/session", undefined, undefined, true))).toMatchObject({ csrfToken: csrf });
    expect(await ok(await call("/api/admin/requests/" + approved.id, undefined, undefined, true))).toMatchObject({ status: "Approved" });
    expect(await ok(await call("/api/admin/requests?archived=true", undefined, undefined, true))).toMatchObject({
      requests: [{ id: archived.id }],
    });
    await ok(await manage("restore", archived.id));
    const restored = await ok<{ requests: { id: string }[] }>(await call("/api/admin/requests", undefined, undefined, true));
    expect(restored.requests.map(({ id }) => id)).toContain(archived.id);
    await ok(await manage("delete", queued.id));
    expect((await call("/api/requests/" + queued.id, undefined, queued.trackingToken)).status).toBe(404);
    expect(db.prepare("SELECT object_key FROM public_request_image_deletions").get()?.object_key).toBe(storageKey);
    const impact = await ok<OperationImpact>(await call(operation(approved), undefined, approved.trackingToken));
    expect(impact).toMatchObject({ current: null, estimate: null, assessed: { liters: 0.75, kilograms: null } });
  });

  it("preserves 0009-era snapshots byte-for-byte and excludes them from current totals until re-reviewed", async () => {
    const receipt = await submit();
    await affiliate(receipt);
    approve(receipt.id);
    const scenario = { ...scenarioMeta, beneficiary: "institution", financial };
    const estimate = await ok<OperationImpact>(await call(ws + "/operations/" + receipt.id + "/estimate", { ...changes(), scenario }, reviewerToken));
    const historical = JSON.stringify({ result: { ...estimate.estimate, formulaVersion: "baseline-actual/1" } });
    const { lastInsertRowid } = db.prepare(`INSERT INTO impact_events(request_id, state, actor, created_at, activities_json, calculation_json)
      VALUES (?, 'verified', 'legacy reviewer', ?, ?, ?)`).run(receipt.id, new Date().toISOString(), JSON.stringify([action("preserved", 100)]), historical);
    const current = await ok<OperationImpact>(await call(operation(receipt), undefined, receipt.trackingToken));
    expect(current.current).toMatchObject({ reviewRequired: true, calculation: { formulaVersion: "baseline-actual/1", net: { difference: -7 } } });
    expect((await outcome()).totals).toMatchObject({ needsRecheck: 1, verified: 0,
      verifiedFinancial: { covered: 0, value: null }, preserved: { covered: 0, value: null } });
    await ok(await call(ws + "/operations/" + receipt.id + "/review", {
      ...changes(current.current?.id), decision: "correct", reason: "Checked the original records",
      activities: [action("preserved", 100)], evidenceReference: "legacy-asset/1",
    }, reviewerToken));
    expect(db.prepare("SELECT calculation_json FROM impact_events WHERE id = ?").get(lastInsertRowid)?.calculation_json).toBe(historical);
    expect((await outcome()).totals).toMatchObject({ needsRecheck: 0, verified: 1, preserved: { covered: 1, value: 0.1 } });
  });
});
