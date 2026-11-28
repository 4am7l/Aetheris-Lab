import { useState, type FormEvent } from "react";
import { Button } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useLanguage, useText } from "../text";
import { statusLabel } from "../reviewText";
import type { AssessmentImpactValues, ImpactMetric, ImpactOverview, ImpactTotals, OrganizationDirectory } from "./contracts";
import { FormError, LabInput, LabSelect } from "./Inputs";
import { field } from "./formData";
import { download, words, type LabApi } from "./client";
import { ImpactCharts, ImpactMethod, ImpactValues, MetricCards, Chart } from "./Statistics";
import { numberLabel } from "./labels";
import { groupedTotals } from "./statisticsMetrics";

function breakdown<K extends keyof ImpactMetric>(totals: ImpactTotals, key: K) {
  return Object.fromEntries(Object.entries(groupedTotals(totals)).map(([metric, value]) => [metric, value[key]])) as
    Record<keyof AssessmentImpactValues, ImpactMetric[K]>;
}

export function Dashboard({ api, directory }: { api: LabApi; directory: OrganizationDirectory }) {
  const lang = useLanguage();
  const statusText = useText();
  const t = (en: string, ar: string) => words(lang, en, ar);
  const [params, setParams] = useState("period=month");
  const [page, setPage] = useState("");
  const [exportError, setExportError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const suffix = "?" + params + "&lang=" + lang;
  const query = useQuery({
    queryKey: ["impact-overview", suffix, page], gcTime: 0, retry: false, refetchInterval: 30_000, refetchOnWindowFocus: true,
    queryFn: ({ signal }) => api<ImpactOverview>("/overview" + suffix + (page ? "&after=" + page : ""), undefined, signal),
  });
  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const filters = new URLSearchParams();
    for (const key of ["from", "to", "university", "department", "lab", "chemical", "period", "q"]) {
      const value = field(form, key);
      if (value) filters.set(key, value);
    }
    setParams(filters.toString());
    setPage("");
  }
  const filters = new URLSearchParams(params);
  const data = query.isError ? undefined : query.data;
  const totals = data?.totals;
  const name = (item: { nameEn: string; nameAr: string }) => lang === "ar" ? item.nameAr : item.nameEn;
  const options = (items: { id: string; nameEn: string; nameAr: string }[]) => items.map((item) => [item.id, name(item)] as const);
  async function exportReport(format: "csv" | "pdf") {
    if (!data) return;
    setBusy(true);
    setExportError(undefined);
    try {
      if (format === "csv") download(await api<Blob>("/overview.csv" + suffix), "aetheris-impact-" + lang + ".csv");
      else {
        const { overviewPdf } = await import("./reports");
        const dates = [filters.get("from"), filters.get("to")].filter(Boolean).join(" – ");
        const scope = [filters.get("university"), filters.get("department"), filters.get("lab")].flatMap((id) => {
          const record = [...directory.institutions, ...directory.departments, ...directory.labs].find((item) => item.id === id);
          return record ? [name(record)] : [];
        }).join(" / ");
        overviewPdf(data, lang, scope || t("Platform-wide", "على مستوى المنصة"), dates || t("All assessment dates", "جميع تواريخ التقييم"));
      }
    } catch (cause) { setExportError(cause); }
    finally { setBusy(false); }
  }

  return <section className="panel impact-panel">
    <h2>{t("Sustainability and impact", "الاستدامة والأثر")}</h2>
    <details open className="impact-details"><summary>{t("Dashboard filters", "مرشحات اللوحة")}</summary>
      <form className="impact-form" onSubmit={filter}>
        <div className="impact-grid compact">
          <LabInput name="from" en="Assessment date from" ar="تاريخ التقييم من" type="date" />
          <LabInput name="to" en="Assessment date to" ar="تاريخ التقييم إلى" type="date" />
          <LabSelect name="period" en="Group by" ar="التجميع حسب" required value="month" options={[
            ["month", t("Month", "شهري")], ["quarter", t("Quarter", "ربع سنوي")], ["year", t("Year", "سنوي")], ["all", t("All time", "كامل الفترة")],
          ]} />
          {directory.institutions.length > 0 && <LabSelect name="university" en="University" ar="الجامعة" options={options(directory.institutions)} />}
          {directory.departments.length > 0 && <LabSelect name="department" en="Department" ar="القسم" options={options(directory.departments)} />}
          {directory.labs.length > 0 && <LabSelect name="lab" en="Laboratory" ar="المختبر" options={options(directory.labs)} />}
          <LabInput name="chemical" en="Chemical name or CAS" ar="اسم المادة أو CAS" />
          <LabInput name="q" en="Search assessment history" ar="البحث في سجل التقييمات" />
        </div>
        <div className="button-row">
          <Button type="submit" variant="contained">{t("Apply filters", "تطبيق التصفية")}</Button>
          <Button disabled={query.isFetching} onClick={() => void query.refetch()}>{t("Refresh statistics", "تحديث الإحصاءات")}</Button>
        </div>
      </form>
    </details>
    {query.isPending && <p role="status">{t("Loading statistics…", "جارٍ تحميل الإحصاءات…")}</p>}
    <FormError error={query.error || exportError} />
    {data && totals && <>
      <h3>{t("Cumulative totals", "المجاميع التراكمية")}</h3>
      <MetricCards items={[
        { title: t("Assessments", "التقييمات"), value: totals.assessments },
        { title: t("Completed assessments", "التقييمات المكتملة"), value: totals.completed },
        { title: t("Approved assessments", "التقييمات المعتمدة"), value: totals.approved },
        { title: t("Documented incompatibilities", "حالات عدم التوافق الموثّقة"), value: totals.incompatibilities },
      ]} />
      <ImpactValues values={breakdown(totals, "value")} coverage={breakdown(totals, "covered")} />
      <ImpactMethod />
      <div className="button-row">
        <Button variant="outlined" disabled={busy} onClick={() => void exportReport("pdf")}>{t("Download PDF", "تنزيل PDF")}</Button>
        <Button variant="outlined" disabled={busy} onClick={() => void exportReport("csv")}>{t("Export CSV", "تصدير CSV")}</Button>
      </div>
      <ImpactCharts series={data.series.map((point) => ({ ...breakdown(point, "value"), period: point.period }))} />
      <details className="impact-details">
        <summary>{t("Assessment activity", "نشاط التقييمات")}</summary>
        <div className="impact-grid">
          <Chart title={t("Assessments by laboratory", "التقييمات حسب المختبر")} points={data.laboratories.map(({ label, count }) => ({ label, number: count }))} />
          <section><h4>{t("Most assessed chemicals", "المواد الأكثر تقييماً")}</h4><ul>{data.chemicals.map(({ label, count }, index) =>
            <li key={index} dir="auto">{label} · {count}</li>)}</ul></section>
          <section><h4>{t("Most documented incompatibilities", "حالات عدم التوافق الأكثر توثيقاً")}</h4><ul>{data.incompatibilities.map(({ label, count }) =>
            <li key={label} dir="auto">{label} · {count}</li>)}</ul></section>
        </div>
      </details>
      <h3>{t("Assessment breakdown", "تفاصيل التقييمات")}</h3>
      {data.log.length === 0 ? <p className="muted">{t("No assessments match.", "لا توجد تقييمات مطابقة.")}</p> :
        <div className="impact-table"><table>
          <thead><tr><th scope="col">{t("Assessment", "التقييم")}</th><th scope="col">{t("Status", "الحالة")}</th>
            <th scope="col">{t("Hypothetical financial savings", "التوفير المالي الافتراضي")}</th>
            <th scope="col">{t("Verified financial savings", "التوفير المالي الموثّق")}</th></tr></thead>
          <tbody>{data.log.map((item) => <tr key={item.id}>
            <th scope="row"><Link className="text-link" to={"/requests/" + item.id}><bdi>{item.names.join(" · ")}</bdi></Link>
              <br /><bdi>{item.date.slice(0, 10)}</bdi></th>
            <td>{statusText(statusLabel[item.status])}</td>
            <td><bdi>{numberLabel(lang, item.estimate, "JOD")}</bdi></td>
            <td><bdi>{numberLabel(lang, item.realized, "JOD")}</bdi></td>
          </tr>)}</tbody>
        </table></div>}
      <div className="button-row">
        {page && <Button onClick={() => setPage("")}>{t("First page", "الصفحة الأولى")}</Button>}
        {data.next && <Button onClick={() => setPage(data.next ?? "")}>{t("Next page", "الصفحة التالية")}</Button>}
      </div>
    </>}
  </section>;
}
