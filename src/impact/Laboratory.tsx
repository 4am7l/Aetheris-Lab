import { useState, type FormEvent } from "react";
import { Button, Chip } from "@mui/material";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLanguage } from "../text";
import type { InventoryItem, OrganizationDirectory } from "./contracts";
import { FormError, LabInput, LabSelect, Submit } from "./Inputs";
import { field, numeric, optional } from "./formData";
import { LabChoice, WriteForm } from "./Management";
import { quantityUnits } from "./model";
import { download, words, type LabApi } from "./client";
import { labLabel, numberLabel } from "./labels";
import { type SdsCandidate } from "./sds";

const units = quantityUnits.map((x) => [x, x] as const);
const movementTypes = [
  ["received", "Received", "استلام"], ["consumed", "Consumed", "استهلاك"], ["adjustment", "Adjustment", "تسوية"],
  ["returned", "Verified return", "إعادة موثّقة"], ["preserved", "Verified preservation", "حفظ موثّق"],
  ["recovery", "Verified recovery", "استرجاع موثّق"], ["disposal", "Verified disposal", "تخلص موثّق"],
] as const;

function InventoryEditor({ api, directory, item }: { api: LabApi; directory: OrganizationDirectory; item?: InventoryItem }) {
  return <WriteForm api={api} endpoint="/inventory" build={(form) => ({
    id: item?.id, labId: item?.labId ?? optional(form, "labId"), chemicalId: item?.chemicalId ?? field(form, "chemicalId"),
    container: item?.container ?? field(form, "container"), unit: item?.unit ?? field(form, "unit"),
    batch: optional(form, "batch"), location: field(form, "location"), bought: optional(form, "bought"),
    reviewBy: optional(form, "reviewBy"), priceId: optional(form, "priceId"),
  })}>
    <div className="impact-grid compact">
      {!item && <>
        <LabChoice directory={directory} />
        <LabInput name="chemicalId" en="Chemical reference ID" ar="معرّف المرجع الكيميائي" required />
        <LabInput name="container" en="Container identifier" ar="معرّف العبوة" required />
        <LabSelect name="unit" en="Stock unit" ar="وحدة المخزون" options={units} value="L" required />
      </>}
      <LabInput name="batch" en="Batch number" ar="رقم الدفعة" value={item?.batch} />
      <LabInput name="location" en="Storage location" ar="موقع التخزين" value={item?.location} required />
      <LabInput name="bought" en="Purchase date" ar="تاريخ الشراء" type="date" value={item?.bought} />
      <LabInput name="reviewBy" en="Expiry or review date" ar="تاريخ الانتهاء أو المراجعة" type="date" value={item?.reviewBy} />
      <LabInput name="priceId" en="Verified purchase-price version ID" ar="معرّف نسخة سعر الشراء الموثقة" value={item?.priceId} />
    </div>
  </WriteForm>;
}

function MovementForm({ api, id }: { api: LabApi; id: string }) {
  const lang = useLanguage();
  const [kind, setKind] = useState("received");
  const linked = ["preserved", "returned", "recovery", "disposal"].includes(kind);
  return <WriteForm api={api} endpoint={"/inventory/" + id + "/movement"} build={(form) => ({
    key: crypto.randomUUID(), kind, reason: field(form, "reason"), decrease: form.has("decrease"),
    ...(linked ? { requestId: field(form, "requestId"), impactEventId: numeric(form, "impactEventId") } :
      { quantity: { value: numeric(form, "amount"), unit: field(form, "unit") } }),
  })}>
    <div className="impact-pill-nav">{movementTypes.map(([value, en, ar]) => <Button size="small" key={value}
      aria-pressed={kind === value} variant={kind === value ? "contained" : "outlined"} onClick={() => setKind(value)}>
      {words(lang, en, ar)}
    </Button>)}</div>
    <div className="impact-grid compact">
      {linked ? <>
        <LabInput name="requestId" en="Verified operation ID" ar="معرّف العملية الموثقة" required />
        <LabInput name="impactEventId" en="Current verified event ID" ar="معرّف الحدث الموثّق الحالي" type="number" required />
      </> : <>
        <LabInput name="amount" en="Quantity" ar="الكمية" type="number" required />
        <LabSelect name="unit" en="Unit" ar="الوحدة" options={units} value="L" required />
        {kind === "adjustment" && <label><input type="checkbox" name="decrease" /> {words(lang, "Decrease stock", "تخفيض المخزون")}</label>}
      </>}
      <LabInput name="reason" en="Movement documentation" ar="توثيق حركة المخزون" required />
    </div>
  </WriteForm>;
}

export function Inventory({ api, context, directory, editable }: {
  api: LabApi; context: string; directory: OrganizationDirectory; editable: boolean;
}) {
  const lang = useLanguage();
  const t = (en: string, ar: string) => words(lang, en, ar);
  const [q, setQ] = useState("");
  const [lab, setLab] = useState("");
  const [after, setAfter] = useState("");
  const [id, setId] = useState("");
  const search = useQuery({
    queryKey: ["workspace", context, "stock", q, lab, after], retry: false, gcTime: 0,
    queryFn: ({ signal }) => api<{ items: InventoryItem[]; next: string | null }>("/inventory?" + new URLSearchParams({
      ...(q ? { q } : {}), ...(lab ? { lab } : {}), ...(after ? { after } : {}),
    }), undefined, signal),
  });
  const detail = useQuery({
    queryKey: ["workspace", context, "stock", id], enabled: Boolean(id), retry: false, gcTime: 0,
    queryFn: ({ signal }) => api<{ item: InventoryItem; movements: { id: number; kind: string; delta: number; reason: string; impactEventId: number | null; createdAt: string }[] }>("/inventory/" + id, undefined, signal),
  });
  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    setQ(field(data, "q")); setLab(field(data, "labId")); setAfter(""); setId("");
  }
  return <section className="panel impact-panel">
    <h2>{t("Chemical inventory", "المخزون الكيميائي")}</h2>
    {editable && <details className="impact-details"><summary>{t("Register a container", "تسجيل عبوة")}</summary>
      <InventoryEditor api={api} directory={directory} />
    </details>}
    <form className="impact-grid compact" onSubmit={filter}>
      <LabInput name="q" en="Chemical, container or location" ar="المادة أو العبوة أو الموقع" />
      <LabChoice directory={directory} /><Submit>{t("Find stock", "البحث في المخزون")}</Submit>
    </form>
    {search.data?.items.length === 0 && <p>{t("There is no stock in this view.", "لا يوجد مخزون في هذا العرض.")}</p>}
    <div className="impact-pill-nav">{search.data?.items.map((item) => <Button key={item.id} variant={id === item.id ? "contained" : "outlined"}
      aria-pressed={id === item.id} onClick={() => setId(item.id)}><bdi>{item.name} · {item.container} · {numberLabel(lang, item.quantity, item.unit)}</bdi></Button>)}</div>
    <div className="button-row">
      {after && <Button onClick={() => setAfter("")}>{t("First page", "الصفحة الأولى")}</Button>}
      {search.data?.next && <Button onClick={() => { setAfter(search.data?.next ?? ""); setId(""); }}>{t("Next page", "الصفحة التالية")}</Button>}
    </div>
    {detail.data && <section className="impact-form" key={id}>
      <h3 dir="auto">{detail.data.item.name} · {detail.data.item.container}</h3>
      <dl className="impact-facts">
        <div><dt>{t("Stock", "المخزون")}</dt><dd><bdi>{numberLabel(lang, detail.data.item.quantity, detail.data.item.unit)}</bdi></dd></div>
        <div><dt>{t("Location", "الموقع")}</dt><dd dir="auto">{detail.data.item.location}</dd></div>
        <div><dt>{t("Batch", "الدفعة")}</dt><dd>{detail.data.item.batch ?? "—"}</dd></div>
        <div><dt>{t("Review date", "تاريخ المراجعة")}</dt><dd>{detail.data.item.reviewBy ?? "—"}</dd></div>
        <div><dt>{t("Formulation", "التركيبة")}</dt><dd><bdi>{detail.data.item.chemicalId}</bdi></dd></div>
        <div><dt>{t("Price version", "نسخة السعر")}</dt><dd><bdi>{detail.data.item.priceId ?? "—"}</bdi></dd></div>
      </dl>
      {editable && <>
        <details className="impact-details"><summary>{t("Edit container metadata", "تعديل بيانات العبوة")}</summary>
          <InventoryEditor api={api} directory={directory} item={detail.data.item} />
        </details>
        <details className="impact-details"><summary>{t("Post a stock movement", "تسجيل حركة المخزون")}</summary>
          <MovementForm api={api} id={id} />
        </details>
      </>}
      <h4>{t("Movement history", "سجل الحركات")}</h4>
      {detail.data.movements.length ? <ol>{detail.data.movements.map((movement) => {
        const translated = movementTypes.find(([kind]) => kind === movement.kind);
        return <li key={movement.id}><bdi>{movement.createdAt.slice(0, 10)}</bdi> · {translated ? t(translated[1], translated[2]) : movement.kind} · <bdi>{numberLabel(lang, movement.delta, detail.data.item.unit)}</bdi>
          <p dir="auto">{movement.reason}</p></li>;
      })}</ol> : <p>{t("No stock movements have been recorded.", "لم تُسجل حركات مخزون.")}</p>}
    </section>}
    <FormError error={search.error || detail.error} />
  </section>;
}

interface SdsMetadata { id: string; title: string; status: string; revisionDate: string | null }
export function Documents({ api, context, directory, editable, reviewer }: {
  api: LabApi; context: string; directory: OrganizationDirectory; editable: boolean; reviewer: boolean;
}) {
  const lang = useLanguage();
  const t = (en: string, ar: string) => words(lang, en, ar);
  const [file, setFile] = useState<File>();
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [candidates, setCandidates] = useState<SdsCandidate[]>([]);
  const [alert, setAlert] = useState("");
  const [id, setId] = useState("");
  const [q, setQ] = useState("");
  const [after, setAfter] = useState("");
  const list = useQuery({
    queryKey: ["workspace", context, "documents", q, after], retry: false, gcTime: 0,
    queryFn: ({ signal }) => api<{ documents: SdsMetadata[]; next: string | null }>(
      "/sds?" + new URLSearchParams({ q, ...(after ? { after } : {}) }), undefined, signal),
  });
  const detail = useQuery({
    queryKey: ["workspace", context, "document", id], enabled: Boolean(id), retry: false, gcTime: 0,
    queryFn: ({ signal }) => api<SdsMetadata & { candidates: SdsCandidate[]; reviewReason: string | null }>("/sds/" + id, undefined, signal),
  });
  const original = useMutation({ mutationFn: () => api<Blob>("/sds/" + id + "/file"),
    onSuccess: (pdf) => download(pdf, "aetheris-sds.pdf"), gcTime: 0 });
  async function scan(next: File) {
    setFile(next); setScanned(false); setCandidates([]); setScanning(true); setAlert("");
    try {
      const { scanPdf } = await import("./pdfScanner");
      const reply = await scanPdf(next);
      setCandidates(reply.candidates);
      setScanned(true);
      if (reply.pages > 40) setAlert(t("Extraction covers the first 40 pages. Check the original PDF for additional sections.", "يغطي الاستخراج أول ٤٠ صفحة. راجع الملف الأصلي للأقسام الإضافية."));
      if (!reply.candidates.length) setAlert(reply.hasText ? t("Section headings were not recognized. Enter a manual excerpt with its page or retain only the original.",
        "تعذر التعرف على عناوين الأقسام. أضف مقتطفاً يدوياً مع صفحته أو احتفظ بالأصل فقط.") :
        t("This scan has no usable text layer. Enter excerpts manually with page numbers.", "لا تحتوي النسخة الممسوحة على طبقة نص قابلة للقراءة. أدخل المقتطفات يدوياً مع أرقام الصفحات."));
    } catch {
      setAlert(t("The PDF could not be read. Select an unlocked PDF up to 5 MB.", "تعذرت قراءة الملف. اختر ملف PDF غير مقفل بحجم يصل إلى ٥ ميغابايت."));
    } finally { setScanning(false); }
  }
  return <section className="panel impact-panel">
    <h2>{t("Safety data sheets", "صحائف بيانات السلامة")}</h2>
    {editable && <details className="impact-details">
      <summary>{t("Inspect and upload a PDF", "فحص ورفع ملف PDF")}</summary>
      <label className="impact-input-group">{t("Choose a safety data sheet (PDF, maximum 5 MB)", "اختر صحيفة بيانات السلامة (PDF، حتى ٥ ميغابايت)")}
        <input type="file" accept="application/pdf" disabled={scanning} onChange={(e) => { const picked = e.target.files?.[0]; if (picked) void scan(picked); }} />
      </label>
      {scanning && <p role="status">{t("Reading PDF text locally…", "جارٍ قراءة نص PDF محلياً…")}</p>}
      {alert && <p role="status">{alert}</p>}
      {file && scanned && <WriteForm api={api} endpoint="/sds" onSaved={(value) => {
        setId(String(value.id ?? "")); setFile(undefined); setScanned(false); setCandidates([]); setAlert("");
      }} build={(form) => {
        const pdf = new FormData();
        pdf.set("pdf", file, "safety-data-sheet.pdf");
        const accepted = candidates.flatMap((c, i) => {
          const text = optional(form, "candidate" + i);
          return text ? [{ ...c, text }] : [];
        });
        const manual = optional(form, "manual");
        const page = numeric(form, "manualPage");
        if (manual && page) accepted.push({ section: "identification", text: manual, page });
        if (Boolean(manual) !== Boolean(page)) throw new Error("Incomplete manual excerpt");
        pdf.set("metadata", JSON.stringify({ title: field(form, "title"), labId: optional(form, "labId"),
          chemicalId: optional(form, "chemicalId"), revisionDate: optional(form, "revisionDate"),
          confirmed: form.has("confirm"), candidates: accepted }));
        return pdf;
      }}>
        <div className="impact-grid compact">
          <LabInput name="title" en="Product or SDS title" ar="عنوان المنتج أو الصحيفة" required />
          <LabChoice directory={directory} />
          <LabInput name="chemicalId" en="Chemical reference ID, if confirmed" ar="معرّف المرجع الكيميائي إن تأكد" />
          <LabInput name="revisionDate" en="Document revision date" ar="تاريخ مراجعة المستند" type="date" />
        </div>
        {candidates.map((candidate, i) => <LabInput key={i} name={"candidate" + i} multiline value={candidate.text}
          en={labLabel("en", candidate.section) + " · page " + candidate.page} ar={labLabel("ar", candidate.section) + " · صفحة " + candidate.page} />)}
        <div className="impact-grid compact">
          <LabInput name="manual" en="Manual identification excerpt" ar="مقتطف التعريف اليدوي" multiline />
          <LabInput name="manualPage" en="Page of manual excerpt" ar="صفحة المقتطف اليدوي" type="number" />
        </div>
        <p className="muted">{t("Check each excerpt against the original page. Clear uncertain text. A qualified reviewer verifies it after upload.",
          "راجع المقتطفات مع الصفحات الأصلية. امسح النص غير المؤكد. يتحقق مراجع مؤهل منه بعد الرفع.")}</p>
        <label><input type="checkbox" name="confirm" required /> {t("I confirmed the excerpts and page numbers against the original.", "أكّدت المقتطفات وأرقام الصفحات بالرجوع إلى الأصل.")}</label>
      </WriteForm>}
    </details>}
    <form className="impact-grid compact" onSubmit={(event) => { event.preventDefault(); setQ(field(new FormData(event.currentTarget), "q")); setAfter(""); }}>
      <LabInput name="q" en="Search SDS titles" ar="البحث في عناوين الصحائف" />
      <Submit>{t("Search", "بحث")}</Submit>
    </form>
    {list.data?.documents.length === 0 && <p>{t("No documents match.", "لا توجد مستندات مطابقة.")}</p>}
    <div className="button-row">{list.data?.documents.map((d) => <Button key={d.id} variant={id === d.id ? "contained" : "outlined"}
      onClick={() => setId(d.id)}><bdi>{d.title}</bdi></Button>)}</div>
    {after && <Button onClick={() => setAfter("")}>{t("First page", "الصفحة الأولى")}</Button>}
    {list.data?.next && <Button onClick={() => setAfter(list.data?.next ?? "")}>{t("More documents", "مزيد من المستندات")}</Button>}
    {detail.data && <section className="impact-form" key={id}>
      <h3 dir="auto">{detail.data.title}</h3>
      <div className="button-row"><Chip label={labLabel(lang, detail.data.status)} />
        <Button variant="outlined" onClick={() => original.mutate()} disabled={original.isPending}>{t("Download original PDF", "تنزيل PDF الأصلي")}</Button>
      </div>
      {detail.data.revisionDate && <p>{t("Revision date", "تاريخ المراجعة")} · <bdi>{detail.data.revisionDate}</bdi></p>}
      {detail.data.reviewReason && <p dir="auto">{detail.data.reviewReason}</p>}
      {detail.data.candidates.map((candidate, i) => <details key={i} className="impact-details">
        <summary>{labLabel(lang, candidate.section)} · {t("Page", "صفحة")} {candidate.page}</summary><p dir="auto">{candidate.text}</p>
      </details>)}
      {reviewer && detail.data.status === "submitted" && <WriteForm api={api} endpoint={"/sds/" + id + "/review"}
        build={(form) => ({ verified: field(form, "decision") === "verify", reason: field(form, "reason") })}>
        <LabSelect name="decision" en="Document review" ar="مراجعة المستند" required value="verify" options={[["verify", t("Verify", "تحقق")], ["reject", t("Reject", "ارفض")]]} />
        <LabInput name="reason" en="Review reason" ar="سبب المراجعة" required />
      </WriteForm>}
    </section>}
    <FormError error={list.error || detail.error || original.error} />
  </section>;
}
