import { z } from "zod";

export const calculationReasons = [
  "noModel", "calculationIdentityMissing", "identityUnsupported", "solventMissing", "solventUnsupported",
  "stateMissing", "stateUnsupported", "temperatureMissing", "temperatureUnsupported",
  "stockConcentrationMissing", "stockConcentrationUnsupported", "stockVolumeMissing",
  "stockVolumeUnsupported", "finalVolumeMissing", "finalVolumeUnsupported",
  "diluentConcentration", "diluentQuantity", "additionalContext", "numericRange",
  "saltConcentration", "saltVolume", "saltFinalVolume",
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
  model: { id: "aqueous-methanol-dilution"; version: number };
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

export type SodiumChlorideBalance = {
  status: "calculated";
  model: { id: "dilute-aqueous-nacl"; version: number };
  stocks: { molPerL: number; volumeL: number }[];
  finalVolumeL: number;
  temperatureK: number;
  amountMolPerIon: number;
  molPerLPerIon: number;
  references: readonly CalculationReference[];
};

export type CalculationReport = Blocked | Calculated | SodiumChlorideBalance;

export function isSaltBalance(
  calculation: Extract<CalculationReport, { status: "calculated" }>,
): calculation is SodiumChlorideBalance {
  return calculation.model.id === "dilute-aqueous-nacl";
}

export function soluteConcentration(concentration: number, stockVolume: number, measuredFinalVolume: number) {
  return concentration * (stockVolume / measuredFinalVolume);
}
