import { scientificReferences, type AdminRequestDetail } from "../../src/review";
import { scientificLabels } from "../../src/scientificLabels";
import type { ScientificFinding, ScientificTopic } from "../../src/scientificReport";
import { useLanguage } from "../../src/text";
import { findingContent } from "./scientificText";
import { useAdminText } from "./text";

export function ScientificAssessment({ request }: { request: AdminRequestDetail }) {
  const t = useAdminText();
  const language = useLanguage();
  const report = request.report?.scientificReport;
  if (!report) return null;
  const references = scientificReferences(request.evidence, request.report?.calculation);
  const grouped = new Map<ScientificTopic, ScientificFinding[]>();
  for (const finding of report.findings) {
    grouped.set(finding.topic, [...(grouped.get(finding.topic) ?? []), finding]);
  }

  return <section>
    <h3>{t(report.origin === "gemini" ? "geminiScientificReport" : "evidenceScientificReport")}</h3>
    {[...grouped].map(([topic, findings]) => (
      <section key={topic} className="admin-evidence">
        <h4>{scientificLabels[topic][language]}</h4>
        {findings.map(({ code, basis, referenceIds }) => {
          const content = findingContent(code, request, language);
          return <div key={code}>
            <div className="small muted">{t(basis === "submitted" ? "submittedEvidence" : basis)}</div>
            <p>{content[language]}</p>
            {content.rows.map((row) => <p key={row}><bdi dir="ltr">{row}</bdi></p>)}
            {referenceIds.length > 0 && <ul>{referenceIds.map((id) => {
              const source = references.get(id);
              return source && <li key={id}>
                {source.solution && <><bdi>{source.solution}</bdi>{" · "}</>}
                {source.solution
                  ? <a className="text-link" href={"#evidence-" + id}><bdi>{source.title}</bdi></a>
                  : <a className="text-link" href={source.url} target="_blank" rel="noreferrer"><bdi>{source.title}</bdi></a>}
              </li>;
            })}</ul>}
          </div>;
        })}
      </section>
    ))}
  </section>;
}
