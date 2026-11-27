import { jsPDF } from "jspdf";
import type { ImpactBucket, ImpactOverview, OperationImpact } from "./contracts";
import { download, words, type LabLanguage } from "./client";
import { labLabel, numberLabel } from "./labels";
import { carbonStages, financialKinds, type ImpactCalculation } from "./model";

type Row = { text: string; heading?: boolean; link?: string; bar?: number };
const scale = 2;
const width = 794;
const height = 1123;
const ltr = (lang: LabLanguage, text: string) => lang === "ar" ? "\u2066" + text + "\u2069" : text;

function saveReport(title: string, language: LabLanguage, rows: Row[], name: string) {
  const doc = new jsPDF({ format: "a4", compress: true });
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("PDF rendering unavailable");
  const ctx = context;
  ctx.scale(scale, scale);
  const rtl = language === "ar";
  const margin = 56;
  const usable = width - margin * 2;
  let y = 0;
  let pageNumber = 0;
  const links: { y: number; height: number; url: string }[] = [];

  function direction(isRtl: boolean) {
    ctx.direction = isRtl ? "rtl" : "ltr";
    ctx.textAlign = isRtl ? "right" : "left";
    return isRtl ? width - margin : margin;
  }
  function format(size: number, bold = false) { ctx.font = (bold ? "700 " : "400 ") + size + "px Tahoma, Arial, sans-serif"; }
  function init() {
    if (pageNumber) doc.addPage();
    pageNumber++;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#136458";
    ctx.fillRect(margin, margin, usable, 4);
    format(18, true);
    ctx.fillText("Aetheris Lab", direction(false), margin + 33);
    format(26, true);
    ctx.fillText(title, direction(rtl), margin + 71, usable);
    y = margin + 107;
  }
  function flush() {
    format(13);
    ctx.fillStyle = "#465450";
    ctx.fillText(words(language, "Page ", "صفحة ") + pageNumber, direction(rtl), height - margin);
    doc.addImage(canvas, "PNG", 0, 0, 210, 297, undefined, "FAST");
    for (const link of links) doc.link(margin / width * 210, link.y / height * 297, usable / width * 210, link.height / height * 297, { url: link.url });
    links.length = 0;
  }
  function wrap(value: string) {
    const out: string[] = [];
    for (const paragraph of value.split(/\r?\n/)) {
      let line = "";
      for (const word of paragraph.trim().split(/\s+/)) {
        if (ctx.measureText(word).width > usable) {
          if (line) out.push(line);
          line = "";
          for (const char of word) {
            if (ctx.measureText(line + char).width > usable) { out.push(line); line = ""; }
            line += char;
          }
          continue;
        }
        const combined = line ? line + " " + word : word;
        if (line && ctx.measureText(combined).width > usable) { out.push(line); line = word; }
        else line = combined;
      }
      out.push(line);
    }
    return out;
  }
  init();
  for (const row of rows) {
    format(row.heading ? 19 : 15, row.heading);
    const rowRtl = rtl && !/^(?:https?:\/\/|[A-Za-z0-9-]{24,}$)/.test(row.text);
    const lines = wrap(row.text);
    if (row.heading) y += 12;
    for (const line of lines) {
      if (y > height - margin - 35) { flush(); init(); format(row.heading ? 19 : 15, row.heading); }
      ctx.fillStyle = row.heading ? "#136458" : row.link ? "#135573" : "#172520";
      ctx.fillText(line, direction(rowRtl), y);
      if (row.link) links.push({ y: y - 17, height: 23, url: row.link });
      y += row.heading ? 26 : 23;
    }
    if (row.bar !== undefined) {
      const size = Math.abs(row.bar) * usable;
      ctx.fillStyle = row.bar < 0 ? "#9e472e" : "#478777";
      ctx.fillRect(rtl ? width - margin - size : margin, y - 10, size, 5);
      y += 10;
    }
  }
  flush();
  download(doc.output("blob"), name);
}

function calculationRows(calculation: ImpactCalculation | null, lang: LabLanguage): Row[] {
  const t = (en: string, ar: string) => words(lang, en, ar);
  if (!calculation) return [{ text: t("Calculation unavailable.", "الحساب غير متاح.") }];
  const metric = (label: string, value: number | null, unit: string) =>
    ({ text: label + "  ·  " + (value === null ? numberLabel(lang, value) : ltr(lang, numberLabel(lang, value, unit))) });
  return [
    metric(t("Net financial impact", "صافي الأثر المالي"), calculation.net.difference, calculation.currency),
    { text: t("Expense owner", "صاحب النفقة") + "  ·  " + labLabel(lang, calculation.beneficiary) },
    ...financialKinds.map((kind) => metric(labLabel(lang, kind), calculation.financial[kind].difference, calculation.currency)),
    metric(t("Waste avoided", "النفايات المتجنبة"), calculation.wasteAvoided.difference, "L"),
    metric(t("Waste avoided (mass)", "كتلة النفايات المتجنبة"), calculation.wasteAvoidedKg.difference, "kg"),
    metric(t("Material preserved", "المواد المحفوظة"), calculation.preserved.liters, "L"),
    metric(t("Material preserved (mass)", "كتلة المواد المحفوظة"), calculation.preserved.kilograms, "kg"),
    metric(t("Estimated avoided emissions", "تقدير الانبعاثات المتجنبة"), calculation.avoidedCo2e.difference, "kg CO₂e"),
    ...carbonStages.map((stage) => metric(labLabel(lang, stage), calculation.emissions[stage].difference, "kg CO₂e")),
    { text: t("Method and coverage", "المنهجية والتغطية"), heading: true },
    { text: t("Baseline minus intervention.", "السيناريو المرجعي ناقص التدخل.") + " " + calculation.formulaVersion },
    { text: calculation.assumptions },
    ...calculation.references.flatMap((source) => [{ text: source.title, link: source.url }, ...(source.url ? [{ text: source.url, link: source.url }] : [])]),
  ];
}

export function operationPdf(id: string, data: OperationImpact, lang: LabLanguage) {
  const t = (en: string, ar: string) => words(lang, en, ar);
  const verified = data.current && !data.current.reviewRequired && ["verified", "corrected"].includes(data.current.state);
  const recheck = t("Historical calculation requires re-review", "الحساب السابق يتطلب مراجعة جديدة");
  const amount = (value: number | null, unit: string) => value === null ? numberLabel(lang, null) : ltr(lang, numberLabel(lang, value, unit));
  const rows: Row[] = [
    { text: t("Operation", "العملية") + "  ·  " + ltr(lang, id) },
    { text: t("Input volume assessed", "حجم المدخلات المقيّمة") + "  ·  " + amount(data.assessed.liters, "L") },
    { text: t("Input mass assessed", "كتلة المدخلات المقيّمة") + "  ·  " + amount(data.assessed.kilograms, "kg") },
    { text: t("Expected impact", "الأثر المتوقع"), heading: true },
    ...(data.estimateReviewRequired ? [{ text: recheck }] : calculationRows(data.estimate, lang)),
    { text: t("Action and verification", "الإجراء والتحقق"), heading: true },
    { text: data.current ? (data.current.reviewRequired ? recheck : labLabel(lang, data.current.state)) + "  ·  " + ltr(lang, data.current.createdAt.slice(0, 10)) :
      t("No impact recorded", "لم يُسجّل أثر") },
    ...(data.current?.activities.map((item) => ({ text: labLabel(lang, item.kind) + "  ·  " + ltr(lang, item.date)
      + (item.quantity ? "  ·  " + ltr(lang, numberLabel(lang, item.quantity.value, item.quantity.unit)) : "") })) ?? []),
    ...(verified ? calculationRows(data.current?.calculation ?? null, lang) : []),
    { text: t("Reviewed findings and sources", "النتائج والمصادر المراجعة"), heading: true },
    ...data.findings.map((text) => ({ text })),
    { text: t("Input coverage", "تغطية المدخلات") + "  ·  " + ltr(lang, data.assessed.knownQuantities + " / " + data.assessed.totalQuantities) },
    { text: t("Identity evidence", "أدلة الهوية") + "  ·  " + ltr(lang, data.evidence.identifiedSides + " / 2") },
    ...data.sourceReferences.flatMap(({ title, url }) => [{ text: title, link: url }, { text: url, link: url }]),
    { text: t("A reported quantity is activity data. Emissions are modeled estimates. Missing data are excluded from totals and recorded as unavailable.",
      "الكمية المبلغ عنها تمثل بيانات النشاط. الانبعاثات تقديرات نمذجة. تُستبعد البيانات الناقصة من المجاميع وتُعرض على أنها غير متاحة.") },
  ];
  saveReport(t("Operation sustainability report", "تقرير استدامة العملية"), lang, rows, "aetheris-operation-" + id + ".pdf");
}

export function overviewPdf(data: ImpactOverview, lang: LabLanguage, scope: string, period: string) {
  const t = (en: string, ar: string) => words(lang, en, ar);
  const display = (value: number | null, unit: string) => value === null ? numberLabel(lang, null) : ltr(lang, numberLabel(lang, value, unit));
  const metric = (label: string, item: { value: number | null; covered: number }, unit: string) => ({
    text: label + "  ·  " + display(item.value, unit) + "  ·  " + t("Records with data", "السجلات المتوفرة") + " " + item.covered,
  });
  function chart(title: string, select: (row: ImpactBucket) => number | null, unit: string): Row[] {
    const points = data.series.flatMap((row) => {
      const value = select(row);
      return value === null ? [] : [{ period: row.period, value }];
    });
    const max = Math.max(1, ...points.map(({ value }) => Math.abs(value)));
    return [{ text: title, heading: true }, ...points.map(({ period, value }) =>
      ({ text: ltr(lang, period) + "  ·  " + display(value, unit), bar: value / max })),
    ...(points.length ? [] : [{ text: t("No values with the required evidence in this view.", "لا توجد قيم مدعومة بالأدلة المطلوبة في هذا العرض.") }])];
  }
  saveReport(t("Sustainability report", "تقرير الاستدامة"), lang, [
    { text: scope }, { text: period },
    { text: t("Assessments", "التقييمات") + "  ·  " + data.totals.assessments + "   " + t("Approved", "المعتمدة") + "  ·  " + data.totals.approved },
    { text: t("Verified outcomes", "النتائج الموثّقة") + "  ·  " + data.totals.verified + "   " + t("Pending outcomes", "النتائج المعلقة") + "  ·  " + data.totals.pending },
    { text: t("Confirmed actions", "الإجراءات المؤكدة") + "  ·  " + data.totals.confirmedActions + "   " +
      t("Historical outcomes awaiting re-review", "النتائج السابقة التي تنتظر إعادة المراجعة") + "  ·  " + data.totals.needsRecheck },
    metric(t("Estimated financial impact", "الأثر المالي التقديري"), data.totals.estimatedFinancial, data.currency),
    metric(t("Verified net financial impact", "صافي الأثر المالي الموثّق"), data.totals.verifiedFinancial, data.currency),
    metric(t("Purchase savings", "توفير الشراء"), data.totals.purchase, data.currency),
    metric(t("Replacement savings", "توفير الاستبدال"), data.totals.replacement, data.currency),
    metric(t("Disposal savings", "توفير التخلص"), data.totals.disposal, data.currency),
    metric(t("Waste avoided", "النفايات المتجنبة"), data.totals.avoided, "L"),
    metric(t("Waste mass avoided", "كتلة النفايات المتجنبة"), data.totals.avoidedKg, "kg"),
    metric(t("Materials preserved", "المواد المحفوظة"), data.totals.preserved, "L"),
    metric(t("Material mass preserved", "كتلة المواد المحفوظة"), data.totals.preservedKg, "kg"),
    metric(t("Waste segregated", "النفايات المفروزة"), data.totals.segregated, "L"),
    metric(t("Waste sent to recovery", "النفايات المرسلة للاسترجاع"), data.totals.recovery, "L"),
    metric(t("Waste sent to disposal", "النفايات المرسلة للتخلص"), data.totals.authorizedDisposal, "L"),
    metric(t("Estimated avoided emissions", "تقدير الانبعاثات المتجنبة"), data.totals.carbon, "kg CO₂e"),
    metric(t("Emissions based on verified activity", "الانبعاثات المقدرة من نشاط موثّق"), data.totals.verifiedCarbon, "kg CO₂e"),
    { text: t("Documented preventive actions", "الإجراءات الوقائية الموثّقة") + "  ·  " + data.totals.prevention },
    ...data.actions.map(({ label, count }) => ({ text: labLabel(lang, label) + "  ·  " + count })),
    ...chart(t("Estimated financial impact by period", "الأثر المالي التقديري حسب الفترة"), (row) => row.estimatedFinancial.value, data.currency),
    ...chart(t("Verified financial impact by period", "الأثر المالي الموثّق حسب الفترة"), (row) => row.verifiedFinancial.value, data.currency),
    ...chart(t("Estimated avoided emissions by period", "تقدير الانبعاثات المتجنبة حسب الفترة"), (row) => row.carbon.value, "kg CO₂e"),
    ...(data.references.length ? [{ text: t("Selected evidence sources", "مصادر مختارة للأدلة"), heading: true },
      ...data.references.map(({ title, url }) => ({ text: title, link: url ?? undefined }))] : []),
    { text: t("Methodology, coverage and limitations", "المنهجية والتغطية والقيود"), heading: true },
    { text: t("Net impact is the baseline cost minus the actual intervention cost. Carbon estimates use applicable stage-specific factors. Verified outcomes reflect the latest eligible reviewer decision. Charts are grouped by assessment date.",
      "صافي الأثر هو تكلفة السيناريو المرجعي ناقص التكلفة الفعلية للتدخل. تستند تقديرات الكربون إلى معاملات صالحة لكل مرحلة. تعتمد النتائج الموثقة على آخر قرار مراجعة مؤهل. تُجمع الرسوم حسب تاريخ التقييم.") },
    { text: t("Coverage is the number of records with a usable calculation. Amounts with missing evidence are unavailable. Linked operation reports contain the underlying source references.",
      "تبيّن التغطية عدد السجلات ذات الحسابات المتاحة. القيم التي تفتقر إلى الأدلة غير متاحة. تتضمن تقارير العمليات المرتبطة مراجع الأدلة الأصلية.") },
  ], "aetheris-sustainability-" + lang + ".pdf");
}
