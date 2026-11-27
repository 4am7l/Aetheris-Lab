import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLanguage } from "../text";
import type { CatalogChemical, OrganizationDirectory } from "./contracts";
import { carbonStages, quantityUnits } from "./model";
import { FormError, LabInput, LabSelect, Submit } from "./Inputs";
import { field, numeric, optional } from "./formData";
import { labLabel, numberLabel } from "./labels";
import { words, type LabApi } from "./client";

export interface Prices {
  id: string; kind: string; value: number; currency: string; packageQuantity: number; unit: string;
  status: string; supplier: string | null; invoice: string | null; date: string | null; source: string | null;
}
export interface Factor {
  id: string; value: number; unit: string; stage: string | null; geography: string | null; boundary: string | null;
  url: string | null; methodology: string | null; uncertainty: string | null; publicationDate: string | null; status: string; source: string;
}
export interface ChemicalDetailData {
  chemical: CatalogChemical; prices: Prices[]; factors: Factor[];
  densities: { id: string; kgPerLiter: number; conditions: string; url: string }[];
}

type Build = (form: FormData) => unknown;
export function WriteForm({ api, endpoint, build, onSaved, children }: {
  api: LabApi; endpoint: string; build: Build; onSaved?: (value: Record<string, unknown>) => void; children?: ReactNode;
}) {
  const lang = useLanguage();
  const client = useQueryClient();
  const write = useMutation({
    mutationFn: (form: FormData) => api<Record<string, unknown>>(endpoint, build(form)),
    onSuccess: (result) => {
      void client.invalidateQueries({ queryKey: ["workspace"] });
      onSaved?.(result);
    },
    gcTime: 0,
  });
  return <form className="impact-form" onSubmit={(event) => { event.preventDefault(); write.mutate(new FormData(event.currentTarget)); }}>
    {children}
    <Submit busy={write.isPending} />
    {write.isSuccess && !onSaved && <p role="status">{words(lang, "Saved.", "تم الحفظ.")}</p>}
    <FormError error={write.error} />
  </form>;
}

function check(form: FormData, key: string) { return form.has(key); }

function organizationOptions(directory: OrganizationDirectory, lang: "en" | "ar", kind: keyof OrganizationDirectory) {
  return directory[kind].map((item) => [item.id, lang === "ar" ? item.nameAr : item.nameEn] as const);
}
export function LabChoice({ directory, value }: { directory: OrganizationDirectory; value?: string }) {
  const lang = useLanguage();
  return <LabSelect name="labId" en="Laboratory" ar="المختبر" options={organizationOptions(directory, lang, "labs")} value={value} />;
}

export function Organizations({ api, directory, context, platform, memberInstitution }: {
  api: LabApi; directory: OrganizationDirectory; context: string; platform: boolean; memberInstitution?: string | null;
}) {
  const lang = useLanguage();
  const t = (en: string, ar: string) => words(lang, en, ar);
  const [kind, setKind] = useState(platform ? "institution" : "department");
  const [record, setRecord] = useState("");
  const [invitation, setInvitation] = useState("");
  const members = useQuery({
    queryKey: ["workspace", context, "members"], queryFn: ({ signal }) =>
      api<{ memberships: { id: string; institutionId: string; labId: string | null; role: string; expiresAt: string; acceptedAt: string | null; revokedAt: string | null }[] }>("/memberships", undefined, signal),
    retry: false, gcTime: 0,
  });
  const chosen = [...directory.institutions, ...directory.departments, ...directory.labs].find((item) => item.id === record);
  const options = kind === "institution" ? "institutions" : kind === "department" ? "departments" : "labs";

  function org(form: FormData) {
    return {
      kind, id: chosen?.id, nameEn: field(form, "nameEn"), nameAr: field(form, "nameAr"),
      ...(kind === "institution" ? { geography: field(form, "geography") } : {
        institutionId: optional(form, "institutionId") ?? memberInstitution,
        ...(kind === "lab" ? { departmentId: field(form, "departmentId") } : {}),
      }),
    };
  }
  return <section className="panel impact-panel">
    <h2>{t("Universities, departments and laboratories", "الجامعات والأقسام والمختبرات")}</h2>
    <div className="button-row">
      {(platform ? ["institution", "department", "lab"] : ["department", "lab"]).map((x) => <Button key={x}
        variant={x === kind ? "contained" : "outlined"} onClick={() => { setKind(x); setRecord(""); }}>
        {x === "institution" ? t("Universities", "الجامعات") : x === "department" ? t("Departments", "الأقسام") : t("Laboratories", "المختبرات")}
      </Button>)}
    </div>
    <label htmlFor="structure-choice">{t("Choose a record to edit", "اختر سجلاً للتعديل")}</label>
    <select id="structure-choice" value={record} onChange={(event) => setRecord(event.target.value)}>
      <option value="">{t("Create a record", "إنشاء سجل")}</option>
      {organizationOptions(directory, lang, options).map(([id, name]) => <option value={id} key={id}>{name}</option>)}
    </select>
    <WriteForm key={kind + record} api={api} endpoint="/directory" build={org}>
      <div className="impact-grid compact">
        <LabInput name="nameEn" en="English name" ar="الاسم الإنجليزي" value={chosen?.nameEn} required />
        <LabInput name="nameAr" en="Arabic name" ar="الاسم العربي" value={chosen?.nameAr} required />
        {kind === "institution" && <LabInput name="geography" en="Emissions geography (e.g. JO)" ar="النطاق الجغرافي للانبعاثات (مثل JO)" value={chosen && "geography" in chosen ? chosen.geography : ""} required />}
        {kind !== "institution" && platform && <LabSelect name="institutionId" en="University" ar="الجامعة" required
          options={organizationOptions(directory, lang, "institutions")} value={chosen && "institutionId" in chosen ? chosen.institutionId : ""} />}
        {kind === "lab" && <LabSelect name="departmentId" en="Department" ar="القسم" required options={organizationOptions(directory, lang, "departments")}
          value={chosen && "departmentId" in chosen && typeof chosen.departmentId === "string" ? chosen.departmentId : ""} />}
      </div>
    </WriteForm>
    <details className="impact-details">
      <summary>{t("Issue a scoped invitation", "إصدار دعوة محددة النطاق")}</summary>
      <WriteForm api={api} endpoint="/memberships" build={(form) => ({
        institutionId: optional(form, "institutionId") ?? memberInstitution, labId: optional(form, "labId"), role: field(form, "role"),
      })} onSaved={(value) => setInvitation(String(value.invitation ?? ""))}>
        <div className="impact-grid compact">
          {platform && <LabSelect name="institutionId" en="University" ar="الجامعة" required options={organizationOptions(directory, lang, "institutions")} />}
          <LabChoice directory={directory} />
          <LabSelect name="role" en="Workspace role" ar="الدور في مساحة العمل" required value="viewer"
            options={(platform ? ["viewer", "lab-manager", "reviewer", "institution-admin"] : ["viewer", "lab-manager", "reviewer"]).map((x) => [x, labLabel(lang, x)])} />
        </div>
        <p className="muted">{t("Issue reviewer credentials to qualified staff and share invitations privately. Invitations can be redeemed once within seven days.",
          "أصدر رموز المراجعة للموظفين المؤهلين وشارك الدعوات بشكل خاص. يمكن استخدام الدعوة مرة واحدة خلال سبعة أيام.")}</p>
      </WriteForm>
      {invitation && <output className="impact-wrap" role="status"><bdi>{invitation}</bdi></output>}
    </details>
    <details className="impact-details">
      <summary>{t("Memberships and revocations", "العضويات وإلغاؤها")}</summary>
      {members.data?.memberships.map((m) => <div key={m.id} className="impact-input-group">
        <bdi>{m.id}</bdi><span>{labLabel(lang, m.role)} · {m.revokedAt ? t("Revoked", "ملغى") : m.acceptedAt ? t("Active", "نشط") : t("Invited", "مدعو")}</span>
        <span><bdi>{m.expiresAt.slice(0, 10)}</bdi></span>
        {!m.revokedAt && <details><summary>{t("Revoke access", "إلغاء الوصول")}</summary>
          <WriteForm api={api} endpoint="/memberships/revoke" build={() => ({ id: m.id })} />
        </details>}
      </div>)}
      {members.data?.memberships.length === 0 && <p>{t("No invitations have been issued.", "لم تصدر أي دعوات.")}</p>}
      <FormError error={members.error} />
    </details>
  </section>;
}

const detailsFields = [
  ["cas", "CAS number", "رقم CAS"], ["formula", "Molecular formula", "الصيغة الجزيئية"],
  ["concentration", "Concentration and unit", "التركيز والوحدة"], ["purity", "Purity and basis", "النقاوة وأساسها"],
  ["solvent", "Solvent", "المذيب"], ["formulation", "Exact formulation or grade", "التركيبة أو الدرجة المحددة"],
  ["physicalState", "Physical state", "الحالة الفيزيائية"], ["category", "Classification", "التصنيف"],
  ["wasteCategory", "Reference waste category", "فئة النفايات المرجعية"], ["hazardEvidence", "Hazard evidence summary", "ملخص أدلة الأخطار"],
] as const;

export function RateDetails({ item }: { item: ChemicalDetailData }) {
  const lang = useLanguage();
  const t = (en: string, ar: string) => words(lang, en, ar);
  return <>
    <p><strong>{t("Material record ID", "معرّف سجل المادة")}</strong> <bdi className="impact-wrap">{item.chemical.id}</bdi></p>
    <details className="impact-details">
      <summary>{t("Price versions", "نسخ الأسعار")}</summary>
      {item.prices.length ? <ul>{item.prices.map((p) => <li key={p.id} className="impact-wrap">
        {labLabel(lang, p.kind)} · <bdi>{numberLabel(lang, p.value, p.currency)} / {p.packageQuantity} {p.unit}</bdi> · {labLabel(lang, p.status)}
        {p.supplier && <> · <bdi>{p.supplier}</bdi></>}{p.date && <> · <bdi>{p.date}</bdi></>}
        {p.invoice && <> · <bdi>{p.invoice}</bdi></>}<div><bdi>{p.id}</bdi></div>
      </li>)}</ul> : <p>{t("No price evidence is recorded.", "لا توجد أدلة أسعار مسجلة.")}</p>}
    </details>
    <details className="impact-details">
      <summary>{t("Carbon factor versions", "نسخ معاملات الكربون")}</summary>
      {item.factors.length ? <ul>{item.factors.map((p) => <li key={p.id} className="impact-wrap">
        <bdi>{numberLabel(lang, p.value)} kg CO₂e/{p.unit}</bdi> · {labLabel(lang, p.status)}
        {p.stage && <> · {labLabel(lang, p.stage)}</>}{p.geography && <> · <bdi>{p.geography}</bdi></>}
        <div><bdi>{p.id}</bdi></div>
        {p.boundary && <div>{t("Boundary", "النطاق")} · <bdi>{p.boundary}</bdi></div>}
        {p.methodology && <div dir="auto">{p.methodology}</div>}
        {p.uncertainty && <div>{t("Uncertainty", "عدم اليقين")} · <bdi>{p.uncertainty}</bdi></div>}
        {p.url && <div><a href={p.url} target="_blank" rel="noreferrer">{t("Source", "المصدر")}</a> · <bdi>{p.publicationDate}</bdi></div>}
      </li>)}</ul> : <p>{t("No emission factors are recorded.", "لا توجد معاملات انبعاثات مسجلة.")}</p>}
    </details>
    {item.densities.length > 0 && <details className="impact-details">
      <summary>{t("Verified density versions", "نسخ الكثافة الموثّقة")}</summary>
      <ul>{item.densities.map((d) => <li className="impact-wrap" key={d.id}><bdi>{d.kgPerLiter} kg/L · {d.id}</bdi>
        <div dir="auto">{d.conditions} · <a href={d.url} target="_blank" rel="noreferrer">{t("Source", "المصدر")}</a></div></li>)}</ul>
    </details>}
  </>;
}

function RateEntry({ api, id, directory, platform, mode }: {
  api: LabApi; id: string; directory: OrganizationDirectory; platform: boolean; mode: "price" | "carbon" | "density";
}) {
  const lang = useLanguage();
  const t = (en: string, ar: string) => words(lang, en, ar);
  const fields = mode === "price" ? [
    ["supplier", "Supplier", "المورد"], ["invoice", "Invoice or tariff reference", "مرجع الفاتورة أو التعرفة"],
  ] : mode === "carbon" ? [
    ["geography", "Geography (or global)", "النطاق الجغرافي (أو global)"],
    ["boundary", "Stage-exclusive system boundary", "حدود النظام لهذه المرحلة فقط"],
    ["methodology", "Methodology", "المنهجية"], ["uncertainty", "Uncertainty", "عدم اليقين"],
  ] : [["conditions", "Density measurement and applicability", "قياس الكثافة وشروط الانطباق"]];
  function build(form: FormData) {
    const base = { chemicalId: id, institutionId: optional(form, "institutionId"), supersedes: optional(form, "supersedes") };
    const extra = Object.fromEntries(fields.map(([name]) => [name, optional(form, name)]));
    if (mode === "density") return { ...base, ...extra, source: field(form, "source"), kgPerLiter: numeric(form, "value") };
    const common = { ...base, ...extra, value: numeric(form, "value"), unit: field(form, "unit"), verified: check(form, "verified") };
    return mode === "price" ? {
      ...common, kind: field(form, "kind"), currency: field(form, "currency").toUpperCase(),
      packageQuantity: numeric(form, "packageQuantity"), date: optional(form, "date"),
    } : { ...common, stage: optional(form, "stage"), publicationDate: optional(form, "publicationDate"), source: optional(form, "source") };
  }
  return <WriteForm api={api} endpoint={"/versions/" + mode} build={build}>
    <div className="impact-grid compact">
      {platform && <LabSelect name="institutionId" en="Institutional scope" ar="النطاق المؤسسي" options={organizationOptions(directory, lang, "institutions")} />}
      <LabInput name="supersedes" en="Prior version ID, for an update" ar="معرّف النسخة السابقة للتحديث" />
      <LabInput name="value" en={mode === "density" ? "Density (kg/L)" : mode === "carbon" ? "Factor (kg CO₂e per unit)" : "Price per package"}
        ar={mode === "density" ? "الكثافة (كغم/لتر)" : mode === "carbon" ? "المعامل (كغم مكافئ الكربون لكل وحدة)" : "السعر للعبوة"} type="number" required />
      {mode !== "density" && <LabSelect name="unit" en="Measurement unit" ar="وحدة القياس" value="L" required options={quantityUnits.map((u) => [u, u])} />}
      {mode === "price" && <>
        <LabSelect name="kind" en="Price type" ar="نوع السعر" value="purchase" required options={["purchase", "disposal", "combined"].map((x) => [x, labLabel(lang, x === "disposal" ? "measureDisposal" : x)])} />
        <LabInput name="currency" en="Currency" ar="العملة" value="JOD" required />
        <LabInput name="packageQuantity" en="Package quantity" ar="كمية العبوة" type="number" value={1} required />
        <LabInput name="date" en="Effective date" ar="تاريخ السريان" type="date" />
      </>}
      {mode === "carbon" && <>
        <LabSelect name="stage" en="Lifecycle stage" ar="مرحلة دورة الحياة" options={carbonStages.map((x) => [x, labLabel(lang, x)])} />
        <LabInput name="publicationDate" en="Publication date" ar="تاريخ النشر" type="date" />
      </>}
      {mode !== "price" && <LabInput name="source" en="Authoritative source URL" ar="رابط المصدر المعتمد" type="url" required={mode === "density"} />}
      {fields.map(([name, en, ar]) => <LabInput key={name} name={name} en={en} ar={ar} required={mode === "density"} />)}
    </div>
    {mode !== "density" && <label><input type="checkbox" name="verified" /> {t("I independently verified the source and applicability.", "تحققت بشكل مستقل من المصدر والانطباق.")}</label>}
  </WriteForm>;
}

export function ReferenceManager({ api, context, directory, platform }: { api: LabApi; context: string; directory: OrganizationDirectory; platform: boolean }) {
  const lang = useLanguage();
  const t = (en: string, ar: string) => words(lang, en, ar);
  const [q, setQ] = useState("");
  const [after, setAfter] = useState("");
  const [selected, setSelected] = useState("");
  const search = useQuery({ queryKey: ["workspace", context, "catalog", q, after], retry: false, gcTime: 0,
    queryFn: ({ signal }) => api<{ chemicals: CatalogChemical[]; next: string | null }>("/chemicals?" + new URLSearchParams({ q, after }), undefined, signal) });
  const detail = useQuery({ queryKey: ["workspace", context, "chemical", selected], enabled: Boolean(selected), retry: false, gcTime: 0,
    queryFn: ({ signal }) => api<ChemicalDetailData>("/chemicals/" + selected, undefined, signal) });
  function find(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setAfter(""); setQ(field(new FormData(event.currentTarget), "q")); }
  return <section className="panel impact-panel">
    <h2>{t("Chemical references and factor management", "المراجع الكيميائية وإدارة المعاملات")}</h2>
    <details className="impact-details">
      <summary>{t("Add a chemical reference", "إضافة مرجع كيميائي")}</summary>
      <WriteForm api={api} endpoint="/chemicals" onSaved={(value) => setSelected(String(value.id ?? ""))}
        build={(form) => ({ nameEn: field(form, "nameEn"), nameAr: field(form, "nameAr"), source: field(form, "source"),
          cid: numeric(form, "cid"), institutionId: optional(form, "institutionId"), labId: optional(form, "labId"),
          verified: check(form, "verified"), ...Object.fromEntries(detailsFields.map(([name]) => [name, optional(form, name)])) })}>
        <div className="impact-grid compact">
          <LabInput name="nameEn" en="English name" ar="الاسم الإنجليزي" required />
          <LabInput name="nameAr" en="Arabic name" ar="الاسم العربي" required />
          <LabInput name="cid" en="PubChem CID" ar="معرّف PubChem" type="number" />
          <LabInput name="source" en="Source URL" ar="رابط المصدر" type="url" required />
          {platform && <LabSelect name="institutionId" en="Institutional scope" ar="النطاق المؤسسي" options={organizationOptions(directory, lang, "institutions")} />}
          <LabChoice directory={directory} />
          {detailsFields.map(([name, en, ar]) => <LabInput key={name} name={name} en={en} ar={ar} />)}
        </div>
        <label><input type="checkbox" name="verified" /> {t("Verify this documented formulation", "توثيق هذه التركيبة المحددة")}</label>
      </WriteForm>
    </details>
    <form className="impact-grid compact" onSubmit={find}>
      <LabInput name="q" en="Name, CAS, formula or CID" ar="الاسم أو CAS أو الصيغة أو المعرّف" />
      <Submit>{t("Search references", "البحث في المراجع")}</Submit>
    </form>
    <div className="impact-pill-nav">{search.data?.chemicals.map((c) => <Button size="small" key={c.id}
      aria-pressed={selected === c.id} variant={selected === c.id ? "contained" : "outlined"} onClick={() => setSelected(c.id)}>
      {lang === "ar" ? c.nameAr : c.nameEn}
    </Button>)}</div>
    {after && <Button onClick={() => setAfter("")}>{t("First page", "الصفحة الأولى")}</Button>}
    {search.data?.next && <Button onClick={() => setAfter(search.data?.next ?? "")}>{t("More references", "مزيد من المراجع")}</Button>}
    {search.data?.chemicals.length === 0 && <p>{t("No matching reference records.", "لا توجد مراجع مطابقة.")}</p>}
    {detail.data && <section className="impact-form" key={selected}>
      <h3>{lang === "ar" ? detail.data.chemical.nameAr : detail.data.chemical.nameEn} · {labLabel(lang, detail.data.chemical.status)}</h3>
      <RateDetails item={detail.data} />
      {([["price", "Add a purchase, disposal or combined price version", "إضافة نسخة سعر شراء أو تخلص أو سعر مجمّع"],
        ["carbon", "Add an emissions factor version", "إضافة نسخة معامل انبعاثات"],
        ["density", "Add a verified density version", "إضافة نسخة كثافة موثّقة"]] as const).map(([key, en, ar]) =>
        <details key={key} className="impact-details">
          <summary>{t(en, ar)}</summary><RateEntry api={api} id={selected} mode={key} directory={directory} platform={platform} />
        </details>)}
    </section>}
    <FormError error={search.error || detail.error} />
  </section>;
}
