import { useLanguage } from "../text";
import type { FixedGuideEstimate } from "./contracts";
import { numberLabel, fixedGuideStatus } from "./labels";
import { words } from "./client";

export function GuideReference({ rows }: { rows: FixedGuideEstimate[] }) {
  const lang = useLanguage();
  const t = (en: string, ar: string) => words(lang, en, ar);
  if (!rows?.length) return null;
  return <section>
    <h3>{t("Fixed reference estimates", "تقديرات الدليل الثابت")}</h3>
    <p className="muted">{t("These rates describe the assessed material. Savings totals require a baseline and intervention comparison.",
      "تصف هذه المعاملات المادة المقيّمة. تتطلب مجاميع الوفورات مقارنة بين السيناريو المرجعي والتدخل.")}</p>
    {rows.map((row) => <div className="impact-input-group" key={row.side}>
      <h4><bdi>{row.side} · {lang === "ar" ? row.nameAr : row.nameEn}</bdi></h4>
      <p><bdi>{[row.cas, row.concentration, row.formulation].filter(Boolean).join(" · ")}</bdi> · {fixedGuideStatus(lang, row.status)}</p>
      <dl className="impact-facts">
        <div><dt>{t("Original combined cost rate", "سعر التكلفة المجمّعة الأصلي")}</dt>
          <dd><bdi>{row.sourcePrice} {row.sourcePriceUnit}</bdi></dd></div>
        <div><dt>{t("Original emissions factor", "معامل الانبعاثات الأصلي")}</dt>
          <dd><bdi>{row.sourceFactor} {row.sourceFactorUnit}</bdi></dd></div>
        <div><dt>{t("Estimated cost and emissions for assessed volume", "التكلفة والانبعاثات المقدّرة للحجم المقيّم")}</dt>
          <dd>{row.inputEstimate ? <bdi>{numberLabel(lang, row.inputEstimate.volume, "L")} ·{" "}
            {numberLabel(lang, row.inputEstimate.combinedCost, row.currency)} · {numberLabel(lang, row.inputEstimate.co2e, "kg CO₂e")}</bdi> :
            numberLabel(lang, null)}</dd></div>
      </dl>
      <p className="small muted"><bdi>{row.document}</bdi> · {t("Page", "الصفحة")} {row.page} · {t("Row", "السطر")} {row.rowNumber}</p>
    </div>)}
  </section>;
}
