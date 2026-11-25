import { z } from "zod";

export const calculationContextSchema = z.strictObject({
  closedWaterAndSaltOnly: z.literal(true),
  atAmbientPressure: z.literal(true),
  finalVolumeMl: z.number().positive(),
});

const referenceSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  publisher: z.string(),
  url: z.url({ protocol: /^https$/ }),
  locator: z.string(),
  version: z.string(),
  retrievedOn: z.iso.date(),
});

const ion = z.strictObject({
  formula: z.enum(["Na+", "Cl-"]),
  phase: z.literal("aqueous"),
  amountMol: z.number().positive(),
  concentrationMolL: z.number().positive(),
});

export const calculationResultSchema = z.strictObject({
  model: z.literal("dilute-aqueous-nacl"),
  version: z.literal("1.0.0"),
  temperatureC: z.literal(25),
  finalVolumeL: z.number().positive(),
  phase: z.literal("single-aqueous-liquid"),
  species: z.tuple([ion.extend({ formula: z.literal("Na+") }), ion.extend({ formula: z.literal("Cl-") })]),
  uncertainty: z.literal("not-quantified"),
  references: z.array(referenceSchema).min(1),
});

export type CalculationResult = z.infer<typeof calculationResultSchema>;
export type CalculationContext = z.infer<typeof calculationContextSchema>;

export type CalculationIssue = {
  side?: "A" | "B";
} & (
  | { kind: "missing"; code: "identity" | "concentration" | "concentrationUnit" | "solvent" | "state" | "temperature" | "quantity" | "quantityUnit" | "calculationContext" }
  | { kind: "unsupported"; code: "identityUnresolved" | "solvent" | "state" | "concentrationUnit" | "quantityUnit" | "temperature" | "concentrationRange" | "volumeRange" | "volumeMismatch" | "unstructuredConditions" }
);

export type Calculation =
  | {
    status: "calculated";
    inputs: { concentrationMolL: number; volumeL: number }[];
    result: CalculationResult;
  }
  | { status: "missing_input" | "unsupported"; issues: CalculationIssue[] };

export const explanationTopics = ["massBalance", "modelScope", "inputRequirements", "measuredVolume"] as const;
export type ExplanationTopic = typeof explanationTopics[number];
