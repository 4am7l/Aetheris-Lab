import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Button from "@mui/material/Button";
import { matchesCatalogChemical, normalizeCatalogTerm } from "../impact/catalogSearch";
import { labLabel } from "../impact/labels";
import { usePublicCatalog } from "../services/publicCatalog";
import { Icon, Notice } from "../ui";
import { useLanguage, useText } from "../text";
import PageHeading from "../components/PageHeading";
import SearchField from "../components/SearchField";
export default function Library() {
  const t = useText();
  const language = useLanguage();
  const [params, setParams] = useSearchParams();
  const catalog = usePublicCatalog();
  const query = params.get("q") ?? "";
  const setQuery = (value: string) =>
    setParams(value ? { q: value } : {}, { replace: true });
  const [selectedCategory, setCategory] = useState("");
  const categories = useMemo(() => [...new Set(catalog.data?.flatMap(({ category }) => category ? [category] : []))].sort(),
    [catalog.data]);
  const category = categories.includes(selectedCategory) ? selectedCategory : "";
  const normalized = normalizeCatalogTerm(query);
  const filtered = catalog.data?.filter((chemical) =>
    (!category || chemical.category === category) && matchesCatalogChemical(chemical, normalized),
  ) ?? [];
  return (
    <div className="page">
      <PageHeading
        title={t("library")}
        description={t("libraryIntro")}
      />
      <div className="library-actions"><Button variant="contained" component={Link} to="/library/explorer">{t("chemicalExplorerNav")}</Button></div>
      <SearchField
        accessibleName={t("search")}
        placeholder={t("catalogSearchPlaceholder")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        clear={query ? { label: t("clearSearch"), action: () => setQuery("") } : undefined}
      />
      {categories.length > 0 && (
        <div className="filter-row" role="group" aria-label={t("classification")}>
          {["", ...categories].map((c) => (
            <Chip key={c} component="button" type="button"
              label={c ? labLabel(language, c) : t("all")}
              variant={category === c ? "filled" : "outlined"}
              aria-pressed={category === c} onClick={() => setCategory(c)}
              className={category === c ? "selected-filter" : ""} />
          ))}
        </div>
      )}
      {catalog.isPending && <p className="catalog-note" role="status">{t("loading")}</p>}
      {catalog.isError && <Notice kind="error">
        {t("catalogUnavailable")} <Button onClick={() => void catalog.refetch()} disabled={catalog.isFetching}>{t("retry")}</Button>
      </Notice>}
      {filtered.length > 0 && <p className="catalog-note" role="status">
        {t(filtered.length === 1 ? "catalogSingle" : "catalogCount").replace("{count}", new Intl.NumberFormat(language).format(filtered.length))}
      </p>}
      {filtered.length > 0 && (
        <Paper className="catalog-list">
          <div className="catalog-table-heading">
            <span>{t("substance")}</span>
            <span>{t("cas")}</span>
            <span>{t("classification")}</span>
          </div>
          {filtered.map((c) => (
            <Link className="catalog-row" to={"/library/" + c.id} key={c.id}>
              <div className="catalog-substance">
                {c.formula && <span className="catalog-formula">{c.formula}</span>}
                <span>
                  <strong><bdi lang={language}>{language === "ar" ? c.nameAr : c.nameEn}</bdi></strong>
                  <small><bdi lang={language === "ar" ? "en" : "ar"}>{language === "ar" ? c.nameEn : c.nameAr}</bdi></small>
                  {c.concentration && <small><bdi>{c.concentration}</bdi></small>}
                </span>
              </div>
              <span className="catalog-cas">
                <bdi dir="ltr">{c.cas ?? "—"}</bdi>
              </span>
              <span className="catalog-category"><bdi>{c.category ? labLabel(language, c.category) : t("catalogNotRecorded")}</bdi></span>
              <Icon name="chevron_right" />
            </Link>
          ))}
        </Paper>
      )}
      {catalog.isSuccess && filtered.length === 0 && (
        <div className="panel empty-state" role="status">
          <Icon name="search_off" />
          <h2>{t("empty")}</h2>
          <p>{t(query || category ? "emptyText" : "catalogEmpty")}</p>
        </div>
      )}
    </div>
  );
}
