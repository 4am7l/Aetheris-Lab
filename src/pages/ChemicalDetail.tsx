import { Link, useParams } from "react-router-dom";
import Button from "@mui/material/Button";
import { substanceReferencesByCas } from "../data/substanceReferences";
import { catalogAliases, readCatalogProvenance } from "../impact/catalogSearch";
import { ImpactError } from "../impact/client";
import { labLabel } from "../impact/labels";
import { RateDetails } from "../impact/Management";
import { httpsUrl } from "../impact/model";
import { usePublicChemical } from "../services/publicCatalog";
import { Icon, Notice } from "../ui";
import { useLanguage, useText } from "../text";
import "../impact/impact.css";

export default function ChemicalDetail() {
  const { id = "" } = useParams();
  const t = useText();
  const language = useLanguage();
  const detail = usePublicChemical(id);
  const c = detail.data?.chemical;
  const reference = c ? readCatalogProvenance(c.provenance) : {};
  const source = httpsUrl.safeParse(reference.url);
  const substanceReference = c && substanceReferencesByCas.get(c.cas ?? "");
  const aliases = c ? catalogAliases(c) : [];
  const missing = detail.error instanceof ImpactError && detail.error.status === 404;
  return (
    <div className="page detail-page">
      <Link className="text-link" to="/library">
        {t("back")} · {t("library")}
      </Link>
      {detail.isPending && <p role="status">{t("loading")}</p>}
      {missing && <p role="status">{t("catalogReferenceMissing")}</p>}
      {detail.isError && !missing && <Notice kind="error">
        {t("catalogUnavailable")} <Button onClick={() => void detail.refetch()} disabled={detail.isFetching}>{t("retry")}</Button>
      </Notice>}
      {c && detail.data && <>
        <div className="chemical-detail-header">
          <div>
            <span className="eyebrow">{labLabel(language, c.status)}</span>
            <h1>{language === "ar" ? c.nameAr : c.nameEn}</h1>
            <p dir="auto">{language === "ar" ? c.nameEn : c.nameAr}</p>
            {aliases.length > 0 && <p>{t("catalogAliases")} · {aliases.map((alias, i) =>
              <span key={alias}>{i > 0 && " · "}<bdi>{alias}</bdi></span>)}</p>}
          </div>
          {c.formula && <span className="large-formula">{c.formula}</span>}
        </div>
        <div className="detail-meta panel">
          {[
            [t("cas"), c.cas], [t("concentration"), c.concentration], [t("classification"), c.category && labLabel(language, c.category)],
            [t("state"), c.state], [t("catalogFormulation"), c.formulation], [t("catalogPurity"), c.purity], [t("solvent"), c.solvent],
          ].map(([label, value]) => <div key={label}>{label}<strong><bdi>{value ?? t("catalogNotRecorded")}</bdi></strong></div>)}
        </div>
        {(c.hazards || c.wasteCategory) && <div className="detail-grid">
          {c.hazards && <section className="panel">
            <h2>{t("catalogHazards")}</h2>
            <p dir="auto">{c.hazards}</p>
          </section>}
          {c.wasteCategory && <section className="panel">
            <h2>{t("catalogWaste")}</h2>
            <p dir="auto">{c.wasteCategory}</p>
          </section>}
        </div>}
        {c.status === "unverified" && <Notice>{t("catalogVerification")}</Notice>}
        <section className="panel">
          <h2>{t("references")}</h2>
          {typeof reference.document === "string" && <p>
            <bdi>{reference.document}</bdi>
            {typeof reference.section === "number" && <> · {t("catalogSection")} {reference.section}</>}
            {typeof reference.page === "number" && <> · {t("catalogPage")} {reference.page}</>}
            {typeof reference.row === "number" && <> · {t("catalogRow")} {reference.row}</>}
          </p>}
          {source.success && <p><a className="text-link" href={source.data} target="_blank" rel="noreferrer">
            {t("catalogSource")} <Icon name="open_in_new" />
          </a></p>}
          {substanceReference && <p><a className="text-link" href={substanceReference.source} target="_blank" rel="noreferrer">
            {t("catalogNiosh")} <Icon name="open_in_new" />
          </a></p>}
          <RateDetails item={detail.data} />
        </section>
      </>}
    </div>
  );
}
