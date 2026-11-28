import type { PublicRequestStatus, PublicResult } from "../domain";
import type { Activity, ActivityKind, ImpactCalculation, ImpactState, Quantity } from "./model";

export interface CatalogChemical {
  id: string; nameAr: string; nameEn: string; cas: string | null; formula: string | null; cid: number | null;
  concentration: string | null; purity: string | null; solvent: string | null; formulation: string | null;
  state: string | null; category: string | null; hazards: string | null; wasteCategory: string | null;
  status: "verified" | "unverified"; updatedAt: string; provenance: string;
  institutionId: string | null; labId: string | null;
}

export interface ImpactEvent {
  id: number; state: ImpactState; createdAt: string;
  activities: Activity[]; calculation: ImpactCalculation | null; reason: string | null;
  reviewRequired: boolean;
}

export interface FixedGuideEstimate {
  side: "A" | "B";
  materialId: string; nameAr: string; nameEn: string; cas: string; concentration: string;
  formulation: string | null; solvent: string | null;
  sourcePrice: string; sourcePriceUnit: string; currency: "JOD";
  sourceFactor: string; sourceFactorUnit: string; denominator: "L";
  sourceHash: string; document: string; page: number; rowNumber: number;
  decisionId: number; reviewedMatch: boolean | null;
  status: "applied" | "needs-review" | "not-applicable" | "volume-unavailable";
  assessedVolume: number | null;
  inputEstimate: { volume: number; combinedCost: number; co2e: number } | null;
  actionEstimate: { volume: number; combinedCost: number; co2e: number } | null;
  canReviewMatch: boolean;
}

export interface OperationImpact {
  writable: boolean;
  assessed: { liters: number | null; kilograms: number | null; knownQuantities: number; totalQuantities: number };
  evidence: { identifiedSides: number; citedSources: number; conditionsDocumented: boolean; uncertaintyDocumented: boolean; coveredFinancialCategories: number; coveredCarbonStages: number };
  findings: string[];
  classification: PublicResult["classification"];
  reviewedWaste: PublicResult["wasteAssessment"];
  estimate: ImpactCalculation | null;
  estimateReviewRequired: boolean;
  current: ImpactEvent | null;
  events: ImpactEvent[];
  sourceReferences: PublicResult["sources"];
  fixedGuide: FixedGuideEstimate[];
}

export interface Organization {
  id: string; nameEn: string; nameAr: string; geography: string;
}
export interface Department {
  id: string; nameEn: string; nameAr: string; institutionId: string;
}
export interface Laboratory extends Department { departmentId: string }
export interface OrganizationDirectory {
  institutions: Organization[]; departments: Department[]; labs: Laboratory[];
}
export interface WorkspaceIdentity {
  actor: string; institutionId: string; labId: string | null;
  role: "institution-admin" | "reviewer" | "lab-manager" | "viewer";
}

export interface ImpactMetric { value: number | null; covered: number }
export const receiptStatisticsBatchSize = 100;
export interface AssessmentImpactValues {
  estimate: number | null; realized: number | null;
  estimatedWaste: number | null; estimatedWasteKg: number | null;
  waste: number | null; wasteKg: number | null;
  carbon: number | null; verifiedCarbon: number | null;
}
export interface AssessmentImpact extends AssessmentImpactValues {
  id: string; date: string; completedAt: string | null; status: PublicRequestStatus; names: string[];
}
export interface AssessmentStatistics extends AssessmentImpact {
  assessed: OperationImpact["assessed"];
  fixedGuide: FixedGuideEstimate[];
}
export interface ImpactTotals {
  assessments: number; approved: number; completed: number; reported: number; verified: number; pending: number;
  prevention: number; incompatibilities: number; needsRecheck: number; confirmedActions: number;
  estimatedFinancial: ImpactMetric; verifiedFinancial: ImpactMetric; purchase: ImpactMetric; replacement: ImpactMetric; disposal: ImpactMetric;
  estimatedAvoided: ImpactMetric; estimatedAvoidedKg: ImpactMetric;
  assessed: ImpactMetric; preserved: ImpactMetric; preservedKg: ImpactMetric; avoided: ImpactMetric; avoidedKg: ImpactMetric;
  segregated: ImpactMetric; segregatedKg: ImpactMetric; recovery: ImpactMetric; recoveryKg: ImpactMetric;
  authorizedDisposal: ImpactMetric; authorizedDisposalKg: ImpactMetric; carbon: ImpactMetric; verifiedCarbon: ImpactMetric;
}
export interface ImpactBucket extends ImpactTotals { period: string }
export interface ImpactLog extends AssessmentImpact {
  state: ImpactState | null; actions: ActivityKind[]; labId: string | null; labName: string | null;
  reviewRequired: boolean; findings: string[];
}
export interface ImpactOverview {
  totals: ImpactTotals;
  series: ImpactBucket[];
  actions: { label: string; count: number }[];
  chemicals: { label: string; count: number; liters: number | null }[];
  categories: { label: string; count: number }[];
  incompatibilities: { label: string; count: number }[];
  laboratories: { label: string; count: number; value: number | null }[];
  references: { title: string; url: string | null }[];
  log: ImpactLog[];
  next: string | null;
  currency: string;
}
export interface InventoryItem {
  id: string; labId: string; chemicalId: string; name: string; container: string; batch: string | null;
  quantity: number; unit: Quantity["unit"]; location: string;
  bought: string | null; reviewBy: string | null; priceId: string | null; updatedAt: string;
}
