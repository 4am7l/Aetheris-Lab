import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
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
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const solution = { ...blankSolution, name: "Sodium chloride", cas: "7647-14-5", formula: "NaCl", quantity: "250", quantityUnit: "mL" };
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
async function submit(name = solution.name) {
  return ok<CreatedReceipt>(await call("/api/requests", {
    a: { ...solution, name }, b: { ...solution, name: "Water", quantity: "0.5", quantityUnit: "L" }, conditions: "",
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
const caseFor = (x: number, y: number) => ({ baseline: [{ amount: x, evidence: "baseline" }], actual: [{ amount: y, evidence: "actual" }] });
const financial = { purchase: caseFor(10, 0), disposal: caseFor(5, 0), handling: caseFor(0, 20), treatment: caseFor(0, 2), recovery: caseFor(0, 0) };
const action = (kind: string, q?: number, materialId?: string) => ({ kind, date: actualDate, quantity: q === undefined ? undefined : { value: q, unit: "mL" }, materialId });
async function verify(receipt: CreatedReceipt, impact: OperationImpact, scenario?: unknown, extra = {}) {
  return call(ws + "/operations/" + receipt.id + "/review", { ...changes(impact.current?.id), decision: "verify", reason: "Qualified review of activity records",
    ...(scenario ? { scenario, realizedEvidence: "Invoice and activity evidence" } : {}), ...extra }, reviewerToken);
}

describe("sustainability reference and tenant access", () => {
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
  it("deduplicates reports, handles concurrent review, corrections and cancellation, and builds scoped aggregates", async () => {
    const receipt = await submit("=1+1");
    await affiliate(receipt);
    approve(receipt.id, "Incompatible");
    const scenario = { ...scenarioMeta, beneficiary: "institution", financial };
    const estimate = await ok<OperationImpact>(await call(ws + "/operations/" + receipt.id + "/estimate", { ...changes(), scenario }, reviewerToken));
    expect(estimate.estimate?.net.difference).toBe(-7);
    const input = { ...changes(estimate.current?.id), activities: [action("segregation", 250), action("abandoned")] };
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
    expect(result.totals).toMatchObject({ verified: 1, prevention: 0, verifiedFinancial: { value: null, covered: 0 }, avoided: { value: null, covered: 0 } });
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
      ...financial, purchase: { baseline: [{ materialId: id, versionId: version.id, quantity: { value: 1, unit: "L" } }], actual: caseFor(0, 0).actual },
    } };
    expect((await ok<OperationImpact>(await call(ws + "/operations/" + receipt.id + "/estimate", { ...changes(), scenario }, reviewerToken))).estimate?.net.difference).toBe(-7);
    await ok(await call(ws + "/versions/price", { ...price, supersedes: version.id, value: 30, invoice: "invoice-v2" }, tenantToken), 201);
    const fetched = await ok<OperationImpact>(await call(operation(receipt), undefined, receipt.trackingToken));
    expect(fetched.estimate?.net.difference).toBe(-7);
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

  it("stores original SDS privately, validates PDF signatures, and records a qualified decision", async () => {
    const form = (text = "%PDF-1.7\nFixture") => {
      const data = new FormData();
      data.set("pdf", new Blob([text], { type: "application/pdf" }), "fixture.pdf");
      data.set("metadata", JSON.stringify({ title: "Fixture SDS", labId: "lab-a", confirmed: true,
        candidates: [{ section: "hazards", page: 2, text: "Original page excerpt" }] }));
      return data;
    };
    expect((await call(ws + "/sds", form("not a PDF"), tenantToken)).status).toBe(400);
    const { id } = await ok<{ id: string }>(await call(ws + "/sds", form(), tenantToken), 201);
    expect((await call(ws + "/sds/" + id + "/file", undefined, otherToken)).status).toBe(404);
    expect((await call(ws + "/sds/" + id + "/review", { verified: true, reason: "Viewer" }, viewerToken)).status).toBe(403);
    await ok(await call(ws + "/sds/" + id + "/review", { verified: true, reason: "Qualified comparison to source pages" }, reviewerToken));
    const original = await call(ws + "/sds/" + id + "/file", undefined, viewerToken);
    expect(original.headers.get("Content-Type")).toBe("application/pdf");
    expect(await original.text()).toBe("%PDF-1.7\nFixture");
    expect(files.size).toBe(1);
  });

  it("keeps validated pair evidence tenant-scoped and renders an insufficient default", async () => {
    const pair = { a: "reference-ethanol", b: "reference-acetone", context: "storage" };
    const params = new URLSearchParams(pair);
    expect(await ok(await call(base + "/pairs?" + params))).toMatchObject({ assessment: "insufficient", requiresQualifiedReview: true });
    const input = { ...pair, finding: "insufficient", qualified: true, statement: "Review the product-specific source",
      conditions: "Test fixture for exact source conditions", title: "Reference", url: "https://pubchem.ncbi.nlm.nih.gov/compound/702" };
    expect((await call(ws + "/pairs", input, viewerToken)).status).toBe(403);
    await ok(await call(ws + "/pairs", input, reviewerToken), 201);
    const result = await ok<{ evidence: unknown[] }>(await call(ws + "/pairs?" + params, undefined, reviewerToken));
    expect(result.evidence).toHaveLength(1);
    expect(await ok(await call(ws + "/pairs?" + params, undefined, otherToken))).toMatchObject({ evidence: [] });
    expect(await ok(await call(ws + "/pairs?" + new URLSearchParams({ ids: pair.a + "," + pair.b, context: pair.context }), undefined, reviewerToken)))
      .toMatchObject({ pairs: [{ assessment: "insufficient" }] });
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
