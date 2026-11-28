import { Button } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import PageHeading from "../components/PageHeading";
import { statusLabel } from "../reviewText";
import { getTrackingToken } from "../services/receipts";
import { useReceipts } from "../services/useReceipts";
import { useLanguage, useText } from "../text";
import { labApi, words } from "./client";
import { receiptStatisticsBatchSize, type AssessmentImpact, type AssessmentImpactValues } from "./contracts";
import { FormError } from "./Inputs";
import { ImpactCharts, ImpactMethod, ImpactValues, MetricCards } from "./Statistics";
import { impactSeries } from "./statisticsMetrics";
import "./impact.css";

const api = labApi("/api/impact");

async function readAssessments(ids: string[], signal: AbortSignal) {
  const receipts = ids.flatMap((id) => {
    const receipt = getTrackingToken(id);
    return receipt ? [{ id, receipt }] : [];
  });
  const assessments: AssessmentImpact[] = [];
  for (let index = 0; index < receipts.length; index += receiptStatisticsBatchSize) {
    const batch = await api<{ assessments: AssessmentImpact[] }>("/personal", {
      receipts: receipts.slice(index, index + receiptStatisticsBatchSize),
    }, signal);
    assessments.push(...batch.assessments);
  }
  return assessments.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
}

function summaries(assessments: AssessmentImpact[]) {
  const coverage = Object.fromEntries(impactSeries.map(({ key }) => [key, 0])) as Record<keyof AssessmentImpactValues, number>;
  const unavailable: AssessmentImpactValues = { estimate: null, realized: null, carbon: null, verifiedCarbon: null,
    estimatedWaste: null, estimatedWasteKg: null, waste: null, wasteKg: null };
  const values = { ...unavailable };
  const periods = new Map<string, AssessmentImpactValues & { period: string }>();
  for (const row of assessments) {
    const period = row.date.slice(0, 7);
    let bucket = periods.get(period);
    if (!bucket) {
      bucket = { ...unavailable, period };
      periods.set(period, bucket);
    }
    for (const { key } of impactSeries) {
      const value = row[key];
      if (value === null) continue;
      coverage[key]++;
      values[key] = (values[key] ?? 0) + value;
      bucket[key] = (bucket[key] ?? 0) + value;
    }
  }
  return { values, coverage, series: [...periods.values()].slice(0, 120).reverse() };
}

export default function Personal() {
  const lang = useLanguage();
  const t = (en: string, ar: string) => words(lang, en, ar);
  const statusText = useText();
  const { receipts, storageUnavailable } = useReceipts();
  const ids = receipts.map(({ id }) => id).sort();
  const query = useQuery({
    queryKey: ["personal-impact", ids], gcTime: 0, retry: false, enabled: ids.length > 0,
    refetchInterval: 30_000, refetchOnWindowFocus: true,
    queryFn: ({ signal }) => readAssessments(ids, signal),
  });
  const data = query.isError ? undefined : query.data;
  const summary = data && summaries(data);
  const hasReceipts = ids.length > 0;
  return <div className="page">
    <PageHeading title={t("Personal impact", "الأثر الشخصي")} />
    <section className="panel impact-panel">
      <p>{t("This dashboard uses analysis receipts saved in this browser.", "تستخدم هذه اللوحة إيصالات التحليل المحفوظة في هذا المتصفح.")}</p>
      {storageUnavailable && <p role="status">{statusText("receiptStorageUnavailable")}</p>}
      {!hasReceipts && <div>
        <p>{t("There are no saved receipts to show here.", "لا توجد إيصالات محفوظة لعرضها هنا.")}</p>
        <Link className="text-link" to="/requests">{t("View assessment receipts", "عرض إيصالات التقييم")}</Link>
      </div>}
      {hasReceipts && <div className="button-row">
        <Button variant="outlined" disabled={query.isFetching} onClick={() => void query.refetch()}>
          {t("Refresh statistics", "تحديث الإحصاءات")}
        </Button>
      </div>}
      {hasReceipts && query.isPending && <p role="status">{t("Loading statistics…", "جارٍ تحميل الإحصاءات…")}</p>}
      <FormError error={query.error} />
      {data && summary && <>
        <h2>{t("Cumulative totals", "المجاميع التراكمية")}</h2>
        <MetricCards items={[
          { title: t("Tracked assessments", "التقييمات المتابَعة"), value: data.length },
          { title: t("Approved assessments", "التقييمات المعتمدة"), value: data.filter(({ status }) => status === "Approved").length },
        ]} />
        <ImpactValues values={summary.values} coverage={summary.coverage} />
        <ImpactMethod />
        <ImpactCharts series={summary.series} />
        <h2>{t("Assessment breakdown", "تفاصيل التقييمات")}</h2>
        {!data.length && <p>{t("No accessible assessments are available for the saved receipts.", "لا توجد تقييمات متاحة للإيصالات المحفوظة.")}</p>}
        <div className="impact-statistics">{data.map((row) => <details className="impact-details" key={row.id}>
          <summary><bdi>{row.names.join(" · ")}</bdi> · <bdi>{row.date.slice(0, 10)}</bdi> · {statusText(statusLabel[row.status])}</summary>
          {row.status === "Approved" && <ImpactValues values={row} />}
          {row.status !== "Approved" && <p>{t("Impact statistics require a current human approval.", "تتطلب إحصاءات الأثر اعتماداً بشرياً سارياً.")}</p>}
          <Link className="text-link" to={"/requests/" + row.id + "/receipt"}>{t("Open receipt", "فتح الإيصال")}</Link>
        </details>)}</div>
      </>}
    </section>
  </div>;
}
