import type { CalculationExplanation, CalculationReport as Report } from "../../src/calculation";
import { useAdminText } from "./text";

export default function CalculationReport({ report, explanation }: {
  report: Report;
  explanation?: CalculationExplanation;
}) {
  const t = useAdminText();
  return <section>
    <h3>{t("calculationTitle")}</h3>
    {report.status === "calculated" ? <>
      <p><bdi>{report.model.id} · v{report.model.version}</bdi></p>
      <p>{t("analyticalConcentration")}{" "}
        <strong><bdi>{Number(report.result.analyticalMolPerL.toPrecision(6))} mol/L</bdi></strong>
      </p>
      <p><bdi>{report.inputs.stockMolPerL} mol/L × {report.inputs.stockVolumeL} L ÷ {report.inputs.finalVolumeL} L · {report.inputs.temperatureK} K</bdi></p>
      <p>{t("dilutionLimits")}</p>
      <ul>{report.references.map(({ url, title, locator, checkedOn }) => <li key={url}>
        <a href={url} target="_blank" rel="noreferrer" className="text-link"><bdi>{title}</bdi></a>
        {" · "}<bdi>{locator}</bdi>{" · "}<time dateTime={checkedOn}>{checkedOn}</time>
      </li>)}</ul>
    </> : <>
      <p>{t(report.status === "unsupported" ? "calculationUnsupported" : "calculationMissing")}</p>
      <ul>{report.reasons.map(({ code, side }) => <li key={code + (side ?? "")}>
        {side ? `${t("solution")} ${side} · ` : ""}{t(code)}
      </li>)}</ul>
    </>}
    {explanation && <p>{t(explanation.focus)}</p>}
  </section>;
}
