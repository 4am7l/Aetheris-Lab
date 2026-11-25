import type { CalculationResult } from "../chemistry";
import { useText } from "../text";

export function ChemistryResult({ result }: { result: CalculationResult }) {
  const t = useText();
  const format = new Intl.NumberFormat(document.documentElement.lang || "en", { maximumSignificantDigits: 6 });
  return (
    <section>
      <h3>{t("chemistryResult")}</h3>
      <p>{t("chemistryModelScope")}</p>
      <p>
        <bdi>{result.model} v{result.version} · {result.temperatureC} °C · {format.format(result.finalVolumeL)} L</bdi>
      </p>
      <p>{t("chemistryPhase")}</p>
      <ul>
        {result.species.map(({ formula, amountMol, concentrationMolL }) => (
          <li key={formula}>
            <bdi>{formula === "Na+" ? "Na⁺" : "Cl⁻"} · {format.format(concentrationMolL)} mol/L · {format.format(amountMol)} mol</bdi>
          </li>
        ))}
      </ul>
      <p>{t("chemistryUncertainty")}</p>
      <h4>{t("chemistryReferences")}</h4>
      <ul>
        {result.references.map(({ id, title, url, publisher, version, locator, retrievedOn }) => (
          <li key={id}>
            <a className="text-link" href={url} target="_blank" rel="noreferrer"><bdi>{title}</bdi></a>
            <div className="small muted">
              <bdi>{publisher} · {version} · {locator} · <time dateTime={retrievedOn}>{retrievedOn}</time></bdi>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
