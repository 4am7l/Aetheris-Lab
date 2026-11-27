import { useState, type FormEvent } from "react";
import { Button } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useLanguage } from "../text";
import { statusLabel } from "../reviewText";
import { useText } from "../text";
import type { ImpactOverview, ImpactTotals, OrganizationDirectory } from "./contracts";
import { activityKinds, impactStates } from "./model";
import { FormError, LabInput, LabSelect } from "./Inputs";
import { field } from "./formData";
import { MetricCards, ReviewImpact } from "./Operation";
import { download, words, type LabApi } from "./client";
import { labLabel, numberLabel } from "./labels";

type Point = { label: string; number: number };

function runningTotal(points: Point[]) {
  let total = 0;
  return points.map(({ label, number }) => {
    total += number;
    return { label, number: total };
  });
}
function Chart({ title, points, unit }: { title: string; points: Point[]; unit?: string }) {
  const lang = useLanguage();
  const [index, setIndex] = useState<number | null>(null);
  const selected = index === null ? null : points[index];
  const max = Math.max(0, ...points.map(({ number }) => Math.abs(number)));
  return <section className="impact-details">
    <h3>{title}</h3>
    {points.length ? <>
      <div className="impact-bars" aria-label={title}>
        {points.map(({ label, number }, i) => <button type="button" className="impact-bar" aria-pressed={index === i}
          key={i} onClick={() => setIndex(i)}>
          <bdi>{label}</bdi> · <bdi>{numberLabel(lang, number, unit)}</bdi>
          <span className={"impact-bar-amount" + (number < 0 ? " negative" : "")} style={{ inlineSize: (max ? Math.abs(number) / max * 100 : 0) + "%" }} />
        </button>)}
      </div>
      {selected && <p role="status"><bdi>{selected.label}</bdi> · <bdi>{numberLabel(lang, selected.number, unit)}</bdi></p>}
    </> : <p className="muted">{words(lang, "No data in this view.", "لا تتوفر بيانات في هذا العرض.")}</p>}
  </section>;
}

type MetricName = { [K in keyof ImpactTotals]: ImpactTotals[K] extends number ? never : K }[keyof ImpactTotals];

export function Dashboard({ api, contextKey, personal, directory, canReview, onOpen, scopeLabel }: {
  api: LabApi; contextKey: string; personal?: boolean; directory?: OrganizationDirectory; canReview?: boolean; onOpen?: (id: string) => void; scopeLabel?: string;
}) {
  const lang = useLanguage();
  const statusText = useText();
  const t = (en: string, ar: string) => words(lang, en, ar);
  const [params, setParams] = useState("period=month");
  const [page, setPage] = useState("");
  const [operation, setOperation] = useState("");
  const [exportError, setExportError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const endpoint = personal ? "/personal" : "/overview";
  const suffix = "?" + params + "&lang=" + lang;
  const query = useQuery({
    queryKey: ["impact-overview", contextKey, suffix, page], gcTime: 0, retry: false,
    queryFn: ({ signal }) => api<ImpactOverview>(endpoint + suffix + (page ? "&after=" + page : ""), undefined, signal),
  });
  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const filters = new URLSearchParams();
    for (const key of ["from", "to", "university", "department", "lab", "chemical", "action", "status", "period", "currency", "q"]) {
      const value = field(form, key);
      if (value) filters.set(key, key === "currency" ? value.toUpperCase() : value);
    }
    setParams(filters.toString());
    setPage("");
    setOperation("");
  }

  const formValues = new URLSearchParams(params);
  const name = (item: { nameEn: string; nameAr: string }) => lang === "ar" ? item.nameAr : item.nameEn;
  function filterItems(items: { id: string; nameEn: string; nameAr: string }[]) {
    return items.map((item) => [item.id, name(item)] as const);
  }
  const data = query.data;
  const m = data?.totals;
  function values(metric: MetricName) {
    return data?.series.flatMap((series) => series[metric].value === null ? [] : [{ label: series.period, number: series[metric].value }]) ?? [];
  }
  const estimated = values("estimatedFinancial");
  const financial = values("verifiedFinancial");
  const currency = data?.currency ?? "JOD";
  const historyUrl = (id: string) => "/requests/" + id + "/receipt";
  const scope = [formValues.get("university"), formValues.get("department"), formValues.get("lab")]
    .flatMap((id) => {
      const record = [...(directory?.institutions ?? []), ...(directory?.departments ?? []), ...(directory?.labs ?? [])].find((x) => x.id === id);
      return record ? [name(record)] : [];
    }).join(" / ");
  async function exportReport(format: "csv" | "pdf") {
    if (!data) return;
    setBusy(true);
    setExportError(undefined);
    try {
      if (format === "csv") download(await api<Blob>("/overview.csv" + suffix), "aetheris-impact-" + lang + ".csv");
      else {
        const { overviewPdf } = await import("./reports");
        const dates = [formValues.get("from"), formValues.get("to")].filter(Boolean).join(" – ");
        overviewPdf(data, lang, scope || scopeLabel || (personal ? t("Personal dashboard", "لوحة الأثر الشخصي") : t("Institutional scope", "نطاق المؤسسة")),
          dates || t("All assessment dates", "جميع تواريخ التقييم"));
      }
    } catch (cause) { setExportError(cause); }
    finally { setBusy(false); }
  }

  return <section className="panel impact-panel">
    <h2>{personal ? t("Personal impact", "الأثر الشخصي") : t("Sustainability and impact", "الاستدامة والأثر")}</h2>
    <details open className="impact-details"><summary>{t("Dashboard filters", "مرشحات اللوحة")}</summary>
      <form className="impact-form" onSubmit={filter}>
        <div className="impact-grid compact">
          <LabInput name="from" en="Assessment date from" ar="تاريخ التقييم من" type="date" />
          <LabInput name="to" en="Assessment date to" ar="تاريخ التقييم إلى" type="date" />
          <LabSelect name="period" en="Group by" ar="التجميع حسب" required value="month" options={[
            ["month", t("Month", "شهري")], ["quarter", t("Quarter", "ربع سنوي")], ["year", t("Year", "سنوي")], ["all", t("All time", "كامل الفترة")],
          ]} />
          {!personal && directory && <>
            {directory.institutions.length > 1 && <LabSelect name="university" en="University" ar="الجامعة" options={filterItems(directory.institutions)} />}
            <LabSelect name="department" en="Department" ar="القسم" options={filterItems(directory.departments)} />
            <LabSelect name="lab" en="Laboratory" ar="المختبر" options={filterItems(directory.labs)} />
          </>}
          <LabInput name="chemical" en="Chemical name or CAS" ar="اسم المادة أو CAS" />
          <LabSelect name="action" en="Action type" ar="نوع الإجراء" options={activityKinds.map((x) => [x, labLabel(lang, x)])} />
          <LabSelect name="status" en="Verification status" ar="حالة التحقق" options={impactStates.map((x) => [x, labLabel(lang, x)])} />
          <LabInput name="q" en="Search the operation log" ar="البحث في سجل العمليات" />
          <LabInput name="currency" en="Currency" ar="العملة" value="JOD" />
        </div>
        <div className="button-row">
          <Button type="submit" variant="contained">{t("Apply filters", "تطبيق التصفية")}</Button>
          {canReview && <Button variant="outlined" onClick={() => { setParams("period=month&status=pending-verification"); setPage(""); setOperation(""); }}>
            {t("Verification queue", "قائمة انتظار التحقق")}
          </Button>}
        </div>
      </form>
    </details>
    {query.isPending && <p role="status">{t("Loading metrics…", "جارٍ تحميل المؤشرات…")}</p>}
    <FormError error={query.error || exportError} />
    {data && m && <>
      {!m.verified && <p className="muted">{t("There are no verified outcomes for these filters yet.", "لا توجد نتائج موثّقة لهذه المرشحات بعد.")}</p>}
      {m.needsRecheck > 0 && <p role="status">{t("Historical outcomes awaiting re-review", "النتائج السابقة التي تنتظر إعادة المراجعة")} · {m.needsRecheck}</p>}
      <MetricCards items={[
        { title: t("Assessments", "التقييمات"), value: m.assessments },
        { title: t("Completed assessments", "التقييمات المكتملة"), value: m.completed },
        { title: t("Approved assessments", "التقييمات المعتمدة"), value: m.approved },
        { title: t("Reported actions", "الإجراءات المبلغ عنها"), value: m.reported },
        { title: t("Pending verifications", "عمليات التحقق المعلّقة"), value: m.pending },
        { title: t("Documented incompatibilities", "حالات عدم التوافق الموثّقة"), value: m.incompatibilities },
        { title: t("Input volume assessed", "حجم المدخلات المقيّمة"), value: numberLabel(lang, m.assessed.value, "L") },
      ]} />
      <h3>{t("Scenario estimates", "تقديرات السيناريوهات")}</h3>
      <MetricCards items={[
        { title: t("Estimated net financial impact", "صافي الأثر المالي التقديري"), value: numberLabel(lang, m.estimatedFinancial.value, currency) },
        { title: t("Estimated avoided emissions", "تقدير الانبعاثات المتجنبة"), value: numberLabel(lang, m.carbon.value, "kg CO₂e") },
      ]} />
      <h3>{t("Verified outcomes", "النتائج الموثّقة")}</h3>
      <MetricCards items={[
        { title: t("Outcomes reviewed", "النتائج التي تمت مراجعتها"), value: m.verified },
        { title: t("Confirmed actions", "الإجراءات المؤكدة"), value: m.confirmedActions },
        { title: t("Documented preventive actions", "الإجراءات الوقائية الموثّقة"), value: m.prevention },
        ...([
          ["verifiedFinancial", t("Verified net financial savings", "صافي التوفير المالي الموثّق"), currency],
          ["purchase", t("Verified purchase savings", "توفير الشراء الموثّق"), currency],
          ["replacement", t("Verified replacement savings", "توفير الاستبدال الموثّق"), currency],
          ["disposal", t("Verified disposal savings", "توفير التخلص الموثّق"), currency],
          ["preserved", t("Material preserved", "المواد المحفوظة"), "L"],
          ["preservedKg", t("Material mass preserved", "كتلة المواد المحفوظة"), "kg"],
          ["avoided", t("Waste avoided", "النفايات المتجنبة"), "L"],
          ["avoidedKg", t("Waste mass avoided", "كتلة النفايات المتجنبة"), "kg"],
          ["segregated", t("Waste correctly segregated", "النفايات المفرزة بشكل صحيح"), "L"],
          ["segregatedKg", t("Waste mass correctly segregated", "كتلة النفايات المفرزة بشكل صحيح"), "kg"],
          ["recovery", t("Waste sent to authorized recovery", "النفايات المرسلة لاسترجاع معتمد"), "L"],
          ["recoveryKg", t("Waste mass sent to authorized recovery", "كتلة النفايات المرسلة لاسترجاع معتمد"), "kg"],
          ["authorizedDisposal", t("Waste sent to authorized disposal", "النفايات المرسلة لتخلص معتمد"), "L"],
          ["authorizedDisposalKg", t("Waste mass sent to authorized disposal", "كتلة النفايات المرسلة لتخلص معتمد"), "kg"],
          ["verifiedCarbon", t("Estimated emissions avoided from verified activity", "الانبعاثات المتجنبة من نشاط موثّق"), "kg CO₂e"],
        ] as [MetricName, string, string][]).map(([key, title, unit]) =>
          ({ title, value: numberLabel(lang, m[key].value, unit), detail: t("Records with usable data ", "السجلات ذات بيانات صالحة ") + m[key].covered })),
      ]} />
      <div className="button-row">
        <Button variant="outlined" disabled={busy} onClick={() => void exportReport("pdf")}>{t("Download PDF", "تنزيل PDF")}</Button>
        {!personal && <Button variant="outlined" disabled={busy} onClick={() => void exportReport("csv")}>{t("Export CSV", "تصدير CSV")}</Button>}
      </div>
      <div className="impact-grid">
        <Chart title={t("Estimated financial impact by period", "الأثر المالي التقديري حسب الفترة")} points={estimated} unit={currency} />
        <Chart title={t("Verified financial impact by period", "الأثر المالي الموثّق حسب الفترة")} points={financial} unit={currency} />
        <Chart title={t("Cumulative verified financial impact in this view", "الأثر المالي التراكمي الموثّق في العرض")} unit={currency}
          points={runningTotal(financial)} />
        <Chart title={t("Waste reduction over time", "تقليل النفايات بمرور الوقت")} points={values("avoided")} unit="L" />
        <Chart title={t("Estimated environmental impact over time", "الأثر البيئي التقديري بمرور الوقت")} points={values("carbon")} unit="kg CO₂e" />
        <Chart title={t("Verified action types", "أنواع الإجراءات الموثّقة")} points={data.actions.map(({ label, count }) => ({ label: labLabel(lang, label), number: count }))} />
        <Chart title={t("Submitted chemical categories", "فئات المواد المقدمة")} points={data.categories.map(({ label, count }) => ({ label, number: count }))} />
        {!personal && <Chart title={t("Assessments by laboratory", "التقييمات حسب المختبر")} points={data.laboratories.map(({ label, count }) => ({ label, number: count }))} />}
        {!personal && <Chart title={t("Verified net savings by laboratory", "صافي التوفير الموثّق حسب المختبر")} unit={currency}
          points={data.laboratories.flatMap(({ label, value }) => value === null ? [] : [{ label, number: value }])} />}
      </div>
      <div className="impact-grid">
        <section><h3>{t("Most assessed chemicals", "المواد الأكثر تقييماً")}</h3><ul>{data.chemicals.map(({ label, count, liters }) =>
          <li key={label} dir="auto">{label} · {count}{liters !== null && " · " + numberLabel(lang, liters, "L")}</li>)}</ul></section>
        <section><h3>{t("Most documented incompatibilities", "حالات عدم التوافق الأكثر توثيقاً")}</h3><ul>{data.incompatibilities.map(({ label, count }) => <li key={label} dir="auto">{label} · {count}</li>)}</ul></section>
      </div>
      {data.references.length > 0 && <details className="impact-details">
        <summary>{t("Selected assessment and calculation sources", "مصادر مختارة للتقييمات والحسابات")}</summary>
        <ul>{data.references.map(({ title, url }, i) => <li key={i} dir="auto">{url ? <a href={url} target="_blank" rel="noreferrer">{title}</a> : title}</li>)}</ul>
      </details>}
      <h3>{t("Assessment, waste and prevention log", "سجل التقييمات والنفايات والإجراءات الوقائية")}</h3>
      {data.log.length === 0 ? <p className="muted">{t("No linked assessments match.", "لا توجد تقييمات مرتبطة مطابقة.")}</p> :
        <div className="impact-table"><table>
          <thead><tr><th>{t("Operation", "العملية")}</th><th>{t("Assessment", "التقييم")}</th><th>{t("Verification", "التحقق")}</th><th>{t("Reported actions and hazards", "الإجراءات والأخطار المبلغ عنها")}</th></tr></thead>
          <tbody>{data.log.map((item) => <tr key={item.id}>
            <td><bdi>{item.names.join(" · ")}</bdi><br /><time>{item.date.slice(0, 10)}</time>
              {personal && <div><Link to={historyUrl(item.id)}>{t("Open receipt", "فتح الإيصال")}</Link></div>}
              {!personal && item.status === "Approved" && <div><Button size="small" onClick={() => onOpen ? onOpen(item.id) : setOperation(item.id)}>{t("Open impact", "فتح الأثر")}</Button></div>}
            </td><td>{statusText(statusLabel[item.status])}</td>
            <td>{item.reviewRequired ? t("Requires re-review", "يتطلب مراجعة جديدة") : item.state ? labLabel(lang, item.state) : "—"}</td>
            <td>{item.actions.map((x) => labLabel(lang, x)).join(" · ")}
              {item.findings.length > 0 && <details><summary>{t("Reviewed findings", "النتائج المراجعة")}</summary>
                <ul>{item.findings.map((finding, i) => <li key={i} dir="auto">{finding}</li>)}</ul>
              </details>}</td>
          </tr>)}</tbody>
        </table></div>}
      <div className="button-row">
        {page && <Button onClick={() => setPage("")}>{t("First page", "الصفحة الأولى")}</Button>}
        {data.next && <Button onClick={() => { setPage(data.next ?? ""); setOperation(""); }}>{t("Next page", "الصفحة التالية")}</Button>}
      </div>
      {operation && <ReviewImpact key={operation} id={operation} api={api} scopeKey={contextKey} readOnly={!canReview} />}
    </>}
  </section>;
}
