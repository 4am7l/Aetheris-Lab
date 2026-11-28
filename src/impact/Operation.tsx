import { useState } from "react";
import { Button } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { getTrackingToken } from "../services/receipts";
import { useLanguage } from "../text";
import { labApi, words, type LabApi } from "./client";
import type { AssessmentStatistics } from "./contracts";
import { GuideReference } from "./GuideReference";
import { FormError } from "./Inputs";
import { numberLabel } from "./labels";
import { ImpactMethod, ImpactValues, MetricCards } from "./Statistics";
import "./impact.css";

function AssessmentImpactSection({ id, api, scope }: { id: string; api: LabApi; scope: "receipt" | "platform" }) {
  const lang = useLanguage();
  const t = (en: string, ar: string) => words(lang, en, ar);
  const [exportError, setExportError] = useState<unknown>();
  const query = useQuery({
    queryKey: ["assessment-impact", scope, id], retry: false, gcTime: 0,
    refetchInterval: 30_000, refetchOnWindowFocus: true,
    queryFn: ({ signal }) => api<AssessmentStatistics>("/operations/" + id, undefined, signal),
  });
  const data = query.isError ? undefined : query.data;
  return <section className="panel impact-panel">
    <h2>{t("Assessment impact", "أثر التقييم")}</h2>
    <FormError error={query.error || exportError} />
    {query.isPending && <p role="status">{t("Loading statistics…", "جارٍ تحميل الإحصاءات…")}</p>}
    {data && <>
      <MetricCards items={[
        { title: t("Input volume assessed", "حجم المدخلات المقيّمة"), value: numberLabel(lang, data.assessed.liters, "L") },
        { title: t("Input mass assessed", "كتلة المدخلات المقيّمة"), value: numberLabel(lang, data.assessed.kilograms, "kg") },
      ]} />
      <ImpactValues values={data} />
      <ImpactMethod />
      <GuideReference rows={data.fixedGuide} />
      <div className="button-row">
        <Button variant="outlined" onClick={() => {
          setExportError(undefined);
          void import("./reports").then(({ operationPdf }) => operationPdf(id, data, lang)).catch(setExportError);
        }}>{t("Download impact PDF", "تنزيل تقرير الأثر PDF")}</Button>
      </div>
    </>}
  </section>;
}

export function ReceiptImpact({ id }: { id: string }) {
  const token = getTrackingToken(id);
  return token ? <AssessmentImpactSection id={id} api={labApi("/api/impact", { token })} scope="receipt" /> : null;
}

export function ReviewImpact({ id, api }: { id: string; api: LabApi }) {
  return <AssessmentImpactSection id={id} api={api} scope="platform" />;
}
