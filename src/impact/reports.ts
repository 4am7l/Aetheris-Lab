import { jsPDF } from "jspdf";
import type { AssessmentImpactValues, AssessmentStatistics, ImpactMetric, ImpactOverview } from "./contracts";
import { download, words, type LabLanguage } from "./client";
import { fixedGuideStatus, numberLabel } from "./labels";
import { groupedTotals, impactGroups } from "./statisticsMetrics";

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
  const lastLine = height - margin - 35;
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
  for (const [index, row] of rows.entries()) {
    format(row.heading ? 19 : 15, row.heading);
    const rowRtl = rtl && !/^(?:https?:\/\/|[A-Za-z0-9-]{24,}$)/.test(row.text);
    const lines = wrap(row.text);
    const next = rows[index + 1];
    if (row.heading && next && y + 12 + 26 * lines.length + (next.heading ? 12 : 0) > lastLine) {
      flush();
      init();
      format(19, true);
    }
    if (row.heading) y += 12;
    for (const line of lines) {
      if (y > lastLine) { flush(); init(); format(row.heading ? 19 : 15, row.heading); }
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

function metricRows(lang: LabLanguage, values: AssessmentImpactValues, coverage?: Record<keyof AssessmentImpactValues, ImpactMetric>): Row[] {
  return impactGroups.flatMap((group) => [
    { text: words(lang, group.en, group.ar), heading: true },
    ...group.metrics.map(({ en, ar, unit, key }) => ({
      text: words(lang, en, ar) + " · " + ltr(lang, numberLabel(lang, values[key], unit)) +
        (coverage ? " · " + words(lang, "Assessments with data", "التقييمات ذات البيانات") + " " + coverage[key].covered : ""),
    })),
  ]);
}

function limitations(lang: LabLanguage): Row[] {
  return [
    { text: words(lang, "Evidence and limitations", "الأدلة والقيود"), heading: true },
    { text: words(lang, "Savings use baseline minus intervention. An approval alone does not establish savings. Missing values are unavailable. Carbon figures are modeled estimates, including those based on verified activity.",
      "تُحسب الوفورات بطرح التدخل من السيناريو المرجعي. لا يثبت الاعتماد وحده حدوث وفورات. تُعرض القيم المفقودة على أنها غير متاحة. أرقام الكربون تقديرات مبنية على نماذج حتى عند استنادها إلى نشاط موثّق.") },
  ];
}

export function operationPdf(id: string, data: AssessmentStatistics, lang: LabLanguage) {
  const t = (en: string, ar: string) => words(lang, en, ar);
  const amount = (value: number | null, unit: string) => ltr(lang, numberLabel(lang, value, unit));
  const guideRows: Row[] = data.fixedGuide.length ? [
    { text: t("Fixed reference estimates", "تقديرات الدليل الثابت"), heading: true },
    ...data.fixedGuide.flatMap((row) => [
      { text: ltr(lang, row.side) + " · " + (lang === "ar" ? row.nameAr : row.nameEn) + " · " + fixedGuideStatus(lang, row.status) },
      { text: t("Original cost rate", "التكلفة الأصلية") + " · " + row.sourcePrice + " " + row.sourcePriceUnit
        + " · " + t("Original factor", "المعامل الأصلي") + " · " + row.sourceFactor + " " + row.sourceFactorUnit },
      ...(row.inputEstimate ? [{ text: t("Assessed volume estimate", "تقدير الحجم المقيّم") + " · "
        + amount(row.inputEstimate.volume, "L") + " · " + amount(row.inputEstimate.combinedCost, row.currency)
        + " · " + amount(row.inputEstimate.co2e, "kg CO₂e") }] : []),
      { text: row.document + " · " + t("Page", "الصفحة") + " " + row.page + " · " + t("Row", "السطر") + " " + row.rowNumber },
    ]),
    { text: t("Guide values describe the assessed material and sit outside the savings totals.", "تصف قيم الدليل المادة المقيّمة وتبقى خارج مجاميع الوفورات.") },
  ] : [];
  saveReport(t("Assessment impact", "أثر التقييم"), lang, [
    { text: t("Assessment", "التقييم") + " · " + ltr(lang, id) },
    { text: t("Approval date", "تاريخ الاعتماد") + " · " + ltr(lang, data.completedAt?.slice(0, 10) ?? numberLabel(lang, null)) },
    { text: t("Input volume assessed", "حجم المدخلات المقيّمة") + " · " + amount(data.assessed.liters, "L") },
    { text: t("Input mass assessed", "كتلة المدخلات المقيّمة") + " · " + amount(data.assessed.kilograms, "kg") },
    ...metricRows(lang, data), ...guideRows, ...limitations(lang),
  ], "aetheris-impact-" + id + "-" + lang + ".pdf");
}

export function overviewPdf(data: ImpactOverview, lang: LabLanguage, scope: string, period: string) {
  const t = (en: string, ar: string) => words(lang, en, ar);
  const totals = groupedTotals(data.totals);
  const values = Object.fromEntries(Object.entries(totals).map(([metric, value]) => [metric, value.value])) as unknown as AssessmentImpactValues;
  saveReport(t("Sustainability report", "تقرير الاستدامة"), lang, [
    { text: scope }, { text: period },
    { text: t("Assessments", "التقييمات") + " · " + data.totals.assessments },
    { text: t("Approved assessments", "التقييمات المعتمدة") + " · " + data.totals.approved },
    ...metricRows(lang, values, totals),
    { text: t("Historical trends by assessment date", "الاتجاهات التاريخية حسب تاريخ التقييم"), heading: true },
    ...impactGroups.flatMap((group) => [
      { text: words(lang, group.en, group.ar), heading: true },
      ...group.metrics.flatMap(({ key, en, ar, unit }) => {
        const points = data.series.flatMap((row) => {
          const value = groupedTotals(row)[key].value;
          return value === null ? [] : [{ period: row.period, value }];
        });
        if (!points.length) return [];
        const max = Math.max(1, ...points.map(({ value }) => Math.abs(value)));
        return [{ text: t(en, ar), heading: true }, ...points.map(({ period, value }) => ({
          text: ltr(lang, period) + " · " + ltr(lang, numberLabel(lang, value, unit)), bar: value / max,
        }))];
      }),
    ]),
    ...limitations(lang),
  ], "aetheris-sustainability-" + lang + ".pdf");
}
