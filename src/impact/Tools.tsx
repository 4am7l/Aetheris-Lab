import { useState, type FormEvent } from "react";
import { Button } from "@mui/material";
import { useMutation } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import PageHeading from "../components/PageHeading";
import { useLanguage } from "../text";
import elements from "./elements.json";
import { FormError, LabInput, LabSelect, Submit } from "./Inputs";
import { field, numeric } from "./formData";
import { CalculationView, MetricCards } from "./Operation";
import { ScenarioEditor } from "./ScenarioEditor";
import { readScenario } from "./scenarioForm";
import { concentrationSource, periodicSource, scientific, type ScientificMode } from "./scientificCalculator";
import { quantityUnits, type ImpactCalculation } from "./model";
import { labApi, words, type LabApi } from "./client";
import { numberLabel } from "./labels";
import "./impact.css";

const modes = [
  ["mass", "Molar mass", "الكتلة المولية"], ["molarity", "Molarity", "المولارية"],
  ["molality", "Molality", "المولالية"], ["dilution", "Dilution", "التخفيف"],
  ["mass-concentration", "Mass concentration", "التركيز الكتلي"],
  ["percent-mass", "Mass percentage", "النسبة المئوية الكتلية"], ["percent-volume", "Volume percentage", "النسبة المئوية الحجمية"],
  ["percent-mass-volume", "Mass–volume percentage", "النسبة المئوية كتلة/حجم"],
  ["conversion", "Unit conversion", "تحويل الوحدات"], ["balance", "Conserved solute mass balance", "اتزان كتلة المذاب المحفوظة"],
  ["impact", "Financial and environmental impact", "الأثر المالي والبيئي"],
] as const;

type InputLabels = [string, string][];
const labels: Partial<Record<ScientificMode, InputLabels>> = {
  molarity: [["Amount of solute (mol)", "كمية المذاب (مول)"], ["Measured solution volume (L)", "حجم المحلول المقاس (لتر)"]],
  molality: [["Amount of solute (mol)", "كمية المذاب (مول)"], ["Solvent mass (kg)", "كتلة المذيب (كغم)"]],
  dilution: [["Stock concentration (mol/L)", "تركيز المحلول الأصلي (مول/لتر)"], ["Stock volume (L)", "حجم المحلول الأصلي (لتر)"],
    ["Measured final solution volume (L)", "الحجم النهائي المقاس (لتر)"]],
  "mass-concentration": [["Mass of solute (g)", "كتلة المذاب (غم)"], ["Measured solution volume (L)", "حجم المحلول المقاس (لتر)"]],
  "percent-mass": [["Mass of solute (g)", "كتلة المذاب (غم)"], ["Total mass of solution (g)", "كتلة المحلول الكلية (غم)"]],
  "percent-volume": [["Volume of solute (mL)", "حجم المذاب (مل)"], ["Measured final volume (mL)", "الحجم النهائي المقاس (مل)"]],
  "percent-mass-volume": [["Mass of solute (g)", "كتلة المذاب (غم)"], ["Measured final volume (mL)", "الحجم النهائي المقاس (مل)"]],
  conversion: [["Quantity", "الكمية"]],
  balance: [["First stock concentration (mol/L)", "تركيز المحلول الأول (مول/لتر)"], ["First stock volume (L)", "حجم المحلول الأول (لتر)"],
    ["Second stock concentration (mol/L)", "تركيز المحلول الثاني (مول/لتر)"], ["Second stock volume (L)", "حجم المحلول الثاني (لتر)"],
    ["Measured final volume (L)", "الحجم النهائي المقاس (لتر)"]],
};
const keys = ["first", "second", "third", "fourth", "final"];
const publicApi = labApi("/api/impact");

export function Calculators({ api = publicApi }: { api?: LabApi }) {
  const lang = useLanguage();
  const t = (en: string, ar: string) => words(lang, en, ar);
  const [mode, setMode] = useState<ScientificMode | "impact">("mass");
  const [result, setResult] = useState<ReturnType<typeof scientific>>();
  const [error, setError] = useState(false);
  const impact = useMutation({ mutationFn: (form: FormData) => api<ImpactCalculation>("/calculator", readScenario(form)), gcTime: 0 });
  function evaluate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (mode === "impact") { impact.mutate(form); return; }
    const outcome = scientific(mode, { formula: field(form, "formula"), unit: field(form, "unit"),
      ...Object.fromEntries(keys.map((key) => [key, numeric(form, key)])) });
    setResult(outcome);
    setError(outcome === null);
  }
  return <section className="panel impact-panel">
    <h2>{t("Scientific calculators", "الحاسبات العلمية")}</h2>
    <label htmlFor="calculator-mode">{t("Calculation", "الحساب")}</label>
    <select id="calculator-mode" value={mode} onChange={(event) => {
      setMode(event.target.value as typeof mode); setResult(undefined); setError(false); impact.reset();
    }}>
      {modes.map(([key, en, ar]) => <option key={key} value={key}>{t(en, ar)}</option>)}
    </select>
    <form className="impact-form" key={mode} onSubmit={evaluate}>
      {mode === "impact" ? <ScenarioEditor /> : <div className="impact-grid compact">
        {mode === "mass" && <LabInput name="formula" en="Molecular formula (e.g. H2O)" ar="الصيغة الجزيئية (مثل H2O)" required />}
        {labels[mode]?.map(([en, ar], i) => <LabInput key={keys[i]} name={keys[i]} en={en} ar={ar} type="number" required />)}
        {mode === "conversion" && <LabSelect name="unit" en="Original unit" ar="الوحدة الأصلية" required value="mL" options={quantityUnits.map((x) => [x, x])} />}
      </div>}
      <Submit busy={impact.isPending}>{t("Calculate", "احسب")}</Submit>
    </form>
    {mode === "mass" ? <p>{t("Uses PubChem reference weights for elements with standard atomic weights. Isotope-specific masses and hydrates require a separate method.",
      "تُستخدم قيم PubChem المرجعية للعناصر ذات الأوزان الذرية القياسية. تتطلب كتل النظائر والهيدرات طريقة مستقلة.")} <a href={periodicSource} target="_blank" rel="noreferrer">PubChem</a></p> :
      mode !== "impact" && <p>{t("Use measurements in the stated units. Concentration and balance formulas assume conserved solute and measured final volume where applicable. They do not assess reactions or mixing safety.",
        "استخدم قياسات بالوحدات المبينة. تفترض معادلات التركيز والاتزان حفظ المذاب والحجم النهائي المقاس عند انطباقه. ولا تقيّم التفاعلات أو سلامة الخلط. ")} <a href={concentrationSource} target="_blank" rel="noreferrer">OpenStax Chemistry 2e</a></p>}
    {mode === "impact" && <p>{t("Baseline minus intervention. Estimates use verified rates available to this workspace and the entered assumptions. Publication on an assessment requires qualified review.",
      "السيناريو المرجعي ناقص التدخل. تستخدم التقديرات المعاملات الموثّقة المتاحة لمساحة العمل والافتراضات المدخلة. يتطلب النشر في التقييم مراجعة مؤهلة.")}</p>}
    {error && <p role="alert">{t("The input is out of range or this calculation is unavailable.", "القيم خارج النطاق أو الحساب غير متاح.")}</p>}
    <FormError error={impact.error} />
    {result && <div role="status"><MetricCards items={[{ title: t("Calculated value", "القيمة المحسوبة"), value: numberLabel(lang, result.value, result.unit) }]} /></div>}
    {mode === "impact" && impact.data && <CalculationView calculation={impact.data} />}
  </section>;
}

const colors: Record<string, string> = {
  "Nonmetal": "#5aa7a1", "Noble gas": "#7d91db", "Alkali metal": "#da8465", "Alkaline earth metal": "#d3a444",
  "Metalloid": "#99a653", "Halogen": "#96a5d5", "Transition metal": "#a880c2", "Post-transition metal": "#72a8c6",
  "Lanthanide": "#c8739c", "Actinide": "#d2927b",
};
const categories: Record<string, string> = {
  "Nonmetal": "لافلز", "Noble gas": "غاز نبيل", "Alkali metal": "فلز قلوي", "Alkaline earth metal": "فلز قلوي ترابي",
  "Metalloid": "شبه فلز", "Halogen": "هالوجين", "Transition metal": "فلز انتقالي", "Post-transition metal": "فلز بعد انتقالي",
  "Lanthanide": "لانثانيد", "Actinide": "أكتينيد",
};

export function PeriodicTable() {
  const lang = useLanguage();
  const t = (en: string, ar: string) => words(lang, en, ar);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState(0);
  const needle = q.normalize("NFKC").trim().toLowerCase().replaceAll("أ", "ا").replaceAll("إ", "ا");
  const visible = needle ? elements.filter((e) =>
    [e.symbol, e.nameEn, e.nameAr.replaceAll("أ", "ا").replaceAll("إ", "ا"), String(e.number)].some((value) => value.toLowerCase().includes(needle))) : elements;
  const element = elements.find((e) => e.number === selected);
  return <section className="panel impact-panel">
    <h2>{t("Periodic table", "الجدول الدوري")}</h2>
    <label htmlFor="element-search">{t("Search by element name, symbol or number", "البحث باسم العنصر أو رمزه أو رقمه")}</label>
    <input id="element-search" value={q} onChange={(event) => setQ(event.target.value)} />
    {visible.length === 0 && <p>{t("No elements match.", "لا توجد عناصر مطابقة.")}</p>}
    {needle ? <div className="button-row">{visible.map((e) => <Button variant="outlined" key={e.number} onClick={() => setSelected(e.number)}>
      {e.symbol} · {lang === "ar" ? e.nameAr : e.nameEn}
    </Button>)}</div> :
      <div className="impact-table" tabIndex={0} aria-label={t("Elements grouped by period", "العناصر مرتبة حسب الدورة")}>
        <div className="impact-periodic">{elements.map((e) => <button key={e.number} className="impact-element" type="button"
          aria-label={(lang === "ar" ? e.nameAr : e.nameEn) + " " + e.number} aria-pressed={selected === e.number}
          style={{ gridRow: e.row, gridColumn: e.column, "--element-color": colors[e.category] ?? "#84948f" } as React.CSSProperties}
          onClick={() => setSelected(e.number)}><small>{e.number}</small><strong>{e.symbol}</strong></button>)}</div>
      </div>}
    {element && <section className="impact-details">
      <h3>{lang === "ar" ? element.nameAr : element.nameEn} · <bdi>{element.symbol}</bdi></h3>
      <dl className="impact-facts">
        <div><dt>{t("Atomic number", "العدد الذري")}</dt><dd>{element.number}</dd></div>
        <div><dt>{element.isotope ? t("Reference isotope mass (u)", "كتلة النظير المرجعية (u)") : t("Reference atomic weight", "الوزن الذري المرجعي")}</dt><dd><bdi>{element.weight}</bdi></dd></div>
        <div><dt>{t("Category", "الفئة")}</dt><dd>{lang === "ar" ? categories[element.category] ?? element.category : element.category}</dd></div>
        <div><dt>{t("State", "الحالة")}</dt><dd>{element.state ?? numberLabel(lang, null)}</dd></div>
        <div><dt>{t("Melting point", "درجة الانصهار")}</dt><dd><bdi>{element.meltingK ? element.meltingK + " K" : numberLabel(lang, null)}</bdi></dd></div>
        <div><dt>{t("Boiling point", "درجة الغليان")}</dt><dd><bdi>{element.boilingK ? element.boilingK + " K" : numberLabel(lang, null)}</bdi></dd></div>
        <div><dt>{t("Density", "الكثافة")}</dt><dd><bdi>{element.density ? element.density + " g/cm³" : numberLabel(lang, null)}</bdi></dd></div>
      </dl>
      <div className="button-row">
        <Link to={"/library/explorer?q=" + encodeURIComponent(element.nameEn)}>{t("Find related chemical records", "البحث عن سجلات كيميائية ذات صلة")}</Link>
        <a href={"https://pubchem.ncbi.nlm.nih.gov/element/" + element.nameEn} target="_blank" rel="noreferrer">{t("PubChem element source", "مرجع العنصر في PubChem")}</a>
      </div>
    </section>}
    <p><a href={periodicSource} target="_blank" rel="noreferrer">{t("PubChem periodic table data", "بيانات الجدول الدوري من PubChem")}</a></p>
  </section>;
}

export default function ToolsPage() {
  const lang = useLanguage();
  return <div className="page">
    <PageHeading title={words(lang, "Science tools", "الأدوات العلمية")} />
    <Calculators />
    <PeriodicTable />
  </div>;
}
