import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button, Card, CardContent, Chip } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PublicResult } from "../domain";
import { WasteAssessmentSection } from "../components/WasteAssessmentSection";
import { getTrackingToken } from "../services/receipts";
import { useLanguage } from "../text";
import type { OperationImpact } from "./contracts";
import { activityKinds, activityList, carbonStages, financialKinds, quantityUnits, type Activity, type ImpactCalculation } from "./model";
import { FormError, LabInput, LabSelect, Submit } from "./Inputs";
import { field, numeric, optional } from "./formData";
import { ScenarioEditor } from "./ScenarioEditor";
import { GuideReference } from "./GuideReference";
import { readScenario } from "./scenarioForm";
import { getCredential, keyedWrite, labApi, words, type LabApi, type PendingWrite } from "./client";
import { labLabel, numberLabel } from "./labels";
import "./impact.css";

export function MetricCards({ items }: { items: { title: string; value: ReactNode; detail?: string }[] }) {
  return <div className="impact-metrics">{items.map(({ title, value, detail }) => <Card variant="outlined" key={title}>
    <CardContent><span className="muted">{title}</span><strong className="impact-value"><bdi>{value}</bdi></strong>
      {detail && <small>{detail}</small>}</CardContent>
  </Card>)}</div>;
}

export function CalculationView({ calculation }: { calculation: ImpactCalculation }) {
  const lang = useLanguage();
  const t = (en: string, ar: string) => words(lang, en, ar);
  const n = (value: number | null, unit = calculation.currency) => numberLabel(lang, value, unit);
  const costRows = financialKinds.map((name) =>
    [labLabel(lang, name === "disposal" ? "measureDisposal" : name === "recovery" ? "measureRecovery" : name), calculation.financial[name], calculation.currency] as const);
  const carbonRows = carbonStages.map((name) =>
    [labLabel(lang, name === "disposal" ? "measureDisposal" : name), calculation.emissions[name], "kg CO₂e"] as const);
  return <>
    <MetricCards items={[
      { title: t("Personal savings", "التوفير الشخصي"), value: n(calculation.beneficiary === "personal" ? calculation.net.difference : null) },
      { title: t("University savings", "توفير الجامعة"), value: n(calculation.beneficiary === "institution" ? calculation.net.difference : null) },
      { title: t("Purchase savings", "توفير الشراء"), value: n(calculation.financial.purchase.difference) },
      { title: t("Replacement savings", "توفير الاستبدال"), value: n(calculation.financial.replacement.difference) },
      { title: t("Disposal savings", "توفير التخلص"), value: n(calculation.financial.disposal.difference) },
      { title: t("Net financial impact", "صافي الأثر المالي"), value: n(calculation.net.difference) },
      { title: t("Waste avoided", "النفايات المتجنبة"), value: calculation.wasteAvoided.difference === null ? n(calculation.wasteAvoidedKg.difference, "kg") : n(calculation.wasteAvoided.difference, "L") },
      { title: t("Material preserved", "المواد المحفوظة"), value: calculation.preserved.liters === null ? n(calculation.preserved.kilograms, "kg") : n(calculation.preserved.liters, "L") },
      { title: t("Estimated avoided emissions", "تقدير الانبعاثات المتجنبة"), value: n(calculation.avoidedCo2e.difference, "kg CO₂e") },
    ]} />
    <details className="impact-details">
      <summary>{t("Calculation details and sources", "تفاصيل الحساب والمصادر")}</summary>
      <p>{t("Baseline minus intervention", "السيناريو المرجعي ناقص التدخل")} · <bdi>{calculation.formulaVersion}</bdi></p>
      <p dir="auto">{calculation.assumptions}</p>
      <div className="impact-table"><table>
        <thead><tr><th>{t("Category", "البند")}</th><th>{t("Baseline", "المرجع")}</th><th>{t("Intervention", "التدخل")}</th><th>{t("Difference", "الفرق")}</th></tr></thead>
        <tbody>{[...costRows, ...carbonRows].map(([label, item, unit], i) => <tr key={i}>
          <th scope="row">{label}</th><td><bdi>{n(item.baseline, unit)}</bdi></td><td><bdi>{n(item.actual, unit)}</bdi></td><td><bdi>{n(item.difference, unit)}</bdi></td>
        </tr>)}</tbody>
      </table></div>
      <ul>{calculation.references.map(({ title, url }, i) => <li key={i} dir="auto">{url ?
        <a href={url} target="_blank" rel="noreferrer">{title}</a> : title}</li>)}</ul>
    </details>
  </>;
}

function ActivityFields({ initial }: { initial?: Activity[] }) {
  const lang = useLanguage();
  const [count, setCount] = useState(initial?.length || 1);
  const units = quantityUnits.map((unit) => [unit, unit] as const);
  return <>
    {Array.from({ length: count }, (_, i) => <fieldset key={i} className="impact-input-group">
      <legend>{words(lang, "Action", "الإجراء")} {i + 1}</legend>
      <div className="impact-grid compact">
        <LabSelect name={"kind" + i} en="Action taken" ar="الإجراء المتخذ" required
          value={initial?.[i]?.kind ?? "no-action"} options={activityKinds.map((x) => [x, labLabel(lang, x)])} />
        <LabInput name={"date" + i} en="Action date" ar="تاريخ الإجراء" type="date" required value={initial?.[i]?.date ?? new Date().toISOString().slice(0, 10)} />
        <LabInput name={"quantity" + i} en="Measured quantity, if applicable" ar="الكمية المقاسة عند انطباقها" type="number" value={initial?.[i]?.quantity?.value} />
        <LabSelect name={"unit" + i} en="Unit" ar="الوحدة" options={units} value={initial?.[i]?.quantity?.unit ?? "L"} required />
        <LabSelect name={"side" + i} en="Assessed input for this quantity" ar="المدخل المقيّم لهذه الكمية"
          options={[["A", "A"], ["B", "B"]]} value={initial?.[i]?.side} />
        <LabInput name={"material" + i} en="Verified formulation ID, if known" ar="معرّف التركيبة الموثّقة إن توفر" value={initial?.[i]?.materialId} />
      </div>
      <LabInput name={"documentation" + i} en="Supporting documentation or notes" ar="المستندات الداعمة أو الملاحظات" value={initial?.[i]?.documentation} multiline />
    </fieldset>)}
    <div className="button-row">
      <Button disabled={count >= 8} onClick={() => setCount(count + 1)}>{words(lang, "Add an action", "إضافة إجراء")}</Button>
      {count > 1 && <Button onClick={() => setCount(count - 1)}>{words(lang, "Remove last action", "حذف الإجراء الأخير")}</Button>}
    </div>
  </>;
}
function readActivities(form: FormData) {
  return activityList.parse(Array.from({ length: 8 }, (_, i) => {
    const q = numeric(form, "quantity" + i);
    return {
      kind: field(form, "kind" + i), date: field(form, "date" + i),
      quantity: q === undefined ? undefined : { value: q, unit: field(form, "unit" + i) },
      side: optional(form, "side" + i),
      materialId: optional(form, "material" + i), documentation: optional(form, "documentation" + i),
    };
  }).filter(({ kind }) => kind));
}

export function OperationDetails({ data, result }: { data: OperationImpact; result?: PublicResult }) {
  const lang = useLanguage();
  const t = (en: string, ar: string) => words(lang, en, ar);
  const empty = numberLabel(lang, null);
  const confirmed = data.current && !data.current.reviewRequired && ["verified", "corrected"].includes(data.current.state);
  const recheck = t("Historical calculation requires re-review", "الحساب السابق يتطلب مراجعة جديدة");
  return <>
    <div className="button-row"><Chip label={data.current?.reviewRequired ? recheck
      : data.current ? labLabel(lang, data.current.state) : t("No impact recorded", "لم يُسجّل أثر")} /></div>
    <MetricCards items={[
      { title: t("Input volume assessed", "حجم المدخلات المقيّمة"), value: numberLabel(lang, data.assessed.liters, "L") },
      { title: t("Input mass assessed", "كتلة المدخلات المقيّمة"), value: numberLabel(lang, data.assessed.kilograms, "kg") },
      { title: t("Documented incompatibility findings", "نتائج عدم التوافق الموثّقة"), value: data.findings.length || (data.classification === "Incompatible" ? 1 : 0) },
      { title: t("Preventive action verified", "الإجراء الوقائي موثّق"), value: confirmed && data.current?.activities.some((x) => x.kind === "abandoned") ? t("Yes", "نعم") : empty },
    ]} />
    <GuideReference rows={data.fixedGuide} />
    <h3>{t("Estimated impact", "الأثر التقديري")}</h3>
    {data.estimateReviewRequired && <p role="status">{recheck}</p>}
    {data.estimate && !data.estimateReviewRequired ? <CalculationView calculation={data.estimate} /> : !data.estimate && <p className="muted">{t("A reviewed baseline and intervention are required for impact estimates.", "يلزم اعتماد السيناريو المرجعي والتدخل لإصدار تقديرات الأثر.")}</p>}
    {data.current && data.current.state !== "estimated" && <section>
      <h3>{confirmed ? t("Verified outcomes", "النتائج الموثّقة") : t("Reported outcomes", "النتائج المبلغ عنها")}</h3>
      {data.current.reason && <p dir="auto">{data.current.reason}</p>}
      <ul>{data.current.activities.map((a) => <li key={a.kind}>
        {labLabel(lang, a.kind)} · <bdi>{a.date}</bdi>{a.quantity && " · " + numberLabel(lang, a.quantity.value, a.quantity.unit)}
        {a.documentation && <p dir="auto">{a.documentation}</p>}
      </li>)}</ul>
      {confirmed && data.current.calculation && <CalculationView calculation={data.current.calculation} />}
    </section>}
    <details className="impact-details">
      <summary>{t("Evidence quality and data completeness", "جودة الأدلة واكتمال البيانات")}</summary>
      <dl className="impact-facts">
        <div><dt>{t("Identity references for submitted materials", "مراجع هوية المواد المقدّمة")}</dt><dd>{data.evidence.identifiedSides} / 2</dd></div>
        <div><dt>{t("Quantities provided", "الكميات المدخلة")}</dt><dd>{data.assessed.knownQuantities} / {data.assessed.totalQuantities}</dd></div>
        <div><dt>{t("Reviewed citations", "الاستشهادات المراجعة")}</dt><dd>{data.evidence.citedSources}</dd></div>
        <div><dt>{t("Applicability conditions", "شروط الانطباق")}</dt><dd>{result?.conditions || (data.evidence.conditionsDocumented ? t("Documented in the approved report", "موثّقة في التقرير المعتمد") : empty)}</dd></div>
        <div><dt>{t("Conflicts and limitations", "التعارضات والقيود")}</dt><dd>{result?.limitations.join(" · ") || (data.evidence.uncertaintyDocumented ? t("See reviewed limitations", "راجع القيود الموثّقة") : empty)}</dd></div>
        <div><dt>{t("Calculation coverage", "تغطية الحساب")}</dt><dd>{data.evidence.coveredFinancialCategories} / 6 · {data.evidence.coveredCarbonStages} / 4</dd></div>
        <div><dt>{t("Human review", "المراجعة البشرية")}</dt><dd>{t("Approved scientific assessment", "التقييم العلمي معتمد")}</dd></div>
      </dl>
      {data.findings.length > 0 && <ul>{data.findings.map((finding, i) => <li key={i} dir="auto">{finding}</li>)}</ul>}
      <ul>{data.sourceReferences.map(({ title, url }, i) => <li key={i}><a href={url} target="_blank" rel="noreferrer">{title}</a></li>)}</ul>
    </details>
    {data.reviewedWaste && <details className="impact-details"><summary>{t("Reviewed waste classification", "تصنيف النفايات المراجع")}</summary><WasteAssessmentSection assessment={data.reviewedWaste} /></details>}
    {data.events.length > 0 && <details className="impact-details"><summary>{t("Impact history", "سجل الأثر")}</summary>
      <ol>{data.events.map((event) => <li key={event.id}><bdi>{new Date(event.createdAt).toLocaleString(lang)}</bdi> · {labLabel(lang, event.state)} · <bdi>#{event.id}</bdi>
        {event.reviewRequired && <p>{recheck}</p>}
        {event.calculation && <details><summary>{t("View stored calculation", "عرض الحساب المحفوظ")}</summary>
          <CalculationView calculation={event.calculation} /></details>}
        {event.reason && <p dir="auto">{event.reason}</p>}</li>)}</ol>
    </details>}
  </>;
}

export function ReceiptImpact({ id, result }: { id: string; result: PublicResult }) {
  const lang = useLanguage();
  const t = (en: string, ar: string) => words(lang, en, ar);
  const client = useQueryClient();
  const token = getTrackingToken(id);
  const api = labApi("/api/impact/operations", { token: token ?? "" });
  const key = ["impact-operation", id];
  const query = useQuery({ queryKey: key, enabled: Boolean(token), gcTime: 0, retry: false,
    queryFn: async ({ signal }) => {
      const operation = await api<OperationImpact>("/" + id, undefined, signal);
      if (!operation.assessed || !operation.evidence) throw new Error("Invalid operation impact envelope");
      return operation;
    } });
  const [notice, setNotice] = useState("");
  const [exportError, setExportError] = useState<unknown>();
  const pendingWrite = useRef<PendingWrite>(null);
  const save = useMutation({
    mutationFn: ({ path, input }: { path: string; input: unknown }) => api<OperationImpact>("/" + id + path, input),
    onSuccess: (data) => { pendingWrite.current = null; client.setQueryData(key, data); },
    onError: () => { void query.refetch(); },
    gcTime: 0,
  });
  const link = useMutation({
    mutationFn: async (kind: "profile" | "membership") => {
      const credential = getCredential(kind);
      if (!credential || !token) throw new Error("Missing credentials");
      return labApi("/api/impact", { token: credential })(kind === "profile" ? "/profile/link" : "/workspace/affiliate", { id, receipt: token });
    },
    onSuccess: () => setNotice(t("Receipt linked.", "تم ربط الإيصال.")),
  });
  const data = query.data;
  const state = data?.current?.state;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const activities = readActivities(new FormData(event.currentTarget));
      setNotice("");
      save.mutate({ path: "/report", input: keyedWrite({ expectedId: data?.current?.id ?? 0, activities }, pendingWrite, "/report") });
    } catch {
      setNotice(t("Review the action dates, measured quantities, and documentation.", "راجع تواريخ الإجراءات والكميات المقاسة والمستندات."));
    }
  }
  return <section className="panel impact-panel">
    <h2>{t("Impact", "الأثر")}</h2>
    {query.isPending && <p role="status">{t("Loading impact…", "جارٍ تحميل الأثر…")}</p>}
    {(query.isError || !data) && <FormError error={query.error} />}
    {data && <>
      <OperationDetails data={data} result={result} />
      <div className="button-row">
        {getCredential("profile") && <Button variant="outlined" disabled={link.isPending} onClick={() => link.mutate("profile")}>{t("Link to personal dashboard", "ربط بلوحة الأثر الشخصي")}</Button>}
        {getCredential("membership") && <Button variant="outlined" disabled={link.isPending} onClick={() => link.mutate("membership")}>{t("Link to my laboratory", "ربط بمختبري")}</Button>}
        <Button variant="outlined" onClick={() => {
          setExportError(undefined);
          void import("./reports").then(({ operationPdf }) => operationPdf(id, data, lang)).catch(setExportError);
        }}>{t("Download impact PDF", "تنزيل تقرير الأثر PDF")}</Button>
      </div>
      <FormError error={exportError} />
      {data.writable && (!state || ["estimated", "rejected", "cancelled"].includes(state) || (state === "pending-verification" && data.current?.reason)) &&
        <details className="impact-details">
          <summary>{t("Document the action taken", "توثيق الإجراء المتخذ")}</summary>
          <form className="impact-form" onSubmit={submit}>
            <ActivityFields key={data.current?.id ?? "initial"} initial={data.current?.activities} />
            <Submit busy={save.isPending}>{t("Submit for verification", "إرسال للتحقق")}</Submit>
          </form>
        </details>}
      {data.writable && state === "pending-verification" &&
          <Button disabled={save.isPending} onClick={() => save.mutate({ path: "/withdraw",
            input: keyedWrite({ expectedId: data.current?.id ?? 0 }, pendingWrite, "/withdraw") })}>{t("Withdraw action report", "سحب تقرير الإجراء")}</Button>}
      <FormError error={save.error || link.error} />
      {notice && <p role="status">{notice}</p>}
    </>}
  </section>;
}

export function ReviewImpact({ id, api, scopeKey, result, readOnly }: {
  id: string; api: LabApi; scopeKey: string; result?: PublicResult; readOnly?: boolean;
}) {
  const lang = useLanguage();
  const t = (en: string, ar: string) => words(lang, en, ar);
  const key = ["impact-review", scopeKey, id];
  const client = useQueryClient();
  const route = "/operations/" + id;
  const query = useQuery({ queryKey: key, retry: false, gcTime: 0, queryFn: ({ signal }) => api<OperationImpact>(route, undefined, signal) });
  const [decision, setDecision] = useState("verify");
  const [scenario, setScenario] = useState(false);
  const [formatError, setFormatError] = useState("");
  const pendingWrite = useRef<PendingWrite>(null);
  const save = useMutation({
    mutationFn: ({ action, payload }: { action: string; payload: unknown }) => api<OperationImpact>(route + "/" + action, payload),
    onSuccess: (data) => {
      pendingWrite.current = null;
      client.setQueryData(key, data);
      void client.invalidateQueries({ queryKey: ["impact-overview"] });
      setScenario(false);
    },
    onError: () => { void query.refetch(); },
    gcTime: 0,
  });
  const guideReview = useMutation({
    mutationFn: (payload: unknown) => api<OperationImpact>(route + "/guide-match", payload),
    onSuccess: (updated) => client.setQueryData(key, updated),
    onError: () => { void query.refetch(); },
    gcTime: 0,
  });
  const data = query.data;
  if (!data) return <section className="panel impact-panel"><h2>{t("Impact review", "مراجعة الأثر")}</h2>
    {query.isPending && <p role="status">{t("Loading…", "جارٍ التحميل…")}</p>}<FormError error={query.error} /></section>;
  const state = data.current?.state;
  const pending = state === "pending-verification";
  const final = state === "verified" || state === "corrected";
  const choices = pending ? [["verify", "Verify", "تحقق"], ["clarify", "Clarify", "اطلب توضيحاً"], ["reject", "Reject", "ارفض"]] :
    [["correct", "Correct", "صحّح"], ["cancel", "Cancel", "ألغِ"]];
  const selectedDecision = choices.some(([value]) => value === decision) ? decision : choices[0][0];
  const verifiesAction = selectedDecision === "verify" || selectedDecision === "correct";
  function submit(event: FormEvent<HTMLFormElement>, action: "review" | "estimate") {
    event.preventDefault();
    setFormatError("");
    const form = new FormData(event.currentTarget);
    try {
      const payload = {
        expectedId: data?.current?.id ?? 0,
        scenario: action === "estimate" || scenario ? readScenario(form) : undefined,
        ...(action === "review" ? {
          decision: selectedDecision, reason: field(form, "reason"), realizedEvidence: optional(form, "realizedEvidence"),
          evidenceReference: optional(form, "evidenceReference"),
          activities: selectedDecision === "correct" ? readActivities(form) : undefined,
        } : {}),
      };
      save.mutate({ action, payload: keyedWrite(payload, pendingWrite, action) });
    } catch {
      setFormatError(t("Check the scenario inputs, evidence and action quantities.", "تحقق من مدخلات السيناريو والأدلة وكميات الإجراءات."));
    }
  }
  return <section className="panel impact-panel">
    <h2>{readOnly ? t("Operation impact", "أثر العملية") : t("Impact review", "مراجعة الأثر")}</h2>
    <p>{t("Operation ID", "معرّف العملية")} · <bdi className="impact-wrap">{id}</bdi></p>
    <OperationDetails data={data} result={result} />
    {!readOnly && data.writable && data.fixedGuide?.filter((row) => row.canReviewMatch).map((row) =>
      <details className="impact-details" key={row.side + ":" + row.decisionId}>
        <summary>{t("Review guide formulation match", "مراجعة مطابقة التركيبة للدليل")} · <bdi>{row.side}</bdi></summary>
        <form className="impact-form" onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          guideReview.mutate({ side: row.side, expectedId: row.decisionId, applicable: field(form, "applicable") === "yes",
            reason: field(form, "reason") });
        }}>
          <LabSelect name="applicable" en="Formulation matches original row" ar="التركيبة تطابق سجل الدليل الأصلي" required
            value={row.reviewedMatch === null ? "" : row.reviewedMatch ? "yes" : "no"}
            options={[["yes", t("Confirmed", "مؤكد")], ["no", t("Does not match", "غير مطابق")]]} />
          <LabInput name="reason" en="Formulation evidence and reason" ar="دليل التركيبة وسبب القرار" required multiline />
          <Submit busy={guideReview.isPending} />
        </form>
      </details>)}
    {!readOnly && data.writable && (!state || state === "estimated") && <details className="impact-details">
      <summary>{t("Publish a reviewed estimate", "نشر تقدير مراجع")}</summary>
      <form className="impact-form" onSubmit={(e) => submit(e, "estimate")} key={data.current?.id ?? 0}>
        <ScenarioEditor />
        <Submit busy={save.isPending}>{t("Publish estimate", "نشر التقدير")}</Submit>
      </form>
    </details>}
    {!readOnly && data.writable && (pending || final) && <details className="impact-details" open={pending}>
      <summary>{t("Record verification decision", "تسجيل قرار التحقق")}</summary>
      <form className="impact-form" key={data.current?.id} onSubmit={(e) => submit(e, "review")}>
        <div className="button-row">
          {choices.map(([value, en, ar]) =>
            <Button key={value} variant={selectedDecision === value ? "contained" : "outlined"} aria-pressed={selectedDecision === value}
              onClick={() => { setDecision(value); setScenario(false); }}>{t(en, ar)}</Button>)}
        </div>
        <LabInput name="reason" en="Decision reason visible to the receipt holder" ar="سبب القرار الظاهر لحامل الإيصال" required multiline />
        {selectedDecision === "correct" && <ActivityFields initial={data.current?.activities} />}
        {verifiesAction && <LabInput name="evidenceReference" en="Unique action evidence record ID" ar="معرّف سجل دليل الإجراء الفريد"
          required={selectedDecision === "verify" && data.current?.activities.some((a) => a.kind !== "no-action")} />}
        {verifiesAction && <label>
          <input type="checkbox" checked={scenario} onChange={(event) => setScenario(event.target.checked)} />
          {" "}{t("Include documented impact calculations", "إضافة حسابات الأثر الموثقة")}
        </label>}
        {scenario && <>
          <LabInput name="realizedEvidence" en="Actual activity and transaction evidence" ar="أدلة النشاط والمعاملات الفعلية" required multiline />
          <ScenarioEditor includePreservation={false} />
        </>}
        <Submit busy={save.isPending} />
      </form>
    </details>}
    {formatError && <p role="alert">{formatError}</p>}
    <FormError error={save.error || guideReview.error} />
  </section>;
}
