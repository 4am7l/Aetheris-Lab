import { lazy, Suspense, useState, type FormEvent } from "react";
import { Button } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import PageHeading from "../components/PageHeading";
import { trackingTokenSchema } from "../domain";
import { getTrackingToken } from "../services/receipts";
import { useReceipts } from "../services/useReceipts";
import { useLanguage } from "../text";
import type { OrganizationDirectory, WorkspaceIdentity } from "./contracts";
import { Dashboard } from "./Dashboard";
import { FormError, LabInput, LabSelect, Submit } from "./Inputs";
import { field, optional } from "./formData";
import { Documents, Inventory } from "./Laboratory";
import { Organizations, ReferenceManager, WriteForm } from "./Management";
import { getCredential, labApi, rememberCredential, words, type LabApi } from "./client";
import { labLabel } from "./labels";
import "./impact.css";

const Explorer = lazy(() => import("./Explorer").then((m) => ({ default: m.Explorer })));
const Calculators = lazy(() => import("./Tools").then((m) => ({ default: m.Calculators })));
const emptyDirectory: OrganizationDirectory = { institutions: [], departments: [], labs: [] };

function Emergency({ api, context, directory, manage, institution }: {
  api: LabApi; context: string; directory: OrganizationDirectory; manage: boolean; institution?: string;
}) {
  const lang = useLanguage();
  const t = (en: string, ar: string) => words(lang, en, ar);
  const query = useQuery({ queryKey: ["workspace", context, "emergency"], gcTime: 0, retry: false,
    queryFn: ({ signal }) => api<{ contacts: { id: string; labId: string | null; institutionId: string; nameEn: string; nameAr: string;
      contact: string; procedure: string; sds: string | null; approvedAt: string }[] }>("/emergency", undefined, signal) });
  const [editing, setEditing] = useState("");
  const current = query.data?.contacts.find((item) => item.id === editing);
  const name = (item: { nameEn: string; nameAr: string }) => lang === "ar" ? item.nameAr : item.nameEn;
  return <section className="panel impact-panel">
    <h2>{t("Emergency information", "معلومات الطوارئ")}</h2>
    <p>{t("In an emergency, contact local emergency services and your laboratory safety personnel. Follow the approved site procedure and use the SDS for the specific product.",
      "في حالة الطوارئ، اتصل بخدمات الطوارئ المحلية ومسؤولي السلامة في المختبر. اتبع الإجراء المعتمد للموقع وراجع صحيفة السلامة الخاصة بالمنتج.")}</p>
    {query.data?.contacts.length === 0 && <p>{t("No institution-approved emergency contacts are available for this workspace.", "لا تتوفر جهات اتصال طوارئ معتمدة لهذه المساحة.")}</p>}
    {query.data?.contacts.map((item) => <article key={item.id} className="impact-input-group">
      <h3 dir="auto">{name(item)}</h3><bdi>{item.contact}</bdi>
      <a href={item.procedure} target="_blank" rel="noreferrer">{t("Approved procedure", "الإجراء المعتمد")}</a>
      {item.sds && <a href={item.sds} target="_blank" rel="noreferrer">{t("SDS reference", "مرجع صحيفة السلامة")}</a>}
      <small>{t("Approved", "معتمد")} · <bdi>{item.approvedAt.slice(0, 10)}</bdi></small>
      {manage && <Button onClick={() => setEditing(item.id)}>{t("Edit contact", "تعديل جهة الاتصال")}</Button>}
    </article>)}
    <p><a href="https://www.cdc.gov/chemical-emergencies/response/index.html" target="_blank" rel="noreferrer">{t("CDC chemical emergency guidance (U.S.)", "إرشادات CDC للطوارئ الكيميائية (الولايات المتحدة)")}</a></p>
    {manage && <details className="impact-details" open={current ? true : undefined}>
      <summary>{t("Manage approved contact and procedure", "إدارة جهة الاتصال والإجراء المعتمد")}</summary>
      {editing && <Button onClick={() => setEditing("")}>{t("Add a new contact", "إضافة جهة اتصال جديدة")}</Button>}
      <WriteForm key={editing} api={api} endpoint="/emergency" build={(form) => ({
        id: current?.id, institutionId: current?.institutionId ?? optional(form, "institutionId") ?? institution,
        labId: current ? current.labId ?? undefined : optional(form, "labId"),
        nameEn: field(form, "nameEn"), nameAr: field(form, "nameAr"), contact: field(form, "contact"),
        procedure: field(form, "procedure"), sds: optional(form, "sds"),
      })}>
        <div className="impact-grid compact">
          {!institution && !current && <LabSelect name="institutionId" en="University" ar="الجامعة" required options={directory.institutions.map((x) => [x.id, name(x)])} />}
          {!current && <LabSelect name="labId" en="Optional laboratory" ar="المختبر اختياري" options={directory.labs.map((x) => [x.id, name(x)])} />}
          <LabInput name="nameEn" en="English contact name" ar="اسم جهة الاتصال بالإنجليزية" value={current?.nameEn} required />
          <LabInput name="nameAr" en="Arabic contact name" ar="اسم جهة الاتصال بالعربية" value={current?.nameAr} required />
          <LabInput name="contact" en="Approved contact details" ar="بيانات الاتصال المعتمدة" value={current?.contact} required />
          <LabInput name="procedure" en="Approved procedure URL" ar="رابط الإجراء المعتمد" value={current?.procedure} type="url" required />
          <LabInput name="sds" en="Official SDS URL, if applicable" ar="رابط صحيفة السلامة الرسمية عند الانطباق" value={current?.sds} type="url" />
        </div>
      </WriteForm>
    </details>}
    <FormError error={query.error} />
  </section>;
}

function Audit({ api, context }: { api: LabApi; context: string }) {
  const lang = useLanguage();
  const t = (en: string, ar: string) => words(lang, en, ar);
  const query = useQuery({ queryKey: ["workspace", context, "audit"], retry: false, gcTime: 0,
    queryFn: ({ signal }) => api<{ events: { id: string; actor: string; action: string; resourceId: string; createdAt: string }[] }>("/audit", undefined, signal) });
  return <section className="panel impact-panel">
    <h2>{t("Audit history", "سجل التدقيق")}</h2>
    <FormError error={query.error} />
    {query.data?.events.length ? <div className="impact-table"><table>
      <thead><tr>{[t("Date", "التاريخ"), t("Event", "الحدث"), t("Actor ID", "معرّف المسؤول"), t("Record ID", "معرّف السجل")].map((item) => <th key={item}>{item}</th>)}</tr></thead>
      <tbody>{query.data.events.map((event) => <tr key={event.id}>
        <td><bdi>{new Date(event.createdAt).toLocaleString(lang)}</bdi></td><td><bdi>{event.action}</bdi></td>
        <td><bdi>{event.actor}</bdi></td><td><bdi>{event.resourceId}</bdi></td>
      </tr>)}</tbody>
    </table></div> : <p>{t("No audit entries are available.", "لا توجد قيود تدقيق متاحة.")}</p>}
  </section>;
}

function Affiliation({ api, identity, directory }: { api: LabApi; identity: WorkspaceIdentity; directory: OrganizationDirectory }) {
  const lang = useLanguage();
  const t = (en: string, ar: string) => words(lang, en, ar);
  const { receipts } = useReceipts();
  const client = useQueryClient();
  const [notice, setNotice] = useState("");
  if (!identity.labId && identity.role !== "institution-admin") return null;
  return <details className="impact-details">
    <summary>{t("Link an assessment to this laboratory", "ربط تقييم بهذا المختبر")}</summary>
    <p>{t("Use a receipt saved in this browser to record its laboratory affiliation.", "استخدم إيصالاً محفوظاً في هذا المتصفح لتوثيق ارتباطه بالمختبر.")}</p>
    <WriteForm api={api} endpoint="/affiliate" build={(form) => {
      const id = field(form, "receipt");
      return { id, receipt: getTrackingToken(id), labId: optional(form, "labId") };
    }} onSaved={() => { setNotice(t("Assessment linked.", "تم ربط التقييم.")); void client.invalidateQueries({ queryKey: ["impact-overview"] }); }}>
      <LabSelect name="receipt" en="Saved receipt" ar="الإيصال المحفوظ" required
        options={receipts.map((item) => [item.id, item.createdAt.slice(0, 10) + " · " + item.id.slice(0, 8)])} />
      {!identity.labId && <LabSelect name="labId" en="Laboratory" ar="المختبر" required
        options={directory.labs.map((item) => [item.id, lang === "ar" ? item.nameAr : item.nameEn])} />}
    </WriteForm>
    {notice && <p role="status">{notice}</p>}
  </details>;
}

export function WorkspaceContent({ api, identity, isPlatform = false, assetBase }: {
  api: LabApi; identity?: WorkspaceIdentity; isPlatform?: boolean; assetBase?: string;
}) {
  const lang = useLanguage();
  const t = (en: string, ar: string) => words(lang, en, ar);
  const key = isPlatform ? "platform" : identity?.actor ?? "none";
  const manage = isPlatform || identity?.role === "institution-admin";
  const editable = manage || identity?.role === "lab-manager";
  const reviewer = isPlatform || identity?.role === "reviewer";
  const [selected, setSelected] = useState(isPlatform ? "overview" : "inventory");
  const directory = useQuery({ queryKey: ["workspace", key, "directory"], retry: false, gcTime: 0,
    queryFn: ({ signal }) => api<OrganizationDirectory>("/directory", undefined, signal) });
  const org = directory.data ?? emptyDirectory;
  const sections = [
    ["overview", "Impact and assessments", "الأثر والتقييمات", isPlatform],
    ["inventory", "Inventory", "المخزون", true], ["explorer", "Chemical explorer", "مستكشف المواد الكيميائية", true],
    ["sds", "SDS", "صحائف السلامة", true], ["storage", "Storage compatibility", "توافق التخزين", true],
    ["tools", "Calculators", "الحاسبات", !isPlatform],
    ["refs", "Prices and carbon factors", "الأسعار ومعاملات الكربون", manage],
    ["org", "Institutional structure", "الهيكل المؤسسي", manage],
    ["emergency", "Emergency information", "معلومات الطوارئ", true], ["audit", "Audit history", "سجل التدقيق", manage],
  ] as const;
  const lab = org.labs.find((item) => item.id === identity?.labId);
  const institution = org.institutions.find((item) => item.id === identity?.institutionId);
  const identityLabel = [institution, lab].flatMap((item) => item ? [lang === "ar" ? item.nameAr : item.nameEn] : []).join(" · ");
  return <>
    <div className="impact-pill-nav panel" role="group" aria-label={t("Laboratory workspace sections", "أقسام مساحة العمل المخبرية")}>
      {sections.filter((item) => item[3]).map(([section, en, ar]) => <Button key={section} size="small" variant={selected === section ? "contained" : "outlined"}
        aria-pressed={selected === section} onClick={() => setSelected(section)}>{t(en, ar)}</Button>)}
    </div>
    {identity && <p><bdi>{identityLabel}</bdi> · {labLabel(lang, identity.role)}</p>}
    <FormError error={directory.error} />
    {identity && selected === "inventory" && <Affiliation api={api} identity={identity} directory={org} />}
    <Suspense fallback={<p role="status">{t("Loading workspace…", "جارٍ تحميل مساحة العمل…")}</p>}>
      {isPlatform && selected === "overview" && <Dashboard api={api} directory={org} />}
      {selected === "inventory" && <Inventory api={api} directory={org} context={key} editable={editable} />}
      {(selected === "explorer" || selected === "storage") && <Explorer key={selected} api={api} scope={key} directory={org} reviewer={reviewer} storageOnly={selected === "storage"} assetBase={assetBase} />}
      {selected === "sds" && <Documents api={api} directory={org} context={key} reviewer={reviewer} editable={editable} />}
      {selected === "tools" && !isPlatform && <Calculators />}
      {selected === "refs" && manage && <ReferenceManager api={api} directory={org} context={key} platform={isPlatform} />}
      {selected === "org" && manage && <Organizations api={api} directory={org} context={key} platform={isPlatform} memberInstitution={identity?.institutionId} />}
      {selected === "emergency" && <Emergency api={api} directory={org} context={key} manage={manage} institution={identity?.institutionId} />}
      {selected === "audit" && manage && <Audit api={api} context={key} />}
    </Suspense>
  </>;
}

export default function LaboratoryWorkspace() {
  const lang = useLanguage();
  const t = (en: string, ar: string) => words(lang, en, ar);
  const [credential, setCredential] = useState(() => getCredential("membership"));
  const [view, setView] = useState(0);
  const [notice, setNotice] = useState("");
  const api = labApi("/api/impact/workspace", { token: credential });
  const session = useQuery({ queryKey: ["workspace-identity", view], enabled: Boolean(credential), retry: false, gcTime: 0,
    refetchInterval: 60_000, queryFn: ({ signal }) => api<WorkspaceIdentity>("/identity", undefined, signal) });
  const redeem = useMutation({
    mutationFn: (invitation: string) => labApi("/api/impact/workspace")<{ token: string }>("/redeem", { invitation }),
    onSuccess: (result) => apply(result.token),
    gcTime: 0,
  });
  function apply(token: string) {
    const durable = rememberCredential("membership", token);
    setCredential(token);
    setView((x) => x + 1);
    setNotice(!durable && token ? t("Save the workspace credential to reopen it after leaving this browser tab.", "احفظ رمز مساحة العمل لإعادة فتحها بعد مغادرة علامة التبويب.") : "");
  }
  function open(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = new FormData(event.currentTarget);
    const parsed = trackingTokenSchema.safeParse(field(input, "token"));
    if (!parsed.success) { setNotice(t("Enter a valid credential or invitation.", "أدخل رمز وصول أو دعوة صالحة.")); return; }
    if (field(input, "mode") === "redeem") redeem.mutate(parsed.data);
    else apply(parsed.data);
    event.currentTarget.reset();
  }
  return <div className="page">
    <PageHeading title={t("Laboratory workspace", "مساحة العمل المخبرية")} />
    <section className="panel impact-panel">
      {!credential ? <>
        <p>{t("Use an administrator-issued invitation or an existing workspace credential. Public assessments are available independently.",
          "استخدم دعوة صادرة عن المسؤول أو رمز مساحة عمل موجوداً. التقييمات العامة متاحة بشكل مستقل.")}</p>
        <form className="impact-form" onSubmit={open}>
          <div className="impact-grid compact">
            <LabSelect name="mode" en="Access method" ar="طريقة الوصول" required value="redeem"
              options={[["redeem", t("Redeem invitation", "استخدام دعوة")], ["restore", t("Use existing credential", "استخدام رمز وصول موجود")]]} />
            <LabInput name="token" en="Invitation or access credential" ar="الدعوة أو رمز الوصول" required type="password" />
          </div>
          <Submit busy={redeem.isPending}>{t("Open laboratory workspace", "فتح مساحة العمل المخبرية")}</Submit>
        </form>
      </> : <>
        <details className="impact-details"><summary>{t("Workspace access credential", "رمز الوصول لمساحة العمل")}</summary>
          <p>{t("Keep this access credential private.", "احفظ رمز الوصول بشكل خاص.")}</p><output className="impact-wrap"><bdi>{credential}</bdi></output>
        </details>
        <div className="button-row">
          <Link to="/analysis">{t("Start a public assessment", "بدء تقييم عام")}</Link>
          <Button onClick={() => apply("")}>{t("Disconnect on this browser", "قطع الاتصال على هذا المتصفح")}</Button>
        </div>
      </>}
      {notice && <p role="status">{notice}</p>}
      {credential && session.isPending && <p role="status">{t("Checking access…", "جارٍ التحقق من الوصول…")}</p>}
      <FormError error={session.error || redeem.error} />
    </section>
    {session.isSuccess && <WorkspaceContent key={view} api={api} identity={session.data} />}
  </div>;
}
