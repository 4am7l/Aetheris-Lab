import { isSaltBalance, type CalculationExplanation, type CalculationReport as Report } from "../../src/calculation";
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
      {isSaltBalance(report) ? <>
        <p><bdi dir="ltr">NaCl(aq) → Na⁺(aq) + Cl⁻(aq)</bdi></p>
        <p>{t("ionBalance")}{" "}
          <strong><bdi dir="ltr">{Number(report.amountMolPerIon.toPrecision(6))} mol · {Number(report.molPerLPerIon.toPrecision(6))} mol/L</bdi></strong>
        </p>
        {report.stocks.map(({ molPerL, volumeL }, index) =>
          <p key={index}><bdi dir="ltr">{index === 0 ? "A" : "B"} · {molPerL} mol/L × {volumeL} L</bdi></p>)}
        <p><bdi dir="ltr">V(final) = {report.finalVolumeL} L · {report.temperatureK} K</bdi></p>
        <p>{t("saltLimits")}</p>
      </> : <>
        <p>{t("analyticalConcentration")}{" "}
          <strong><bdi dir="ltr">{Number(report.result.analyticalMolPerL.toPrecision(6))} mol/L</bdi></strong>
        </p>
        <p><bdi dir="ltr">{report.inputs.stockMolPerL} mol/L × {report.inputs.stockVolumeL} L ÷ {report.inputs.finalVolumeL} L · {report.inputs.temperatureK} K</bdi></p>
        <p>{t("dilutionLimits")}</p>
      </>}
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
