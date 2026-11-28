/* global fetch, document, getComputedStyle, innerWidth, localStorage */
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
  const hash = value => createHash("sha256").update(value).digest("hex");
  const now = new Date().toISOString();
  db.prepare("INSERT INTO institutions VALUES(?,?,?,?,?)").run(org, "جامعة التحقق", "Verification University", "JO", now);
  db.prepare("INSERT INTO institution_departments VALUES(?,?,?,?)").run(dept, org, "قسم التحقق", "Verification Department");
  db.prepare("INSERT INTO institution_labs VALUES(?,?,?,?,?)").run(lab, org, dept, "مختبر التحقق", "Verification Laboratory");
  db.prepare(`INSERT INTO institution_memberships(id,institution_id,lab_id,role,token_hash,invitation_hash,invite_expires_at,created_at,created_by,accepted_at)
     VALUES(?,?,?,'lab-manager',?,?,'2999-01-01',?,'local fixture',?)`).run(actor, org, lab, hash("membership:" + manager), hash("fixture:" + manager), now, now);
  const water = { name: "Water", formula: "H2O", cas: "7732-18-5", concentration: "Unknown", unit: "Unknown",
    solvent: "Water", state: "Liquid", temperature: "25", quantity: "100", quantityUnit: "mL", notes: "", source: "Manual entry" };
  const silverNitrate = { ...water, name: "Silver nitrate", formula: "AgNO3", cas: "7761-88-8", concentration: "0.1", unit: "mol/L" };
  const receipt = await post("/api/requests", { a: silverNitrate, b: { ...water, quantity: "200" }, conditions: "" });
  await post("/api/requests", { a: { ...silverNitrate, name: "Private fixture without a saved receipt" }, b: water, conditions: "" });
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
  const comparison = (baseline, actual) => ({ baseline, actual, difference: baseline - actual });
  const insert = db.prepare(`INSERT INTO impact_events(request_id, state, actor, created_at, calculation_json, integrity_version, evidence_keys)
    VALUES (?, ?, 'synthetic ledger history', ?, ?, 2, ?)`);
  insert.run(receipt.id, "estimated", now, JSON.stringify({ result: {
    currency: "JOD", net: comparison(9, 5), avoidedCo2e: comparison(0.4, 0), wasteAvoided: comparison(0.1, 0.025),
  } }), null);
  insert.run(receipt.id, "verified", now, JSON.stringify({ realizedEvidence: "Synthetic baseline and outcome comparison", result: {
    currency: "JOD", net: comparison(9, 7), avoidedCo2e: comparison(0.15, 0), wasteAvoided: comparison(0.05, 0),
  } }), JSON.stringify([hash("browser-fixture:" + receipt.id)]));
  db.close();
  return { receipt, manager };
}

async function arrowFree(page) {
  const selects = await page.locator("select:visible").evaluateAll((fields) => fields.map((field) => {
    const style = field.ownerDocument.defaultView.getComputedStyle(field);
    return { appearance: style.appearance, image: style.backgroundImage, repeat: style.backgroundRepeat };
  }));
  assert(selects.length > 0, "Expected a visible native select");
  for (const select of selects) {
    assert.deepEqual(select, { appearance: "none", image: "none", repeat: "no-repeat" });
  }
  assert.equal(await page.locator(":is(.MuiNativeSelect-icon, .MuiSelect-icon):visible").count(), 0);
}

async function materialFocus(field) {
  await field.focus();
  const styles = await field.evaluate((element) => {
    const view = element.ownerDocument.defaultView;
    const shell = element.closest(".MuiOutlinedInput-root");
    const stroke = view.getComputedStyle(shell.querySelector(".MuiOutlinedInput-notchedOutline"));
    const inner = view.getComputedStyle(element);
    return { border: inner.borderTopWidth, outline: inner.outlineStyle, fieldStroke: stroke.borderTopWidth,
      height: view.getComputedStyle(shell).height };
  });
  assert.deepEqual(styles, { border: "0px", outline: "none", fieldStroke: "2px", height: "52px" });
}

async function checkPublicFields(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(ui);
  const renderedIcons = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.querySelectorAll(".sidebar nav .material-symbols-rounded")].map((icon) => icon.getBoundingClientRect().width);
  });
  assert.equal(renderedIcons.length, 8);
  assert(renderedIcons.every((width) => width >= 20 && width <= 26), "Navbar icons must render as Material Symbols without a CDN");
  const homeSearch = page.locator(".home-search input");
  await homeSearch.focus();
  assert.deepEqual(await homeSearch.evaluate((input) => {
    const view = input.ownerDocument.defaultView;
    return [view.getComputedStyle(input).outlineStyle, view.getComputedStyle(input.parentElement).outlineWidth];
  }), ["none", "2px"]);
  await homeSearch.fill("Ethanol");
  await homeSearch.press("Enter");
  const librarySearch = page.getByRole("searchbox", { name: "Search library" });
  await librarySearch.waitFor();
  assert.equal(await librarySearch.inputValue(), "Ethanol");
  await materialFocus(librarySearch);
  await page.keyboard.press("Tab");
  const clearSearch = page.getByRole("button", { name: "Clear search", exact: true });
  assert.equal(await clearSearch.evaluate((button) => button === document.activeElement), true);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector(".search-field input").value === "");
  assert.equal(await librarySearch.evaluate((input) => input === document.activeElement), true);

  const current = page.locator('.sidebar nav a[aria-current="page"]');
  assert.equal(await current.getAttribute("href"), "/library");
  await page.keyboard.press("Tab");
  await current.focus();
  assert.equal(await current.evaluate((link) => link.ownerDocument.defaultView.getComputedStyle(link).outlineWidth), "2px");
  const next = page.locator('.sidebar nav a[href="/analysis"]');
  await next.hover();
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.sidebar nav a[href="/analysis"]'), "::before").opacity) >= 0.07);
  const bounds = await next.boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.sidebar nav a[href="/analysis"]'), "::before").opacity) >= 0.13);
  await page.mouse.move(1, 1);
  await page.mouse.up();
  await page.emulateMedia({ forcedColors: "active" });
  assert.equal(await page.locator(".sidebar").evaluate((el) => el.ownerDocument.defaultView.getComputedStyle(el).backdropFilter), "none");
  await page.emulateMedia({ forcedColors: "none" });
  assert.equal(await page.locator(".sidebar").evaluate((el) => el.ownerDocument.defaultView.getComputedStyle(el).backdropFilter), "blur(14px)");
  await page.screenshot({ path: path.join(output, "library-light-desktop.png") });

  await page.goto(ui + "/analysis");
  await page.getByRole("button", { name: "Search library", exact: true }).first().click();
  const search = page.getByRole("dialog").getByRole("searchbox", { name: "Search an indexed substance" });
  await materialFocus(search);
  await search.fill("Ethanol");
  await page.getByRole("dialog").getByRole("button", { name: /Ethanol/ }).first().waitFor();
  await page.screenshot({ path: path.join(output, "analysis-search-desktop.png") });
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Enter manually", exact: true }).first().click();
  const manual = page.getByRole("dialog");
  await arrowFree(page);
  const solvent = manual.getByRole("combobox", { name: "Solvent", exact: true });
  await materialFocus(solvent);
  await solvent.press("Home");
  assert.equal(await solvent.inputValue(), "Water");
  await page.screenshot({ path: path.join(output, "analysis-fields-desktop.png") });
  await manual.getByRole("button", { name: "Close", exact: true }).click();
  await page.locator("#dilution-assumptions").locator("..").getByRole("checkbox").first().check();
  const volume = page.getByRole("combobox").last();
  await volume.press("Enter");
  await page.getByRole("option", { name: "L", exact: true }).click();
  assert.equal(await volume.innerText(), "L");
  assert.equal(await page.locator(":is(.MuiNativeSelect-icon, .MuiSelect-icon):visible").count(), 0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(ui + "/library/explorer");
  await page.getByText("العربية", { exact: true }).click();
  await page.getByRole("button", { name: "تفعيل الوضع الداكن", exact: true }).click();
  assert.equal(await page.locator("html").getAttribute("dir"), "rtl");
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  const explorerSearch = page.getByRole("searchbox", { name: "البحث في المراجع الكيميائية" });
  await materialFocus(explorerSearch);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.join(output, "explorer-dark-rtl-mobile.png") });
  await page.locator(".mobile-toggle").click();
  const navigation = page.getByRole("navigation", { name: "التنقل الرئيسي" });
  await navigation.getByRole("link").first().waitFor({ state: "visible" });
  await page.waitForFunction(() => Math.abs(document.querySelector(".sidebar").getBoundingClientRect().right - innerWidth) < 1);
  assert.equal(await page.locator(".mobile-toggle").getAttribute("aria-expanded"), "true");
  await page.screenshot({ path: path.join(output, "sidebar-dark-rtl-mobile.png") });
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".mobile-toggle").getAttribute("aria-expanded"), "false");
  await page.getByRole("button", { name: "تفعيل الوضع الفاتح", exact: true }).click();
  await page.getByText("English", { exact: true }).click();
}

async function checkTouch(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const phone = await context.newPage();
    await phone.goto(ui);
    await phone.locator(".mobile-toggle").tap();
    await phone.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Chemical Analysis" }).tap();
    await phone.waitForURL(ui + "/analysis");
    assert.equal(await phone.locator(".mobile-toggle").getAttribute("aria-expanded"), "false");
    await phone.getByRole("button", { name: "Enter manually", exact: true }).first().tap();
    const solvent = phone.getByRole("dialog").getByRole("combobox", { name: "Solvent", exact: true });
    await arrowFree(phone);
    await solvent.tap();
    await solvent.selectOption("Water");
    assert.equal(await solvent.inputValue(), "Water");
  } finally {
    await context.close();
  }
}

async function main() {
  const { receipt, manager } = await fixture();
  const browser = await chromium.launch({ headless: true, executablePath: process.env.AETHERIS_TEST_CHROMIUM });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, acceptDownloads: true });
  await context.route("**/*", (route) => {
    const origin = new URL(route.request().url()).origin;
    return origin === ui ? route.continue() : route.abort();
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
    await checkPublicFields(page);
    await page.goto(ui + "/tools");
    await page.getByRole("heading",{ name:"Periodic table", exact: true }).waitFor();
    await arrowFree(page);
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
    await page.getByRole("heading", { name: "Cumulative totals", exact: true }).waitFor();
    await page.getByRole("heading", { name: "Hypothetical experimental estimates", exact: true }).first().waitFor();
    await page.getByRole("heading", { name: "Verified real-world outcomes", exact: true }).first().waitFor();
    await page.getByText("4.000 JOD", { exact: true }).first().waitFor();
    await page.getByText("2.000 JOD", { exact: true }).first().waitFor();
    assert.equal(await page.getByText(/Private fixture without a saved receipt/).count(), 0);
    assert.equal(await page.getByRole("button", { name: "Create private dashboard" }).count(), 0);
    await page.getByText(/Silver nitrate · Water/).click();
    await page.getByRole("link", { name: "Open receipt", exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "Mobile dashboard overflow");
    await page.getByText("العربية", { exact:true }).click();
    await page.getByRole("heading", { name: "المجاميع التراكمية", exact: true }).waitFor();
    await page.getByRole("button", { name: "تفعيل الوضع الداكن", exact: true }).click();
    await page.screenshot({ path: path.join(output, "dashboard-dark-mobile.png"), fullPage: true });
    await page.getByRole("button", { name: "تفعيل الوضع الفاتح", exact: true }).click();
    await page.getByText("English", { exact:true }).click();

    await page.goto(ui + "/requests/" + receipt.id + "/receipt");
    await page.getByRole("heading",{ name:"Assessment impact", exact:true }).waitFor();
    await page.getByRole("heading", { name: "Fixed reference estimates", exact: true }).waitFor();
    await page.getByText("1.50 كغم/لتر", { exact: true }).waitFor();
    await page.getByText(/0\.1 L · 4\.500 JOD · 0\.15 kg CO₂e/).waitFor();
    await page.getByText("العربية", { exact:true }).click();
    await page.getByRole("heading",{ name:"أثر التقييم", exact:true }).waitFor();
    await page.getByRole("heading", { name: "تقديرات الدليل الثابت", exact: true }).waitFor();
    assert.equal(await page.locator("html").getAttribute("dir"), "rtl");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "Arabic receipt overflow");
    const ar = page.waitForEvent("download");
    await page.getByRole("button",{ name:"تنزيل تقرير الأثر PDF", exact:true }).click();
    await (await ar).saveAs(path.join(output,"operation-ar.pdf"));
    await page.locator(".impact-panel").first().screenshot({ path: path.join(output,"receipt-ar-mobile.png") });
    await page.getByText("English", { exact:true }).click();
    await page.getByRole("heading",{ name:"Assessment impact", exact:true }).waitFor();
    assert.equal(await page.locator("html").getAttribute("dir"), "ltr");
    const en = page.waitForEvent("download");
    await page.getByRole("button",{ name:"Download impact PDF", exact:true }).click();
    await (await en).saveAs(path.join(output,"operation-en.pdf"));
    assert.equal(await page.getByText("Document the action taken", { exact: true }).count(), 0);

    await page.goto(ui + "/laboratory");
    await page.getByRole("button", { name: "Inventory", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Impact and assessments", exact: true }).count(), 0);
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
    for (const name of ["operation-ar.pdf", "operation-en.pdf"]) {
      const bytes = fs.readFileSync(path.join(output, name));
      assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
      assert(bytes.length > 1000, "Downloaded PDF content is incomplete");
    }
    await checkTouch(browser);
    await page.setViewportSize({ width: 320, height: 760 });
    for (const route of ["/requests", "/about", "/library/ethanol"]) {
      await page.goto(ui + route);
      await page.locator("main .page h1").first().waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, route + " overflows at 320 px");
    }
    assert.deepEqual(errors, []);
    console.log("PASS public controls: keyboard and touch, native and Material selects, single field focus, both search forms, local icons, navigation states and high-contrast fallback");
    console.log("PASS Chromium at 390 px: local catalogue, periodic table, molar mass, comparison, matrix, receipt-scoped automatic impact in both languages and themes, assessment PDFs, SDS extraction and identical private R2 download");
  } catch (err) {
    await page.screenshot({ path: path.join(output, "smoke-failure.png"), fullPage: true }).catch(() => {});
    console.log("Page errors:", errors);
    throw err;
  } finally {
    await browser.close();
  }
}
main().catch(err => { console.error(err); process.exitCode = 1; });
