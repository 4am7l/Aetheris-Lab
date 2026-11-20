import { useText } from "../text";
import type { ApprovedResult, Solution } from "../domain";
import { Icon, Notice } from "../ui";
// Future authenticated server-read presentation only. Never import local/demo data here.
// The server must enforce publication.ts and ownership before returning this object.
export function ApprovedResultPanel({
  result,
  a,
  b,
}: {
  result: ApprovedResult;
  a: Solution;
  b: Solution;
}) {
  const t = useText();
  return (
    <section className="approved-result panel">
      <span className="eyebrow">EXPERT-REVIEWED RESULT</span>
      <h2>{result.classification}</h2>
      <p>
        {a.name} + {b.name}
      </p>
      <Notice kind="warning">{t("approval")}</Notice>
      <div className="detail-grid">
        <section>
          <h3>Documented conditions</h3>
          <p>{result.conditions}</p>
        </section>
        <section>
          <h3>{t("hazards")}</h3>
          <ul>
            {result.hazards.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </section>
        <section>
          <h3>{t("incompatibilities")}</h3>
          <ul>
            {result.incompatibilities.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </section>
        <section>
          <h3>{t("storage")}</h3>
          <p>{result.storage}</p>
          <p>{result.container}</p>
        </section>
      </div>
      <h3>Limitations</h3>
      <ul>
        {result.limitations.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <h3>{t("references")}</h3>
      <ul>
        {result.sources.map((s) => (
          <li key={s.url}>
            <a
              className="text-link"
              href={s.url}
              target="_blank"
              rel="noreferrer"
            >
              {s.title}
              <Icon name="open_in_new" />
            </a>
          </li>
        ))}
      </ul>
      <p className="small muted">
        Reviewer: {result.reviewerId} ·{" "}
        {new Date(result.reviewedAt).toLocaleString()}
      </p>
    </section>
  );
}
