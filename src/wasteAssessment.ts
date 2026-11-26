import { z } from "zod";
import { scientificReferenceIdSchema, scientificSourceSchema, scientificTextLimit } from "./scientificReport";

export const wasteSegregationCategories = [
  "Halogenated organic waste", "Non-halogenated organic waste", "Aqueous waste", "Acidic waste", "Alkaline waste",
  "Heavy metal waste", "Inorganic waste", "Mixed chemical waste", "Other",
] as const;
export const wasteHazardCharacteristics = [
  "Oxidizing waste", "Reducing waste", "Reactive waste", "Flammable waste", "Toxic waste", "Corrosive waste",
] as const;
export const undeterminedWaste = "Undetermined";
export const wasteClassifications = [...wasteSegregationCategories, ...wasteHazardCharacteristics, undeterminedWaste] as const;
export type WasteClassification = typeof wasteClassifications[number];
export const wasteClassificationsSchema = z.array(z.enum(wasteClassifications)).min(1).max(wasteClassifications.length)
  .refine((values) => new Set(values).size === values.length && (values.length === 1 || !values.includes(undeterminedWaste)));

export const wasteNarrativeFields = ["justification", "hazards", "limitations", "missingInformation"] as const;
const narrative = z.string().trim().min(1).max(scientificTextLimit);
const bilingual = z.strictObject({ en: narrative, ar: narrative });
const wasteFields = z.strictObject({
  classifications: wasteClassificationsSchema,
  justification: bilingual,
  hazards: bilingual,
  limitations: bilingual,
  missingInformation: bilingual,
});

export const wasteReviewInputSchema = wasteFields.extend({
  referenceIds: z.array(scientificReferenceIdSchema).max(20),
  mixtureSources: z.array(scientificSourceSchema).max(5),
  attestation: z.literal(true),
});
export type WasteReviewInput = z.infer<typeof wasteReviewInputSchema>;

export const reviewedWasteAssessmentSchema = wasteFields.extend({
  sources: z.array(scientificSourceSchema).max(25),
}).refine(({ classifications, sources }) => classifications.includes(undeterminedWaste) || sources.length > 0);
export type ReviewedWasteAssessment = z.infer<typeof reviewedWasteAssessmentSchema>;

export type WasteGapCode = "identity" | "concentration" | "solvent" | "state" | "temperature" | "quantity" |
  "conditions" | "purity" | "ph" | "finalVolume" | "mixtureEvidence" | "mixtureHazards";

export interface WasteEvidence {
  basis: "aqueousMethanol" | "aqueousSodiumChloride" | "insufficient";
  supportedClassifications: Exclude<WasteClassification, typeof undeterminedWaste>[];
  referenceIds: string[];
  hazardReferenceIds: string[];
  missing: { code: WasteGapCode; solution?: "A" | "B" }[];
}

export interface WasteDraft extends WasteEvidence {
  classifications: WasteClassification[];
}

export function supportedWasteSelection(
  classifications: WasteClassification[], referenceIds: string[], draft?: WasteDraft,
) {
  if (classifications.includes(undeterminedWaste)) return true;
  return draft !== undefined && draft.referenceIds.length > 0 &&
    draft.referenceIds.every((id) => referenceIds.includes(id)) &&
    classifications.every((value) => value !== undeterminedWaste && draft.supportedClassifications.includes(value));
}
