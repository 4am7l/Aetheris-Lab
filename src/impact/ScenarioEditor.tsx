import { useState } from "react";
import { Button, MenuItem, TextField } from "@mui/material";
import { useLanguage } from "../text";
import { carbonStages, financialKinds, quantityUnits } from "./model";
import { labLabel } from "./labels";
import { words } from "./client";
import { LabInput, LabSelect } from "./Inputs";

const phases = ["baseline", "actual"] as const;
const units = quantityUnits.map((unit) => [unit, unit] as const);

function ScenarioLine({ prefix, carbon }: { prefix: string; carbon: boolean }) {
  const [mode, setMode] = useState("");
  const lang = useLanguage();
  return <div className="impact-grid compact">
    <TextField select size="small" fullWidth name={prefix + ".mode"} label={words(lang, "Input source", "مصدر المدخل")}
      value={mode} onChange={(event) => setMode(event.target.value)}>
      <MenuItem value="">{words(lang, "Unavailable", "غير متاح")}</MenuItem>
      <MenuItem value="rate">{words(lang, "Verified rate version", "نسخة معامل موثّقة")}</MenuItem>
      <MenuItem value="direct">{carbon ? words(lang, "Documented zero", "صفر موثّق") : words(lang, "Documented amount", "مبلغ موثّق")}</MenuItem>
    </TextField>
    {mode === "rate" && <>
      <LabInput name={prefix + ".material"} en="Material record ID" ar="معرّف سجل المادة" required />
      <LabInput name={prefix + ".version"} en="Rate version ID" ar="معرّف نسخة المعامل" required />
      <LabInput name={prefix + ".amount"} en="Quantity" ar="الكمية" type="number" required />
      <LabSelect name={prefix + ".unit"} en="Unit" ar="الوحدة" options={units} value="L" required />
      <LabInput name={prefix + ".density"} en="Density version ID, if applicable" ar="معرّف نسخة الكثافة عند انطباقها" />
      {!carbon && <LabInput name={prefix + ".supplier"} en="Supplier on record" ar="المورد في السجل" />}
    </>}
    {mode === "direct" && <>
      {!carbon && <LabInput name={prefix + ".amount"} en="Amount in selected currency" ar="المبلغ بالعملة المحددة" type="number" required />}
      <LabInput name={prefix + ".evidence"} en={carbon ? "Evidence for zero activity" : "Invoice or baseline evidence"}
        ar={carbon ? "دليل انعدام النشاط" : "مرجع الفاتورة أو السيناريو المرجعي"} required />
    </>}
  </div>;
}
function PhaseLines({ prefix, carbon, baseline }: { prefix: string; carbon: boolean; baseline: boolean }) {
  const lang = useLanguage();
  const [count, setCount] = useState(1);
  return <section className="impact-input-group">
    <h5>{baseline ? words(lang, "Baseline", "السيناريو المرجعي") : words(lang, "Intervention", "التدخل")}</h5>
    {Array.from({ length: count }, (_, i) => <ScenarioLine key={i} carbon={carbon} prefix={prefix + "." + i} />)}
    <Button size="small" disabled={count >= 10} onClick={() => setCount(count + 1)}>{words(lang, "Add line", "إضافة بند")}</Button>
    {count > 1 && <Button size="small" onClick={() => setCount(count - 1)}>{words(lang, "Remove last line", "حذف البند الأخير")}</Button>}
  </section>;
}
function QuantityFields({ name, en, ar }: { name: string; en: string; ar: string }) {
  return <div className="impact-grid compact">
    <LabInput name={name + ".amount"} en={en} ar={ar} type="number" />
    <LabSelect name={name + ".unit"} en="Unit" ar="الوحدة" options={units} value="L" required />
  </div>;
}

export function ScenarioEditor({ includePreservation = true }: { includePreservation?: boolean }) {
  const lang = useLanguage();
  return <div className="impact-form">
    <div className="impact-grid compact">
      <LabInput name="scenario.currency" en="Currency code" ar="رمز العملة" value="JOD" required />
      <LabSelect name="scenario.beneficiary" en="Expense owner" ar="صاحب النفقة" value="unassigned" required
        options={["unassigned", "personal", "institution"].map((x) => [x, labLabel(lang, x)])} />
    </div>
    <LabInput name="scenario.assumptions" en="Method and assumptions for both scenarios" ar="المنهج والافتراضات للسيناريوهين" required multiline />
    <div className="impact-grid compact">
      <LabInput name="scenario.source" en="Evidence reference title" ar="عنوان المرجع" required />
      <LabInput name="scenario.url" en="Source URL" ar="رابط المصدر" type="url" />
    </div>
    <details className="impact-details">
      <summary>{words(lang, "Waste generation and preservation", "توليد النفايات وحفظ المواد")}</summary>
      <QuantityFields name="scenario.wasteBaseline" en="Baseline waste" ar="نفايات السيناريو المرجعي" />
      <QuantityFields name="scenario.wasteActual" en="Intervention waste" ar="نفايات التدخل" />
      {includePreservation && <QuantityFields name="scenario.preserve" en="Potential volume or mass preserved" ar="الحجم أو الكتلة المحتمل حفظها" />}
    </details>
    {([["financial", financialKinds], ["emissions", carbonStages]] as const).map(([section, items]) => (
      <section key={section}>
        <h4>{section === "financial" ? words(lang, "Cost categories", "بنود التكلفة") : words(lang, "Emissions by lifecycle stage", "الانبعاثات حسب مرحلة دورة الحياة")}</h4>
        {items.map((item) => <details key={item} className="impact-details">
          <summary>{labLabel(lang, item === "recovery" ? "measureRecovery" : item === "disposal" ? "measureDisposal" : item)}</summary>
          <div className="impact-grid">
            {phases.map((phase) => <PhaseLines key={phase} prefix={section + "." + item + "." + phase} baseline={phase === "baseline"} carbon={section === "emissions"} />)}
          </div>
        </details>)}
      </section>
    ))}
  </div>;
}
