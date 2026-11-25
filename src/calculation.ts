import { z } from "zod";

export const calculationReasons = [
  "noModel", "calculationIdentityMissing", "identityUnsupported", "solventMissing", "solventUnsupported",
  "stateMissing", "stateUnsupported", "temperatureMissing", "temperatureUnsupported",
  "stockConcentrationMissing", "stockConcentrationUnsupported", "stockVolumeMissing",
  "stockVolumeUnsupported", "finalVolumeMissing", "finalVolumeUnsupported",
  "diluentConcentration", "diluentQuantity", "additionalContext", "numericRange",
] as const;

export const explanationSchema = z.strictObject({
  focus: z.enum(["soluteBalance", "measuredVolume", "missingInputs", "outsideCoverage"]),
});
export type CalculationExplanation = z.infer<typeof explanationSchema>;

export interface CalculationReference {
  title: string;
  url: string;
  locator: string;
  checkedOn: string;
}

type Blocked = {
  status: "needs-information" | "unsupported";
  reasons: { code: typeof calculationReasons[number]; side?: "A" | "B" }[];
};

type Calculated = {
  status: "calculated";
  model: { id: string; version: number };
  inputs: {
    soluteCid: number;
    solventCid: number;
    stockMolPerL: number;
    stockVolumeL: number;
    finalVolumeL: number;
    temperatureK: number;
  };
  result: {
    analyticalMolPerL: number;
    measurementUncertainty: "unavailable";
  };
  references: readonly CalculationReference[];
};

export type CalculationReport = Blocked | Calculated;
