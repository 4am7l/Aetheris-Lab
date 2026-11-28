/* global document, fetch */
import assert from "node:assert/strict";
import console from "node:console";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { URL, fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, ".wrangler", "admin-browser-results");
const admin = process.env.AETHERIS_TEST_ADMIN ?? "https://localhost:4174";
const worker = process.env.AETHERIS_DEV_WORKER_ORIGIN ?? "http://127.0.0.1:8787";
const password = process.env.AETHERIS_TEST_ADMIN_PASSWORD;
const storage = path.resolve(root, process.env.AETHERIS_TEST_D1 ?? ".wrangler/impact-verification");
const t = (lang, en, ar) => lang === "ar" ? ar : en;

function openLocalD1() {
  const directory = path.join(storage, "v3", "d1");
  for (const file of fs.readdirSync(directory, { recursive: true }).filter(name => name.endsWith(".sqlite"))) {
    const db = new DatabaseSync(path.join(directory, file));
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'inventory_items'").get()) return db;
    db.close();
  }
  throw new Error("Isolated migrated D1 store not found");
}

async function fixture() {
  for (const origin of [worker, admin]) assert(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
  assert(password, "Set AETHERIS_TEST_ADMIN_PASSWORD to the local Worker password");
  const health = await (await fetch(worker + "/api/health")).json();
  assert.equal(health.agent, "disabled");
  assert.equal(health.review, true);
  const water = { name: "Water", formula: "H2O", cas: "7732-18-5", concentration: "Unknown", unit: "Unknown",
    state: "Liquid", solvent: "Water", temperature: "25", quantity: "250", quantityUnit: "mL",
    notes: "", source: "Manual entry" };
  const submission = await fetch(worker + "/api/requests", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ a: water, b: water, conditions: "" }),
  });
  assert.equal(submission.status, 201);
  const { id } = await submission.json();
  const now = new Date().toISOString();
  const run = randomUUID();
  const [institution, department, lab, stock, sds] = Array.from({ length: 5 }, () => randomUUID());
  const container = "QA container " + stock.slice(0, 6);
  const title = "QA SDS " + sds.slice(0, 6);
  const db = openLocalD1();
  try {
    db.exec("PRAGMA busy_timeout=5000; BEGIN;");
    db.prepare(`INSERT INTO public_agent_runs(id, request_id, status, started_at, lease_until, finished_at)
      VALUES (?, ?, 'completed', ?, ?, ?)`).run(run, id, now, now, now);
    db.prepare(`UPDATE public_request_workflow SET status = 'Pending Review', run_id = ?, updated_at = ? WHERE request_id = ?`)
      .run(run, now, id);
    db.prepare("INSERT INTO institutions VALUES (?, ?, ?, 'JO', ?)").run(institution, "جامعة الاختبار", "Test University", now);
    db.prepare("INSERT INTO institution_departments VALUES (?, ?, ?, ?)").run(department, institution, "قسم الاختبار", "Test Department");
    db.prepare("INSERT INTO institution_labs VALUES (?, ?, ?, ?, ?)").run(lab, institution, department, "مختبر الاختبار", "Test Laboratory");
    db.prepare(`INSERT INTO inventory_items(id, institution_id, lab_id, chemical_id, container, quantity, unit, location, updated_at)
      VALUES (?, ?, ?, 'reference-silver-nitrate', ?, 1, 'L', 'Test shelf', ?)`).run(stock, institution, lab, container, now);
    db.prepare(`INSERT INTO sds_documents(id, institution_id, lab_id, object_key, sha256, size_bytes, title, extracted_json, review_status, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, '[]', 'submitted', 'browser fixture', ?)`)
      .run(sds, institution, lab, "fixture/" + sds, createHash("sha256").update(sds).digest("hex"), title, now);
    db.exec("COMMIT");
  } finally {
    db.close();
  }
  return { id, container, title };
}

async function arrowFree(scope, minimum) {
  const selects = await scope.locator(":is(select, .MuiSelect-select):visible").evaluateAll(fields => fields.map(field => {
    const view = field.ownerDocument.defaultView;
    const style = view.getComputedStyle(field);
    const outline = field.closest(".MuiOutlinedInput-root");
    const native = field.matches("select");
    return {
      native, appearance: style.appearance, image: style.backgroundImage, repeat: style.backgroundRepeat,
      containerImage: outline ? view.getComputedStyle(outline).backgroundImage : "none",
      labelled: native ? Boolean(field.labels?.length || field.getAttribute("aria-label")) : Boolean(field.getAttribute("aria-labelledby")),
      pseudo: ["::before", "::after"].map(pseudo => view.getComputedStyle(field, pseudo).content),
    };
  }));
  assert(selects.length >= minimum, "Expected at least " + minimum + " visible dropdowns, found " + selects.length);
  if (!minimum) assert.equal(selects.length, 0);
  for (const select of selects) {
    if (select.native) assert.equal(select.appearance, "none");
    assert.equal(select.image, "none");
    assert.equal(select.containerImage, "none");
    assert.equal(select.repeat, "no-repeat");
    assert.equal(select.labelled, true);
    assert(select.pseudo.every(content => content === "none" || content === "normal"));
  }
  assert.equal(await scope.locator(":is(.MuiNativeSelect-icon, .MuiSelect-icon):visible").count(), 0);
}

async function focusVisible(field) {
  assert.equal(await field.evaluate(element => {
    const view = element.ownerDocument.defaultView;
    const outline = element.closest(".MuiOutlinedInput-root")?.querySelector(".MuiOutlinedInput-notchedOutline");
    const style = view.getComputedStyle(element);
    const width = outline ? view.getComputedStyle(outline).borderTopWidth : "0";
    return element === document.activeElement && (parseFloat(width) >= 2 ||
      (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 2));
  }), true);
}

const button = (page, name) => page.getByRole("button", { name, exact: true });
const summary = (page, name) => page.locator("summary").and(page.getByText(name, { exact: true }));
const combo = (page, name) => page.getByRole("combobox", { name, exact: true });
const workspace = (page, lang) => page.getByRole("group", { name: t(lang, "Laboratory workspace sections", "أقسام مساحة العمل المخبرية") });
const choice = (page, name) => page.getByText(name, { exact: true });

async function auditWorkspace(page, lang, data) {
  const section = (en, ar) => button(workspace(page, lang), t(lang, en, ar)).click();
  const open = (en, ar) => summary(page, t(lang, en, ar)).click();

  await section("Inventory", "المخزون");
  await open("Register a container", "تسجيل عبوة");
  await page.getByRole("button", { name: new RegExp(data.container) }).click();
  await open("Post a stock movement", "تسجيل حركة المخزون");
  await arrowFree(page, 4);

  for (const storage of [false, true]) {
    await (storage ? section("Storage compatibility", "توافق التخزين") : section("Chemical explorer", "مستكشف المواد الكيميائية"));
    await page.getByRole("checkbox", { name: t(lang, "Acetone", "الأسيتون"), exact: true }).check();
    await page.getByRole("checkbox", { name: t(lang, "Ethanol", "الإيثانول"), exact: true }).check();
    await (storage ? open("Storage compatibility matrix", "مصفوفة توافق التخزين") : open("Chemical compatibility matrix", "مصفوفة التوافق الكيميائي"));
    await page.getByRole("button", { name: t(lang, "Insufficient evidence", "أدلة غير كافية"), exact: true }).first().click();
    await open("Add qualified evidence for this pair", "إضافة أدلة مراجعة لهذا الزوج");
    await arrowFree(page, 4);
  }

  await section("SDS", "صحائف السلامة");
  await button(page, data.title).click();
  await combo(page, t(lang, "Document review", "مراجعة المستند")).waitFor();
  await arrowFree(page, 1);

  await section("Prices and carbon factors", "الأسعار ومعاملات الكربون");
  await open("Add a chemical reference", "إضافة مرجع كيميائي");
  await button(page, t(lang, "Ethanol", "الإيثانول")).click();
  await open("Add a purchase, disposal or combined price version", "إضافة نسخة سعر شراء أو تخلص أو سعر مجمّع");
  await open("Add an emissions factor version", "إضافة نسخة معامل انبعاثات");
  await open("Add a verified density version", "إضافة نسخة كثافة موثّقة");
  await arrowFree(page, 10);

  await section("Institutional structure", "الهيكل المؤسسي");
  await button(page, t(lang, "Laboratories", "المختبرات")).click();
  await page.locator("#structure-choice").selectOption({ index: 1 });
  await open("Issue a scoped invitation", "إصدار دعوة محددة النطاق");
  await arrowFree(page, 5);

  await section("Emergency information", "معلومات الطوارئ");
  await open("Manage approved contact and procedure", "إدارة جهة الاتصال والإجراء المعتمد");
  await arrowFree(page, 2);

  await section("Audit history", "سجل التدقيق");
  await page.getByRole("heading", { name: t(lang, "Audit history", "سجل التدقيق"), exact: true }).waitFor();
  await arrowFree(page, 0);
}

async function noOverflow(page, width) {
  assert(await page.evaluate(width => document.documentElement.scrollWidth <= width, width), "Page overflow at " + width + " px");
}

async function checkLayout(page, data, lang, theme, mobile, width) {
  await page.goto(admin);
  const filter = combo(page, t(lang, "Filter by status", "التصفية حسب الحالة"));
  await filter.waitFor();
  await arrowFree(page, 1);
  if (mobile) await filter.tap();
  else if (theme === "light") {
    await filter.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await focusVisible(filter);
    await page.keyboard.press("Enter");
  } else await filter.click();
  const list = page.getByRole("listbox");
  const option = list.getByRole("option").nth(1);
  const label = await option.innerText();
  if (mobile) await option.tap();
  else if (theme === "light") {
    await page.keyboard.press("ArrowDown");
    assert.equal(await option.evaluate(element => element === document.activeElement), true);
    await page.keyboard.press("Enter");
  } else await option.click();
  await list.waitFor({ state: "hidden" });
  assert.equal(await filter.innerText(), label);
  await button(page, t(lang, "Archived requests", "الطلبات المؤرشفة")).click();
  await arrowFree(page, 1);

  await page.goto(admin + "/requests/" + data.id);
  const review = combo(page, t(lang, "Review decision", "قرار المراجعة"));
  await combo(page, t(lang, "Scientific section", "القسم العلمي")).waitFor();
  await arrowFree(page, 3);
  await noOverflow(page, width);
  await button(page, t(lang, "Delete permanently", "حذف نهائي")).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  await arrowFree(dialog, 0);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  if ((lang === "en" && theme === "light" && !mobile) || (lang === "ar" && theme === "dark" && mobile)) {
    await review.scrollIntoViewIfNeeded();
    if (mobile) {
      await review.tap();
      await page.getByRole("listbox").waitFor();
    }
    await page.screenshot({
      path: path.join(output, `admin-review-${lang}-${theme}-${mobile ? "mobile" : "desktop"}.png`),
      animations: "disabled",
    });
    if (mobile) {
      await page.keyboard.press("Escape");
      await page.getByRole("listbox").waitFor({ state: "hidden" });
    }
  }

  await page.goto(admin + "/impact");
  const period = combo(page, t(lang, "Group by", "التجميع حسب"));
  await period.waitFor();
  await combo(page, t(lang, "University", "الجامعة")).waitFor();
  await arrowFree(page, 4);
  if (mobile) {
    await period.tap();
    await period.selectOption("all");
  } else {
    await period.focus();
    await period.press("End");
    await focusVisible(period);
  }
  assert.equal(await period.inputValue(), "all");
  await noOverflow(page, width);
  if (lang === "ar" && theme === "dark" && mobile) {
    await period.press("Escape");
    await page.screenshot({ path: path.join(output, "admin-sustainability-ar-dark-mobile.png"), animations: "disabled" });
  }
  await auditWorkspace(page, lang, data);
  await noOverflow(page, width);
}

async function main() {
  const data = await fixture();
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.AETHERIS_TEST_CHROMIUM });
  try {
    for (const mobile of [false, true]) {
      const width = mobile ? 390 : 1440;
      const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height: mobile ? 844 : 900 },
        isMobile: mobile, hasTouch: mobile, colorScheme: "light" });
      await context.route("**/*", (route) => {
        const origin = new URL(route.request().url()).origin;
        return [admin, "https://fonts.googleapis.com", "https://fonts.gstatic.com"].includes(origin) ? route.continue() : route.abort();
      });
      const page = await context.newPage();
      page.setDefaultTimeout(12000);
      const errors = [];
      page.on("pageerror", error => errors.push(String(error)));
      try {
        await page.goto(admin);
        await page.getByRole("heading", { name: "Reviewer sign-in", exact: true }).waitFor();
        await arrowFree(page, 0);
        await page.locator('input[type="password"]').fill(password);
        await button(page, "Sign in").click();
        await combo(page, "Filter by status").waitFor();
        for (const lang of ["en", "ar"]) {
          if (lang === "ar") await choice(page, "العربية").click();
          for (const theme of ["light", "dark"]) {
            if (await page.locator("html").getAttribute("data-theme") !== theme) await page.locator(".admin-controls .MuiIconButton-root").click();
            assert.equal(await page.locator("html").getAttribute("dir"), lang === "ar" ? "rtl" : "ltr");
            assert.equal(await page.locator("html").getAttribute("data-theme"), theme);
            await checkLayout(page, data, lang, theme, mobile, width);
            console.log("PASS Admin dropdowns", lang, theme, mobile ? "mobile touch" : "desktop keyboard and pointer");
          }
        }
        assert.deepEqual(errors, []);
      } catch (error) {
        await page.screenshot({ path: path.join(output, "admin-failure.png"), fullPage: true }).catch(() => {});
        throw error;
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
