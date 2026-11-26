import { z } from "zod";

export const scientificTopics = [
  "identification", "composition", "structure", "properties", "conditions", "solvent",
  "reactions", "products", "stoichiometry", "concentrations", "equilibrium", "acidBase",
  "thermodynamics", "thermal", "kinetics", "redox", "solubility", "gas", "phases", "stability",
  "compatibility", "exposure", "fire", "environment", "missing", "uncertainty", "safety",
] as const;
export type ScientificTopic = typeof scientificTopics[number];

export const scientificTextLimit = 1200;
const localized = z.string().trim().min(1).max(scientificTextLimit);
export const reviewedSectionFields = z.strictObject({
  topic: z.enum(scientificTopics),
  en: localized,
  ar: localized,
});
export const scientificSourceSchema = z.strictObject({
  title: z.string().trim().min(1).max(600),
  url: z.url({ protocol: /^https$/ }).max(1500).refine((value) => {
    const url = new URL(value);
    return !url.username && !url.password;
  }),
});
export const reviewedScienceSchema = z.array(reviewedSectionFields.extend({
  sources: z.array(scientificSourceSchema).max(20),
})).min(1).max(scientificTopics.length)
  .refine((sections) => new Set(sections.map(({ topic }) => topic)).size === sections.length);
export const scientificReferenceIdSchema = z.union([z.uuidv4(), z.string().regex(/^method-[1-9][0-9]?$/)]);
export const scientificSectionInputSchema = z.array(reviewedSectionFields.extend({
  referenceIds: z.array(scientificReferenceIdSchema).max(20),
})).min(1).max(scientificTopics.length)
  .refine((sections) => new Set(sections.map(({ topic }) => topic)).size === sections.length);
export type ScientificSectionInput = z.infer<typeof scientificSectionInputSchema>[number];

export const findingCodes = [
  "identityRecords", "identityUnresolved", "molecularDescriptors", "propertyRecords", "recordedConditions",
  "aqueousScope", "methanolBalance", "saltBalance", "saltDissociation", "substanceSolubility",
  "substanceReactivity", "occupationalHazards", "substanceFire", "substanceEnvironmental",
  "missingInputs", "modelUnavailable", "measurementUncertainty", "substanceScope", "reviewRequired",
] as const;
export type FindingCode = typeof findingCodes[number];
export interface ScientificFinding {
  topic: ScientificTopic;
  code: FindingCode;
  basis: "submitted" | "retrieved" | "calculated" | "interpretation" | "limitation";
  referenceIds: string[];
}
export interface ScientificDraft {
  version: 1;
  origin: "gemini" | "evidence-review";
  findings: ScientificFinding[];
}
