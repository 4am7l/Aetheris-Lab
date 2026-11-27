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
}

export interface OperationImpact {
  assessed: { liters: number | null; kilograms: number | null; knownQuantities: number; totalQuantities: number };
  evidence: { identifiedSides: number; citedSources: number; conditionsDocumented: boolean; uncertaintyDocumented: boolean; coveredFinancialCategories: number; coveredCarbonStages: number };
  findings: string[];
  classification: PublicResult["classification"];
  reviewedWaste: PublicResult["wasteAssessment"];
  estimate: ImpactCalculation | null;
  current: ImpactEvent | null;
  events: ImpactEvent[];
  sourceReferences: PublicResult["sources"];
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
export interface ImpactTotals {
  assessments: number; approved: number; completed: number; reported: number; verified: number; pending: number;
  prevention: number; incompatibilities: number;
  estimatedFinancial: ImpactMetric; verifiedFinancial: ImpactMetric; purchase: ImpactMetric; disposal: ImpactMetric;
  assessed: ImpactMetric; preserved: ImpactMetric; preservedKg: ImpactMetric; avoided: ImpactMetric; avoidedKg: ImpactMetric;
  segregated: ImpactMetric; segregatedKg: ImpactMetric; recovery: ImpactMetric; recoveryKg: ImpactMetric;
  authorizedDisposal: ImpactMetric; authorizedDisposalKg: ImpactMetric; carbon: ImpactMetric; verifiedCarbon: ImpactMetric;
}
export interface ImpactBucket extends ImpactTotals { period: string }
export interface ImpactLog {
  id: string; date: string; completedAt: string | null; status: PublicRequestStatus; names: string[];
  state: ImpactState | null; actions: ActivityKind[]; labId: string | null; labName: string | null;
  estimate: number | null; realized: number | null; waste: number | null; carbon: number | null; findings: string[];
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
