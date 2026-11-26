import { useLanguage, useText } from "../text";
import type { PublicResult } from "../domain";
import { resultLabel } from "../reviewText";
import { scientificLabels } from "../scientificLabels";
import { Icon, Notice } from "../ui";
import { WasteAssessmentSection } from "./WasteAssessmentSection";

export function ApprovedResultPanel({ result }: { result: PublicResult }) {
  const t = useText();
  const language = useLanguage();
  return (
    <section className="approved-result panel">
      <span className="eyebrow">{t("expertResult")}</span>
      <h2>{t(resultLabel[result.classification])}</h2>
      <Notice kind="warning">{t("approval")}</Notice>
      <div className="detail-grid">
        <section>
          <h3>{t("documentedConditions")}</h3>
          <p dir="auto">{result.conditions}</p>
        </section>
        {([[result.hazards, "hazards"], [result.incompatibilities, "incompatibilities"]] as const)
          .filter(([items]) => items.length > 0).map(([items, key]) => (
            <section key={key}>
              <h3>{t(key)}</h3>
              <ul>{items.map((item, index) => <li key={index} dir="auto">{item}</li>)}</ul>
            </section>
          ))}
        <section>
          <h3>{t("storage")}</h3>
          <p dir="auto">{result.storage}</p>
          <p dir="auto">{result.container}</p>
        </section>
      </div>
      <h3>{t("limitations")}</h3>
      <ul>{result.limitations.map((item, index) => <li key={index} dir="auto">{item}</li>)}</ul>
      {result.scientificReport && <section>
        <h3>{t("reviewedScientificReport")}</h3>
        {result.scientificReport.map(({ topic, en, ar, sources }) => <section key={topic}>
          <h4>{scientificLabels[topic][language]}</h4>
          <p dir={language === "ar" ? "rtl" : "ltr"} style={{ whiteSpace: "pre-line" }}>{language === "ar" ? ar : en}</p>
          {sources.length > 0 && <ul>{sources.map(({ url, title }) =>
            <li key={url}><a href={url} target="_blank" rel="noreferrer" className="text-link"><bdi>{title}</bdi></a></li>
          )}</ul>}
        </section>)}
      </section>}
      {result.wasteAssessment && <WasteAssessmentSection assessment={result.wasteAssessment} />}
      <h3>{t("references")}</h3>
      <ul>
        {result.sources.map(({ url, title }) => (
          <li key={url}>
            <a className="text-link" href={url} target="_blank" rel="noreferrer">
              <bdi>{title}</bdi> <Icon name="open_in_new" />
            </a>
          </li>
        ))}
      </ul>
      <p className="small muted">
        {t("reviewedAt")}{" "}
        <time dateTime={result.reviewedAt}>
          {new Date(result.reviewedAt).toLocaleString(document.documentElement.lang || undefined)}
        </time>
      </p>
    </section>
  );
}
