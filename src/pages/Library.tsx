import { useState } from "react";
import { Link } from "react-router-dom";
import { categories, searchChemicals } from "../data/chemicals";
import { Icon } from "../ui";
import { useText } from "../text";
import PageHeading from "../components/PageHeading";
export default function Library() {
  const t = useText();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All entries");
  const [visible, setVisible] = useState(8);
  const filtered = searchChemicals(query, category);
  return (
    <div className="page">
      <PageHeading
        eyebrow={t("localReference")}
        title={t("library")}
        description={t("libraryIntro")}
      />
      <div className="library-search search-box">
        <Icon name="search" />
        <input
          aria-label={t("search")}
          placeholder={t("searchPlaceholder")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setVisible(8);
          }}
        />
        {query && (
          <button
            className="icon-button"
            aria-label={t("close")}
            onClick={() => setQuery("")}
          >
            <Icon name="close" />
          </button>
        )}
      </div>
      {query && (
        <div className="suggestions">
          {filtered.slice(0, 4).map((c) => (
            <button key={c.id} onClick={() => setQuery(c.name)}>
              {c.name} · {c.cas}
            </button>
          ))}
        </div>
      )}
      <div className="filter-row" aria-label="Categories">
        {categories.map((c) => (
          <button
            className={`filter-chip ${category === c ? "active" : ""}`}
            aria-pressed={category === c}
            key={c}
            onClick={() => {
              setCategory(c);
              setVisible(8);
            }}
          >
            {c === "All entries" ? t("all") : c}
          </button>
        ))}
      </div>
      <p className="catalog-note">
        <Icon name="info" />
        {t("catalogNote")}
      </p>
      {filtered.length ? (
        <div className="library-grid">
          {filtered.slice(0, visible).map((c) => (
            <Link to={`/library/${c.id}`} className="chemical-card" key={c.id}>
              <div className="chemical-card-top">
                <span className="formula">{c.formula}</span>
                <span className="category-pill">{c.category}</span>
              </div>
              <h2>{c.name}</h2>
              <p className="muted">{c.aliases[0]}</p>
              <div className="chemical-meta">
                <span>CAS {c.cas}</span>
                <span>{c.mass} g/mol</span>
              </div>
              <div className="chemical-card-bottom">
                <span>
                  <Icon name="verified" /> NIOSH reference
                </span>
                <span>{t("details")}</span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="panel empty-state">
          <Icon name="search_off" />
          <h2>{t("empty")}</h2>
          <p>{t("emptyText")}</p>
        </div>
      )}
      {visible < filtered.length && (
        <button
          className="button outlined"
          onClick={() => setVisible((v) => v + 8)}
        >
          Load more
        </button>
      )}
    </div>
  );
}
