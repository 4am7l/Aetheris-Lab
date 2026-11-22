import { z } from "zod";
import { finalResultSchema, publicInputSchema, publicRequestIdSchema, publicRequestStatusSchema, publicResultSchema } from "./domain";

const solutionSideSchema = z.enum(["A", "B"]);
const agentStatusSchema = z.enum(["running", "completed", "unconfigured", "failed"]);
const evidenceSourceSchema = z.enum(["PubChem", "NIOSH"]);
const evidenceKindSchema = z.enum(["identity", "hazard", "incompatibility"]);
export type SolutionSide = z.infer<typeof solutionSideSchema>;
export type AgentStatus = z.infer<typeof agentStatusSchema>;
export type EvidenceSource = z.infer<typeof evidenceSourceSchema>;
export type EvidenceKind = z.infer<typeof evidenceKindSchema>;
const evidenceSchema = z.object({
  id: z.string(),
  source: evidenceSourceSchema,
  kind: evidenceKindSchema,
  solution: solutionSideSchema,
  title: z.string(),
  url: z.string(),
  excerpt: z.string(),
  retrievedAt: z.string(),
});
export type Evidence = z.infer<typeof evidenceSchema>;

const identitySchema = z.object({
  solution: solutionSideSchema,
  state: z.enum(["matched", "ambiguous", "missing"]),
  records: z.array(z.object({ name: z.string(), formula: z.string(), cid: z.number() })),
});
export type Identity = z.infer<typeof identitySchema>;

const gapCodeSchema = z.enum([
  "identity", "identifierUnverified", "concentration", "solvent", "state", "temperature", "quantity",
  "conditions", "hazards", "incompatibilities", "pubchemUnavailable", "nioshUnavailable", "nioshNoRecord",
]);
const evidenceGapSchema = z.object({ code: gapCodeSchema, solution: solutionSideSchema.optional() });
export type GapCode = z.infer<typeof gapCodeSchema>;
export type EvidenceGap = z.infer<typeof evidenceGapSchema>;

export const assessmentSchema = z.strictObject({
  hazardEvidenceIds: z.array(z.uuidv4()).max(12),
  pairConcernEvidenceIds: z.array(z.uuidv4()).max(8),
  uncertainty: z.array(z.enum([
    "substanceOnly",
    "indirectEvidence",
    "conflictingEvidence",
    "formulationUnknown",
    "pairEvidenceMissing",
  ])).max(5),
});
export type AgentAssessment = z.infer<typeof assessmentSchema>;

const preliminaryReportSchema = z.object({
  identities: z.array(identitySchema),
  gaps: z.array(evidenceGapSchema),
  assessment: assessmentSchema.nullable(),
});
export type PreliminaryReport = z.infer<typeof preliminaryReportSchema>;

export const reviewDecisions = ["Approved", "Rejected", "Needs More Information"] as const;
export type ReviewDecision = typeof reviewDecisions[number];
const text = z.string().trim().min(1).max(2500);
const source = z.strictObject({
  title: z.string().trim().min(1).max(250),
  url: z.url({ protocol: /^https$/ }).max(1500).refine((value) => {
    const url = new URL(value);
    return !url.username && !url.password;
  }),
});
const approvalSchema = z.strictObject({
  classification: finalResultSchema.shape.classification,
  conditions: text,
  hazards: z.array(text).max(12),
  incompatibilities: z.array(text).max(12),
  storage: text,
  container: text,
  limitations: z.array(text).min(1).max(12),
  evidenceIds: z.array(publicRequestIdSchema).max(20),
  externalSources: z.array(source).max(5),
  attestation: z.literal(true),
}).refine(({ evidenceIds, externalSources }) => evidenceIds.length + externalSources.length > 0);
export const reviewInputSchema = z.discriminatedUnion("decision", [
  z.strictObject({
    runId: publicRequestIdSchema,
    decision: z.literal("Approved"),
    notes: text,
    result: approvalSchema,
  }),
  z.strictObject({
    runId: publicRequestIdSchema,
    decision: z.enum(["Rejected", "Needs More Information"]),
    notes: text,
  }),
]);
export const retryInputSchema = z.strictObject({ runId: publicRequestIdSchema });

export const adminRequestDetailSchema = z.object({
  id: z.string(),
  status: publicRequestStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  input: publicInputSchema,
  images: z.array(z.object({ id: z.string(), solution: solutionSideSchema })),
  run: z.object({
    id: z.string(),
    status: agentStatusSchema,
    failureCode: z.string().nullable(),
    provider: z.string().nullable(),
    model: z.string().nullable(),
  }).nullable(),
  report: preliminaryReportSchema.nullable(),
  evidence: z.array(evidenceSchema),
  review: z.object({
    decision: z.enum(reviewDecisions), reviewerId: z.string(), notes: z.string(), createdAt: z.string(),
  }).nullable(),
  approvedResult: publicResultSchema.nullable(),
  history: z.array(z.object({
    id: z.number(), status: publicRequestStatusSchema, actor: z.string(), createdAt: z.string(),
  })),
  canRetry: z.boolean(),
});
export type AdminRequestDetail = z.infer<typeof adminRequestDetailSchema>;

export interface AdminRequestList {
  requests: {
    id: string;
    status: import("./domain").PublicRequestStatus;
    createdAt: string;
    nameA: string;
    nameB: string;
  }[];
  next: string | null;
}
