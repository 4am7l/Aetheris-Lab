/* global fetch, document, innerWidth, localStorage */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import console from "node:console";
import { Buffer } from "node:buffer";
import { URL, fileURLToPath } from "node:url";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { jsPDF } from "jspdf";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, ".wrangler", "impact-browser-results");
fs.mkdirSync(output, { recursive: true });
const ui = process.env.AETHERIS_TEST_UI ?? "http://127.0.0.1:5173";
const worker = process.env.AETHERIS_DEV_WORKER_ORIGIN ?? "http://127.0.0.1:8787";
async function responseJson(p, init) {
  const res = await fetch(worker + p, init);
  const raw = await res.text();
  assert.equal(res.ok, true, res.status + " " + raw);
  return JSON.parse(raw);
}
async function post(p, data, auth) {
  return responseJson(p, { method: "POST", headers: {
    "Content-Type": "application/json", ...(auth ? { Authorization: "Bearer " + auth } : {}),
  }, body: JSON.stringify(data) });
}

async function fixture() {
  const health = await responseJson("/api/health");
  assert.equal(health.agent, "disabled", "Start the isolated Worker with AGENT_ENABLED=false");
  const storageDirectory = path.resolve(root, process.env.AETHERIS_TEST_D1 ?? ".wrangler/impact-verification");
  const folder = path.join(storageDirectory, "v3", "d1");
  const sqlFiles = fs.readdirSync(folder, { recursive: true }).filter(name => name.endsWith(".sqlite"));
  let db;
  for (const file of sqlFiles) {
    const handle = new DatabaseSync(path.join(folder, file));
    if (handle.prepare("SELECT 1 FROM sqlite_master WHERE name = 'chemical_references'").get()) { db = handle; break; }
    handle.close();
  }
  assert(db, "Isolated local D1 not found");
  db.exec("PRAGMA busy_timeout=5000");
  const actor = randomUUID();
  const org = randomUUID();
  const dept = randomUUID();
  const lab = randomUUID();
  const manager = randomBytes(32).toString("hex");
  const reviewer = randomBytes(32).toString("hex");
  const hash = value => createHash("sha256").update(value).digest("hex");
  const now = new Date().toISOString();
  db.prepare("INSERT INTO institutions VALUES(?,?,?,?,?)").run(org, "جامعة التحقق", "Verification University", "JO", now);
  db.prepare("INSERT INTO institution_departments VALUES(?,?,?,?)").run(dept, org, "قسم التحقق", "Verification Department");
  db.prepare("INSERT INTO institution_labs VALUES(?,?,?,?,?)").run(lab, org, dept, "مختبر التحقق", "Verification Laboratory");
  for (const [id, token, role] of [[actor, manager, "lab-manager"], [randomUUID(), reviewer, "reviewer"]]) {
    db.prepare(`INSERT INTO institution_memberships(id,institution_id,lab_id,role,token_hash,invitation_hash,invite_expires_at,created_at,created_by,accepted_at)
     VALUES(?,?,?,?,?,?,'2999-01-01',?,'local fixture',?)`).run(id, org, lab, role, hash("membership:" + token), hash("fixture:" + token), now, now);
  }
  const water = { name: "Water", formula: "H2O", cas: "7732-18-5", concentration: "Unknown", unit: "Unknown",
    solvent: "Water", state: "Liquid", temperature: "25", quantity: "100", quantityUnit: "mL", notes: "", source: "Manual entry" };
  const receipt = await post("/api/requests", { a: water, b: { ...water, quantity: "200" }, conditions: "" });
  await post("/api/impact/workspace/affiliate", { id: receipt.id, receipt: receipt.trackingToken }, manager);
  const run = randomUUID();
  db.prepare("INSERT INTO public_agent_runs(id,request_id,status,started_at,lease_until) VALUES(?,?,'running',?,?)").run(run,receipt.id,now,now);
  db.prepare("UPDATE public_agent_runs SET status='completed', finished_at=? WHERE id=?").run(now,run);
  db.prepare(`INSERT INTO public_review_decisions(id,request_id,run_id,reviewer_id,decision,notes,approved_result_json,created_at)
    VALUES (?,?,?,'local reviewer','Approved','Test fixture',?,?)`).run(randomUUID(), receipt.id, run, JSON.stringify({
    classification: "Insufficient information", conditions: "Local user-interface verification fixture", hazards: [],
    incompatibilities: [], storage: "", container: "", limitations: ["Test fixture only"],
    sources: [{ title: "PubChem · Water", url: "https://pubchem.ncbi.nlm.nih.gov/compound/962" }], reviewedAt: now,
  }), now);
  db.close();
  const cost = (baseline, actual, kind) => ({ baseline: [{ amount: baseline, evidence: "Local reference " + kind }],
    actual: [{ amount: actual, evidence: "Local documented actual " + kind }] });
  await post("/api/impact/workspace/operations/" + receipt.id + "/estimate", { key: randomUUID(), expectedId: 0, scenario: {
    beneficiary: "institution", assumptions: "تم تسجيل السيناريو المرجعي والتدخل لهذا الاختبار.",
    references: [{ title: "دليل الاختبار", url: "https://pubchem.ncbi.nlm.nih.gov/compound/962" }], financial: {
      purchase: cost(10, 5, "purchase"), disposal: cost(2, 0, "disposal"), handling: cost(0, 3, "handling"),
      treatment: cost(0, 0, "treatment"), recovery: cost(0, 0, "recovery"),
    },
  } }, reviewer);
  return { receipt, manager, reviewer };
}

async function main() {
  const { receipt, manager, reviewer } = await fixture();
  const browser = await chromium.launch({ headless: true, executablePath: process.env.AETHERIS_TEST_CHROMIUM });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, acceptDownloads: true });
  await context.route("**/*", (route) => {
    const origin = new URL(route.request().url()).origin;
    return [ui, "https://fonts.googleapis.com", "https://fonts.gstatic.com"].includes(origin) ? route.continue() : route.abort();
  });
  await context.addInitScript(({ receipt, manager }) => {
    localStorage.setItem("aetheris.receipt.v1." + receipt.id, JSON.stringify(receipt));
    localStorage.setItem("aetheris.impact.membership", manager);
  }, { receipt, manager });
  const page = await context.newPage();
  page.setDefaultTimeout(18000);
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  page.on("response", async response => {
    if (response.status() >= 400 && response.url().includes("/api/")) {
      console.error("Local API", response.status(), new URL(response.url()).pathname, await response.text().catch(() => ""));
    }
  });
  try {
    await page.goto(ui + "/tools");
    await page.getByRole("heading",{ name:"Periodic table", exact: true }).waitFor();
    assert.equal(await page.locator(".impact-element").count(), 118);
    await page.getByRole("button",{ name:"Oxygen 8", exact: true }).click();
    await page.getByRole("heading",{ name:/Oxygen/ }).waitFor();
    await page.getByRole("textbox",{ name:/Molecular formula/ }).fill("H2O");
    await page.getByRole("button",{ name:"Calculate", exact:true }).click();
    await page.getByText(/18\.015 g\/mol/).waitFor();
    await page.screenshot({ path: path.join(output,"tools-mobile.png") });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "Mobile tools overflow");

    await page.goto(ui + "/library/explorer");
    await page.getByRole("heading",{ name:"Chemical explorer", exact: true }).waitFor();
    await page.getByRole("checkbox",{ name:"Acetone", exact:true }).check();
    await page.getByRole("checkbox",{ name:"Ethanol", exact:true }).check();
    await page.getByText("Compare the first two selected materials", { exact:true }).click();
    await page.getByRole("columnheader",{ name:"Acetone", exact:true }).waitFor();
    await page.getByText("Chemical compatibility matrix", { exact:true }).click();
    await page.getByRole("button",{ name:"Insufficient evidence", exact:true }).first().click();
    await page.getByText("There is no qualified reference for this pair.").waitFor();

    await page.goto(ui + "/impact");
    await page.getByRole("button",{ name:"Create private dashboard", exact:true }).click();
    await page.getByRole("heading",{ name:"Personal impact", exact:true }).last().waitFor();
    await page.selectOption("#personal-receipt", receipt.id);
    await page.getByRole("button",{ name:"Link receipt", exact:true }).click();
    await page.getByText("Receipt linked.",{exact:true}).waitFor();
    await page.getByRole("link",{ name:"Open receipt", exact:true }).waitFor();

    await page.goto(ui + "/requests/" + receipt.id + "/receipt");
    await page.getByRole("heading",{ name:"Estimated impact", exact:true }).waitFor();
    await page.getByText("العربية", { exact:true }).click();
    await page.getByRole("heading",{ name:"الأثر التقديري", exact:true }).waitFor();
    assert.equal(await page.locator("html").getAttribute("dir"), "rtl");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "Arabic receipt overflow");
    const ar = page.waitForEvent("download");
    await page.getByRole("button",{ name:"تنزيل تقرير الأثر PDF", exact:true }).click();
    await (await ar).saveAs(path.join(output,"operation-ar.pdf"));
    await page.locator(".impact-panel").first().screenshot({ path: path.join(output,"receipt-ar-mobile.png") });
    await page.getByText("English", { exact:true }).click();
    await page.getByRole("heading",{ name:"Estimated impact", exact:true }).waitFor();
    assert.equal(await page.locator("html").getAttribute("dir"), "ltr");
    const en = page.waitForEvent("download");
    await page.getByRole("button",{ name:"Download impact PDF", exact:true }).click();
    await (await en).saveAs(path.join(output,"operation-en.pdf"));
    await page.getByText("Document the action taken", { exact: true }).click();
    await page.locator('select[name="kind0"]').selectOption("preserved");
    await page.locator('input[name="quantity0"]').fill("100");
    await page.locator('select[name="unit0"]').selectOption("mL");
    await page.locator('select[name="side0"]').selectOption("A");
    await page.getByRole("button", { name: "Submit for verification", exact: true }).click();
    await page.getByText("Pending verification", { exact: true }).first().waitFor();
    await page.getByRole("button", { name: "Withdraw action report", exact: true }).waitFor();
    const operation = "/api/impact/operations/" + receipt.id;
    const pending = await responseJson(operation, { headers: { Authorization: "Bearer " + receipt.trackingToken } });
    assert.equal(pending.current.state, "pending-verification");
    await post("/api/impact/workspace/operations/" + receipt.id + "/review", {
      key: randomUUID(), expectedId: pending.current.id, decision: "verify",
      reason: "Local reviewer checked the original fixture", evidenceReference: "local/audit/" + receipt.id,
    }, reviewer);

    await page.goto(ui + "/laboratory");
    await page.getByRole("heading",{ name:"Sustainability and impact", exact:true }).waitFor();
    await page.getByRole("heading", { name: "Scenario estimates", exact: true }).waitFor();
    await page.getByRole("heading", { name: "Verified outcomes", exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "Mobile dashboard overflow");
    await page.getByRole("button", { name: "Switch to dark mode", exact: true }).click();
    await page.getByRole("button", { name: "Switch to light mode", exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, "dashboard-dark-mobile.png"), fullPage: true });
    await page.getByRole("button", { name: "Switch to light mode", exact: true }).click();
    const csvWait = page.waitForEvent("download");
    await page.getByRole("button",{ name:"Export CSV", exact:true }).click();
    await (await csvWait).saveAs(path.join(output,"lab.csv"));
    const csv = fs.readFileSync(path.join(output,"lab.csv"),"utf8");
    assert(csv.includes(receipt.id) && csv.includes("Estimated avoided kg CO2e from verified activity"));
    const pdfWait = page.waitForEvent("download");
    await page.getByRole("button",{ name:"Download PDF", exact:true }).click();
    await (await pdfWait).saveAs(path.join(output,"lab-en.pdf"));
    await page.getByRole("button",{ name:"SDS", exact:true }).click();
    await page.getByText("Inspect and upload a PDF", { exact:true }).click();
    const scanFixture = new jsPDF();
    scanFixture.text(["Section 1: Identification", "Water CAS 7732-18-5","Section 2: Hazards", "Test excerpt"], 15, 25);
    const scanPath = path.join(output,"sds-fixture.pdf");
    fs.writeFileSync(scanPath, Buffer.from(scanFixture.output("arraybuffer")));
    await page.locator('input[type="file"]').setInputFiles(scanPath);
    await page.getByRole("textbox",{ name:"Identification and product · page 1", exact:true }).waitFor();
    await page.getByRole("textbox",{ name:"Product or SDS title", exact:true }).fill("Water SDS test fixture");
    await page.getByRole("checkbox",{ name:"I confirmed the excerpts and page numbers against the original.", exact:true }).check();
    await page.getByRole("button",{ name:"Save", exact:true }).click();
    await page.getByRole("heading",{ name:"Water SDS test fixture", exact:true }).waitFor();
    const original = page.waitForEvent("download");
    await page.getByRole("button",{ name:"Download original PDF", exact:true }).click();
    await (await original).saveAs(path.join(output,"sds-downloaded.pdf"));
    assert.deepEqual(fs.readFileSync(scanPath), fs.readFileSync(path.join(output,"sds-downloaded.pdf")));
    for (const name of ["operation-ar.pdf", "operation-en.pdf", "lab-en.pdf"]) {
      const bytes = fs.readFileSync(path.join(output, name));
      assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
      assert(bytes.length > 1000, "Downloaded PDF content is incomplete");
    }
    assert.deepEqual(errors, []);
    console.log("PASS Chromium at 390 px: local catalogue, periodic table, molar mass, comparison, matrix, personal dashboard, EN/AR and both themes, action report and review, operation PDFs, lab PDF and CSV, SDS extraction and identical private R2 download");
  } catch (err) {
    await page.screenshot({ path: path.join(output, "smoke-failure.png"), fullPage: true }).catch(() => {});
    console.log("Page errors:", errors);
    throw err;
  } finally {
    await browser.close();
  }
}
main().catch(err => { console.error(err); process.exitCode = 1; });
