import { lazy, Suspense, useState, type FormEvent } from "react";
import { Button, Chip } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import PageHeading from "../components/PageHeading";
import { useLanguage } from "../text";
import type { CompoundDetail, CompoundReference, PairEvidence } from "./science";
import type { CatalogChemical, OrganizationDirectory } from "./contracts";
import { FormError, LabInput, LabSelect, Submit } from "./Inputs";
import { field, optional } from "./formData";
import { RateDetails, WriteForm, type ChemicalDetailData } from "./Management";
import { labApi, words, type LabApi } from "./client";
import { labLabel, numberLabel } from "./labels";
import "./impact.css";

const publicApi = labApi("/api/impact");
const Molecule = lazy(() => import("./Molecule"));
type PairResult = { assessment: string; requiresQualifiedReview: boolean; conflicting: boolean; evidence: PairEvidence[] };
type CatalogPage = { chemicals: CatalogChemical[]; next: string | null };

function StaticFacts({ chemical }: { chemical: CatalogChemical }) {
  const lang = useLanguage();
  const t = (en: string, ar: string) => words(lang, en, ar);
  const absent = numberLabel(lang, null);
  const sourced = JSON.parse(chemical.provenance) as { document?: string; page?: number; row?: number; url?: string };
  const facts = [
    [t("CAS", "رقم CAS"), chemical.cas], [t("PubChem CID", "معرّف PubChem"), chemical.cid],
    [t("Molecular formula", "الصيغة الجزيئية"), chemical.formula], [t("Concentration", "التركيز"), chemical.concentration],
    [t("Purity", "النقاوة"), chemical.purity], [t("Solvent", "المذيب"), chemical.solvent],
    [t("Formulation", "التركيبة"), chemical.formulation], [t("Physical state", "الحالة الفيزيائية"), chemical.state],
    [t("Classification", "التصنيف"), chemical.category], [t("Hazard evidence summary", "ملخص أدلة الأخطار"), chemical.hazards],
    [t("Reference waste category", "فئة النفايات المرجعية"), chemical.wasteCategory],
    [t("Last record update", "آخر تحديث للسجل"), chemical.updatedAt.slice(0, 10)],
  ];
  return <>
    <Chip label={labLabel(lang, chemical.status)} />
    <dl className="impact-facts">{facts.map(([name, value]) => <div key={name}><dt>{name}</dt><dd dir="auto">{value ?? absent}</dd></div>)}</dl>
    {sourced.document && <p dir="auto">{sourced.document} · {t("Page", "صفحة")} {sourced.page} · {t("Row", "السجل")} {sourced.row}</p>}
    {sourced.url && <a href={sourced.url} rel="noreferrer" target="_blank">{t("Documented source", "المصدر الموثّق")}</a>}
    {chemical.status === "unverified" && <p className="muted">{t("Supplied formulation and waste descriptions require independent verification. Refer this material to qualified personnel for handling and waste decisions.",
      "تتطلب أوصاف التركيبة والنفايات المقدّمة تحققاً مستقلاً. تُحال قرارات المناولة والنفايات إلى المختصين المؤهلين.")}</p>}
  </>;
}

function CatalogCard({ id, api, scope, onCompound }: { id: string; api: LabApi; scope: string; onCompound: (cid: number) => void }) {
  const lang = useLanguage();
  const t = (en: string, ar: string) => words(lang, en, ar);
  const query = useQuery({ queryKey: ["workspace", scope, "chemical", id], retry: false, gcTime: 0,
    queryFn: ({ signal }) => api<ChemicalDetailData>("/chemicals/" + id, undefined, signal) });
  return <section className="impact-details">
    <FormError error={query.error} />
    {query.isPending && <p role="status">{t("Loading material record…", "جارٍ تحميل سجل المادة…")}</p>}
    {query.data && <>
      <h3 dir="auto">{lang === "ar" ? query.data.chemical.nameAr : query.data.chemical.nameEn}</h3>
      <StaticFacts chemical={query.data.chemical} />
      <RateDetails item={query.data} />
      {query.data.chemical.cid && <Button onClick={() => onCompound(query.data!.chemical.cid!)}>{t("Open PubChem substance record", "فتح سجل المادة في PubChem")}</Button>}
      {!query.data.chemical.cid && query.data.chemical.cas && <a href={"https://pubchem.ncbi.nlm.nih.gov/#query=" + encodeURIComponent(query.data.chemical.cas)}
        target="_blank" rel="noreferrer">{t("Search PubChem by CAS", "البحث في PubChem برقم CAS")}</a>}
      <p className="muted">{t("A formulation may contain several substances. Structure models describe discrete PubChem compounds.", "قد تحتوي التركيبة على عدة مواد. تمثل النماذج البنيوية مركبات PubChem الجزيئية المنفردة.")}</p>
    </>}
  </section>;
}

function Compare({ api, scope, selected }: { api: LabApi; scope: string; selected: string[] }) {
  const lang = useLanguage();
  const t = (en: string, ar: string) => words(lang, en, ar);
  const ids = selected.slice(0, 2);
  const query = useQuery({ queryKey: ["workspace", scope, "compare", ids], enabled: ids.length === 2, gcTime: 0, retry: false,
    queryFn: ({ signal }) => Promise.all(ids.map((id) => api<ChemicalDetailData>("/chemicals/" + id, undefined, signal))) });
  const fields = [
    ["cas", t("CAS", "رقم CAS")], ["formula", t("Formula", "الصيغة")], ["concentration", t("Concentration", "التركيز")],
    ["purity", t("Purity", "النقاوة")], ["solvent", t("Solvent", "المذيب")], ["formulation", t("Formulation", "التركيبة")],
    ["state", t("Physical state", "الحالة الفيزيائية")], ["category", t("Classification", "التصنيف")],
    ["hazards", t("Hazard evidence", "أدلة الأخطار")], ["wasteCategory", t("Waste evidence", "أدلة النفايات")], ["status", t("Record status", "حالة السجل")],
  ] as const;
  return <details className="impact-details">
    <summary>{t("Compare the first two selected materials", "مقارنة أول مادتين محددتين")}</summary>
    {ids.length !== 2 && <p>{t("Select at least two materials.", "اختر مادتين على الأقل.")}</p>}
    <FormError error={query.error} />
    {query.data && <>
      <div className="impact-table"><table>
        <thead><tr><th>{t("Property", "الخاصية")}</th>{query.data.map(({ chemical: c }) =>
          <th key={c.id} scope="col"><bdi>{lang === "ar" ? c.nameAr : c.nameEn}</bdi></th>)}</tr></thead>
        <tbody>{fields.map(([key, label]) => {
          const values = query.data.map(({ chemical }) => chemical[key]);
          return <tr key={key}><th scope="row">{label}{values[0] !== values[1] && <small> · {t("Different", "مختلفة")}</small>}</th>
            {values.map((value, i) => <td key={i} dir="auto">{value && key === "status" ? labLabel(lang, value) : value ?? numberLabel(lang, null)}</td>)}</tr>;
        })}</tbody>
      </table></div>
      <div className="impact-grid">{query.data.map((item) => <section key={item.chemical.id}>
        <h4 dir="auto">{lang === "ar" ? item.chemical.nameAr : item.chemical.nameEn}</h4><RateDetails item={item} />
      </section>)}</div>
      <p className="muted">{t("Mixing decisions require documented applicability and qualified review.", "تتطلب قرارات الخلط أدلة على الانطباق ومراجعة مؤهلة.")}</p>
    </>}
  </details>;
}

export function Matrix({ api, scope, selected, names, storage, reviewer, directory }: {
  api: LabApi; scope: string; selected: string[]; names: Record<string, string>; storage?: boolean; reviewer?: boolean; directory?: OrganizationDirectory;
}) {
  const lang = useLanguage();
  const t = (en: string, ar: string) => words(lang, en, ar);
  const [cell, setCell] = useState<string[]>([]);
  const [evidenceView, setEvidenceView] = useState("");
  const context = storage ? "storage" : "mixing";
  const items = [...selected].sort();
  const live = selected.length >= 2;
  const matrix = useQuery({ queryKey: ["workspace", scope, "pairs", context, items, evidenceView], enabled: live, retry: false, gcTime: 0,
    queryFn: ({ signal }) => api<{ pairs: { a: string; b: string; assessment: string }[] }>("/pairs?" + new URLSearchParams({ ids: items.join(","), context }) + evidenceView, undefined, signal) });
  const [a, b] = cell;
  const chosen = live && a !== undefined && b !== undefined && items.includes(a) && items.includes(b);
  const pair = useQuery({ queryKey: ["workspace", scope, "pair", context, a, b, evidenceView], enabled: chosen, retry: false, gcTime: 0,
    queryFn: ({ signal }) => api<PairResult>("/pairs?" + new URLSearchParams({ a, b, context }) + evidenceView, undefined, signal) });
  return <details className="impact-details">
    <summary>{storage ? t("Storage compatibility matrix", "مصفوفة توافق التخزين") : t("Chemical compatibility matrix", "مصفوفة التوافق الكيميائي")}</summary>
    <p>{t("Qualified review is required for every pair. The matrix shows available evidence for the listed materials and conditions.",
      "تلزم مراجعة مؤهلة لكل زوج. تعرض المصفوفة الأدلة المتاحة للمواد والشروط المدرجة.")}</p>
    {live && directory && <form className="impact-grid compact" onSubmit={(event) => {
      event.preventDefault();
      const choice = field(new FormData(event.currentTarget), "scope");
      setEvidenceView(choice ? "&" + choice : "");
    }}>
      <LabSelect name="scope" en="Evidence scope" ar="نطاق الأدلة" value={evidenceView.slice(1)} key={evidenceView} options={[
        ...directory.institutions.map((item) => ["institution=" + item.id, lang === "ar" ? item.nameAr : item.nameEn] as const),
        ...directory.labs.map((item) => ["lab=" + item.id, lang === "ar" ? item.nameAr : item.nameEn] as const),
      ]} />
      <Submit>{t("Load evidence", "عرض الأدلة")}</Submit>
    </form>}
    {!live && <p>{t("Select two to eight reference records to build a matrix.", "اختر من سجلين إلى ثمانية سجلات مرجعية لبناء مصفوفة.")}</p>}
    {matrix.data && <div className="impact-table"><table>
      <thead><tr><th scope="col">{t("Material", "المادة")}</th>{selected.map((id) => <th key={id} scope="col"><bdi>{names[id]}</bdi></th>)}</tr></thead>
      <tbody>{selected.map((id) => <tr key={id}><th scope="row"><bdi>{names[id]}</bdi></th>{selected.map((second) => {
        const [first, next] = [id, second].sort();
        const status = matrix.data.pairs.find((p) => p.a === first && p.b === next)?.assessment ?? "insufficient";
        return <td key={second}>{id === second ? "—" : <Button size="small" variant="outlined" color={status === "incompatible" ? "error" : "inherit"}
          aria-pressed={a === first && b === next} onClick={() => setCell([first, next])}>{labLabel(lang, status)}</Button>}</td>;
      })}</tr>)}</tbody>
    </table></div>}
    {chosen && pair.data && <section className="impact-input-group">
      <h4 dir="auto">{names[a]} · {names[b]}</h4>
      {pair.data.conflicting && <p>{t("The reviewed sources disagree. The more restrictive finding is shown.", "تتعارض المصادر المراجعة. تُعرض النتيجة الأكثر تقييداً.")}</p>}
      {pair.data.evidence.length ? pair.data.evidence.map((evidence) => <div key={evidence.id}>
        <strong>{labLabel(lang, evidence.finding)}</strong><p dir="auto">{evidence.statement}</p><p dir="auto">{evidence.conditions}</p>
        <a href={evidence.url} rel="noreferrer" target="_blank"><bdi>{evidence.title}</bdi></a> · <bdi>{evidence.verifiedAt.slice(0, 10)}</bdi>
      </div>) : <p>{t("There is no qualified reference for this pair.", "لا يوجد مرجع مؤهل لهذا الزوج.")}</p>}
    </section>}
    {reviewer && chosen && <details className="impact-details">
      <summary>{t("Add qualified evidence for this pair", "إضافة أدلة مراجعة لهذا الزوج")}</summary>
      <WriteForm key={cell.join("-")} api={api} endpoint="/pairs" onSaved={scope === "platform" ? (result) => {
        setEvidenceView(result.labId ? "&lab=" + result.labId
          : result.institutionId ? "&institution=" + result.institutionId : "");
      } : undefined} build={(form) => ({
        a, b, context, finding: field(form, "finding"), statement: field(form, "statement"),
        conditions: field(form, "conditions"), title: field(form, "title"), url: field(form, "url"),
        qualified: form.has("qualified"), institutionId: optional(form, "institutionId"), labId: optional(form, "labId"),
      })}>
        <LabSelect name="finding" en="Qualified finding" ar="نتيجة المراجعة" required value="insufficient"
          options={["incompatible", "conditional", "insufficient"].map((x) => [x, labLabel(lang, x)])} />
        <LabInput name="statement" en="Evidence-based finding" ar="النتيجة المستندة إلى الأدلة" required multiline />
        <LabInput name="conditions" en="Applicability and conditions" ar="الانطباق والشروط" required multiline />
        <div className="impact-grid compact">
          <LabInput name="title" en="Source title" ar="عنوان المصدر" required />
          <LabInput name="url" en="Authoritative evidence URL" ar="رابط الأدلة المعتمدة" type="url" required />
          {scope === "platform" && directory && <>
            <LabSelect name="institutionId" en="Institutional scope" ar="النطاق المؤسسي"
              options={directory.institutions.map((item) => [item.id, lang === "ar" ? item.nameAr : item.nameEn])} />
            <LabSelect name="labId" en="Laboratory scope" ar="نطاق المختبر"
              options={directory.labs.map((item) => [item.id, lang === "ar" ? item.nameAr : item.nameEn])} />
          </>}
        </div>
        <label><input name="qualified" type="checkbox" required /> {t("I verified the source and applicability as a qualified reviewer.",
          "تحققت من المصدر والانطباق بصفتي مراجعاً مؤهلاً.")}</label>
      </WriteForm>
    </details>}
    <FormError error={matrix.error || pair.error} />
  </details>;
}

function Compound({ cid, api, scope, assetBase }: { cid: number; api: LabApi; scope: string; assetBase: string }) {
  const lang = useLanguage();
  const t = (en: string, ar: string) => words(lang, en, ar);
  const query = useQuery({ queryKey: ["pubchem-reference", scope, cid], retry: false, gcTime: 60_000,
    queryFn: ({ signal }) => api<CompoundDetail>("/knowledge/" + cid, undefined, signal) });
  const record = query.data;
  const [structure, setStructure] = useState(false);
  return <section className="impact-form">
    {query.isPending && <p role="status">{t("Retrieving source data…", "جارٍ جلب بيانات المصادر…")}</p>}
    <FormError error={query.error} />
    {record && <>
      <h3 dir="auto">{record.name}</h3>
      <dl className="impact-facts">
        <div><dt>{t("Formula", "الصيغة")}</dt><dd><bdi>{record.formula}</bdi></dd></div>
        <div><dt>{t("CAS", "رقم CAS")}</dt><dd><bdi>{record.cas ?? numberLabel(lang, null)}</bdi></dd></div>
        <div><dt>{t("Molecular weight", "الوزن الجزيئي")}</dt><dd><bdi>{numberLabel(lang, record.mass, "g/mol")}</bdi></dd></div>
        <div><dt>PubChem CID</dt><dd><a href={record.url} rel="noreferrer" target="_blank">{record.cid}</a></dd></div>
      </dl>
      <details className="impact-details"><summary>{t("Physical properties and solubility", "الخواص الفيزيائية والذوبانية")}</summary>
        {record.properties.length ? <dl className="impact-facts">{record.properties.map(({ label, value, url }, i) =>
          <div key={i}><dt><a href={url} rel="noreferrer" target="_blank"><bdi>{label}</bdi></a></dt><dd dir="auto">{value}</dd></div>)}</dl> :
          <p>{t("The source supplied no usable properties.", "لم يوفر المصدر خواص قابلة للاستخدام.")}</p>}
      </details>
      <details className="impact-details"><summary>{t("Reported hazards and incompatibility references", "الأخطار المبلغ عنها ومراجع عدم التوافق")}</summary>
        <div className="button-row">{record.pictograms.map(({ code, name }) =>
          <figure key={code}><img src={assetBase + "/pictograms/" + code} width="44" height="44" alt={code + " " + name} /><figcaption>{code}</figcaption></figure>)}</div>
        <p>{t("PubChem annotations may reflect different sources and conditions. Consult the product-specific SDS.", "قد تعكس ملاحظات PubChem مصادر وشروطاً مختلفة. راجع صحيفة السلامة الخاصة بالمنتج.")}</p>
        <ul>{record.hazards.map((h, i) => <li key={i} dir="auto"><a href={h.url} rel="noreferrer" target="_blank">{h.title}</a>{h.excerpt && <p>{h.excerpt}</p>}</li>)}</ul>
      </details>
      {record.sourceGaps.length > 0 && <p>{t("Some sources could not be loaded. Review the PubChem record for gaps.", "تعذر تحميل بعض المصادر. راجع سجل PubChem للمعلومات الناقصة.")}</p>}
      {record.discreteModel ? <>
        <div><Button variant="outlined" onClick={() => setStructure(!structure)} aria-expanded={structure}>{t("Molecular structure viewer", "عارض البنية الجزيئية")}</Button></div>
        {structure && <Suspense fallback={<p role="status">{t("Loading viewer…", "جارٍ تحميل العارض…")}</p>}><Molecule key={cid} cid={cid} api={api} scope={scope} /></Suspense>}
      </> : <p>{t("A discrete model is unavailable or unsuitable for this record, including ionic compounds, mixtures and polymers.", "لا يتوفر نموذج جزيئي منفرد مناسب لهذا السجل، مثل المركبات الأيونية والمخاليط والبوليمرات.")}</p>}
    </>}
  </section>;
}

export function Explorer({ api = publicApi, scope = "public", reviewer, directory, storageOnly, assetBase = "/api/impact" }: {
  api?: LabApi; scope?: string; reviewer?: boolean; directory?: OrganizationDirectory; storageOnly?: boolean; assetBase?: string;
}) {
  const lang = useLanguage();
  const t = (en: string, ar: string) => words(lang, en, ar);
  const [params] = useSearchParams();
  const initial = params.get("q")?.slice(0, 120) ?? "";
  const [q, setQ] = useState(initial);
  const [after, setAfter] = useState("");
  const [id, setId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [external, setExternal] = useState("");
  const [cid, setCid] = useState(0);
  const [comparePubChem, setComparePubChem] = useState<number[]>([]);
  const query = useQuery({ queryKey: ["workspace", scope, "catalog", q, after], retry: false, gcTime: 0,
    queryFn: ({ signal }) => api<CatalogPage>("/chemicals?" + new URLSearchParams({ q, ...(after ? { after } : {}) }), undefined, signal) });
  const knowledge = scope === "platform" ? api : publicApi;
  const lookup = useQuery({ queryKey: ["pubchem", scope, external], enabled: Boolean(external), retry: false, gcTime: 60_000,
    queryFn: ({ signal }) => knowledge<{ compounds: CompoundReference[]; ambiguous: boolean }>("/knowledge?" + new URLSearchParams({ q: external }), undefined, signal) });
  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const value = field(new FormData(event.currentTarget), "q"); setQ(value); setAfter("");
  }
  return <section className="panel impact-panel">
    <h2>{storageOnly ? t("Storage compatibility", "توافق التخزين") : t("Chemical explorer", "مستكشف المواد الكيميائية")}</h2>
    <form className="impact-grid compact" onSubmit={search}>
      <LabInput name="q" en="Arabic or English name, CAS, formula or CID" ar="الاسم بالعربية أو الإنجليزية أو CAS أو الصيغة أو المعرّف" value={q} />
      <Submit>{t("Search chemical references", "البحث في المراجع الكيميائية")}</Submit>
    </form>
    {query.isPending && <p role="status">{t("Loading references…", "جارٍ تحميل المراجع…")}</p>}
    <FormError error={query.error} />
    {query.data?.chemicals.length === 0 && <p>{t("No local reference records match.", "لا توجد سجلات مرجعية محلية مطابقة.")}</p>}
    <div className="impact-grid compact">{query.data?.chemicals.map((item) => {
      const name = lang === "ar" ? item.nameAr : item.nameEn;
      return <div className="impact-details" key={item.id}>
        {!storageOnly && <Button size="small" aria-pressed={id === item.id} onClick={() => setId(item.id)}><bdi>{name}</bdi></Button>}
        <label><input type="checkbox" checked={selected.includes(item.id)} disabled={selected.length >= 8 && !selected.includes(item.id)}
          onChange={(event) => {
            const checked = event.target.checked;
            setSelected((previous) => checked ? [...previous, item.id] : previous.filter((key) => key !== item.id));
            setNames((previous) => ({ ...previous, [item.id]: name }));
          }} /> <bdi>{name}</bdi></label>
      </div>;
    })}</div>
    <div className="button-row">
      {after && <Button onClick={() => setAfter("")}>{t("First page", "الصفحة الأولى")}</Button>}
      {query.data?.next && <Button onClick={() => setAfter(query.data?.next ?? "")}>{t("Next page", "الصفحة التالية")}</Button>}
      {selected.length > 0 && <Button onClick={() => { setSelected([]); setNames({}); }}>{t("Clear selection", "مسح التحديد")}</Button>}
    </div>
    {id && !storageOnly && <CatalogCard id={id} api={api} scope={scope} onCompound={setCid} />}
    {!storageOnly && <Compare api={api} scope={scope} selected={selected} />}
    <Matrix api={api} scope={scope} selected={selected} names={names} storage={storageOnly} reviewer={reviewer} directory={directory} />
    {!storageOnly && <>
      <details className="impact-details" open={Boolean(cid || external) || undefined}>
        <summary>{t("Search PubChem beyond the reference catalogue", "البحث في PubChem خارج قائمة المراجع")}</summary>
        <form className="impact-grid compact" onSubmit={(event) => {
          event.preventDefault(); setExternal(field(new FormData(event.currentTarget), "pubchem"));
        }}>
          <LabInput name="pubchem" en="English substance name, CAS, formula or CID" ar="اسم المادة بالإنجليزية أو CAS أو الصيغة أو المعرّف" value={q} required />
          <Submit>{t("Search PubChem", "البحث في PubChem")}</Submit>
        </form>
        <FormError error={lookup.error} />
        {external && lookup.isFetching && <p role="status">{t("Searching PubChem…", "جارٍ البحث في PubChem…")}</p>}
        {lookup.data?.ambiguous && <p>{t("Multiple compounds matched. Check the identity before choosing.", "تطابقت عدة مركبات. تحقق من الهوية قبل الاختيار.")}</p>}
        {lookup.data?.compounds.length === 0 && <p>{t("No compound matched.", "لا يوجد مركب مطابق.")}</p>}
        <div className="impact-pill-nav">{lookup.data?.compounds.map((c) => <div key={c.cid}>
          <Button onClick={() => setCid(c.cid)}><bdi>{c.name} · {c.formula}</bdi></Button>
          <label><input type="checkbox" checked={comparePubChem.includes(c.cid)} disabled={comparePubChem.length >= 2 && !comparePubChem.includes(c.cid)}
            onChange={(event) => { const checked = event.target.checked; setComparePubChem((prev) => checked ? [...prev, c.cid] : prev.filter((x) => x !== c.cid)); }} />
          {" "}{t("Compare", "مقارنة")} <bdi>{c.name}</bdi></label>
        </div>)}</div>
        {comparePubChem.length > 0 && <Button onClick={() => setComparePubChem([])}>
          {t("Clear PubChem comparison", "مسح مقارنة PubChem")}
        </Button>}
        {comparePubChem.length === 2 ? <div className="impact-grid">{comparePubChem.map((x) => <Compound key={x} cid={x} api={knowledge} scope={scope} assetBase={assetBase} />)}</div> :
          cid > 0 && <Compound key={cid} cid={cid} api={knowledge} scope={scope} assetBase={assetBase} />}
      </details>
      {scope !== "public" && <Matrix api={api} scope={scope} selected={selected} names={names} storage reviewer={reviewer} directory={directory} />}
    </>}
  </section>;
}

export default function ChemicalExplorer() {
  const lang = useLanguage();
  return <div className="page">
    <PageHeading title={words(lang, "Chemical knowledge", "المعرفة الكيميائية")} />
    <Explorer />
  </div>;
}
