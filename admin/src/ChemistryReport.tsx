import type { CalculationIssue, ExplanationTopic } from "../../src/chemistry";
import type { AdminRequestDetail } from "../../src/review";
import { ChemistryResult } from "../../src/components/ChemistryResult";
import type { AdminTextKey } from "./i18n";
import { useAdminText as useText } from "./text";

const issueLabels: {
  [Kind in CalculationIssue["kind"]]: Record<Extract<CalculationIssue, { kind: Kind }>["code"], AdminTextKey>;
} = {
  missing: {
    identity: "identityMissing", concentration: "concentration", concentrationUnit: "chemistryConcentrationUnit",
    solvent: "solvent", state: "state", temperature: "temperature", quantity: "quantity",
    quantityUnit: "chemistryQuantityUnit", calculationContext: "chemistryMissingContext",
  },
  unsupported: {
    identityUnresolved: "chemistryIdentityUnresolved", solvent: "chemistrySolventUnsupported",
    state: "chemistryStateUnsupported", concentrationUnit: "chemistryConcentrationUnit",
    quantityUnit: "chemistryQuantityUnit", temperature: "chemistryTemperatureUnsupported",
    concentrationRange: "chemistryConcentrationRange", volumeRange: "chemistryVolumeRange",
    volumeMismatch: "chemistryVolumeMismatch", unstructuredConditions: "chemistryUnstructured",
  },
};
const explanationLabels: Record<ExplanationTopic, AdminTextKey> = {
  massBalance: "chemistryMassBalance", modelScope: "chemistryExplainScope", inputRequirements: "chemistryExplainInputs",
  measuredVolume: "chemistryMeasuredVolume",
};

export function ChemistryReport({ report }: { report: NonNullable<AdminRequestDetail["report"]> }) {
  const t = useText();
  const { calculation, calculationExplanation } = report;
  if (!calculation) return null;
  return (
    <>
      {calculation.status === "calculated" ? (
        <>
          <ChemistryResult result={calculation.result} />
          <section>
            <h4>{t("chemistryStocks")}</h4>
            <ul>{calculation.inputs.map(({ concentrationMolL, volumeL }, index) => (
              <li key={index}><bdi>{index === 0 ? "A" : "B"} · {concentrationMolL} mol/L · {volumeL} L</bdi></li>
            ))}</ul>
          </section>
        </>
      ) : (
        <section>
          <h3>{t("chemistryCoverage")}</h3>
          <p>{t(calculation.status === "unsupported" ? "chemistryUnsupported" : "chemistryMissing")}</p>
          <ul>{calculation.issues.map(({ kind, code, side }) => {
            const key = kind === "missing" ? issueLabels.missing[code] : issueLabels.unsupported[code];
            return (
              <li key={[kind, code, side].join("/")}>
                {side ? t("solution") + " " + side + " · " : ""}
                {kind === "missing" ? t("chemistryMissingField") + " · " : ""}{t(key)}
              </li>
            );
          })}</ul>
        </section>
      )}
      {calculationExplanation && (
        <section>
          <h4>{t("chemistryExplanation")}</h4>
          <ol>{calculationExplanation.map((topic) => <li key={topic}>{t(explanationLabels[topic])}</li>)}</ol>
        </section>
      )}
    </>
  );
}
