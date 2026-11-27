import { z } from "zod";

export const financialKinds = ["purchase", "replacement", "disposal", "handling", "treatment", "recovery"] as const;
export const carbonStages = ["manufacturing", "transportation", "treatment", "disposal"] as const;
export const activityKinds = ["preserved", "returned", "recovery", "segregation", "disposal", "abandoned", "no-action", "other"] as const;
export const impactStates = ["estimated", "action-reported", "pending-verification", "verified", "rejected", "corrected", "cancelled"] as const;
export const quantityUnits = ["uL", "mL", "L", "g", "kg"] as const;
export const formulaVersion = "baseline-actual/1";
export const referenceId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,95}$/);
export const eventKey = z.uuid();
export const currencyCode = z.string().regex(/^[A-Z]{3}$/);
const amount = z.number().min(0).max(1e9);
const note = z.string().trim().min(1).max(1000);
export const sourceTitle = z.string().trim().min(1).max(240);
export const httpsUrl = z.url({ protocol: /^https$/ }).max(1000);
export const quantitySchema = z.strictObject({ value: amount, unit: z.enum(quantityUnits) });

const pricedQuantity = z.strictObject({
  materialId: referenceId,
  quantity: quantitySchema,
  versionId: referenceId,
  densityVersionId: referenceId.optional(),
  supplier: z.string().trim().min(1).max(240).optional(),
});
const quotedCost = z.strictObject({
  amount, evidence: note,
});
const carbonZero = z.strictObject({ zero: z.literal(true), evidence: note });
const scenarios = <T extends z.ZodType>(item: T) => z.strictObject({
  baseline: z.array(item).min(1).max(10), actual: z.array(item).min(1).max(10),
});
const financialLine = z.union([pricedQuantity, quotedCost]);
const carbonLine = z.union([pricedQuantity.omit({ supplier: true }), carbonZero]);
export const scenarioSchema = z.strictObject({
  currency: currencyCode.default("JOD"),
  beneficiary: z.enum(["personal", "institution", "unassigned"]).default("unassigned"),
  financial: z.partialRecord(z.enum(financialKinds), scenarios(financialLine)).default({}),
  emissions: z.partialRecord(z.enum(carbonStages), scenarios(carbonLine)).default({}),
  assumptions: z.string().trim().min(5).max(3000),
  references: z.array(z.strictObject({ title: sourceTitle, url: httpsUrl.optional() })).min(1).max(16),
  wasteBaseline: quantitySchema.optional(),
  wasteActual: quantitySchema.optional(),
  preserve: quantitySchema.optional(),
});
export type Scenario = z.infer<typeof scenarioSchema>;
export type Quantity = z.infer<typeof quantitySchema>;
export type ActivityKind = typeof activityKinds[number];
export type ImpactState = typeof impactStates[number];
export type FinancialKind = typeof financialKinds[number];
export type CarbonStage = typeof carbonStages[number];

export const activitySchema = z.strictObject({
  kind: z.enum(activityKinds), date: z.iso.date(),
  quantity: quantitySchema.refine((q) => q.value > 0).optional(),
  materialId: referenceId.optional(),
  documentation: z.string().trim().max(1600).optional(),
}).superRefine(({ kind, quantity, materialId, documentation }, ctx) => {
  if (["preserved", "returned", "recovery", "segregation", "disposal"].includes(kind) !== Boolean(quantity)) {
    ctx.addIssue({ code: "custom", path: ["quantity"], message: "Quantity is required for material movements only" });
  }
  if (materialId && !quantity) ctx.addIssue({ code: "custom", path: ["materialId"], message: "Select a material only for a quantified action" });
  if (kind === "other" && !documentation) ctx.addIssue({ code: "custom", path: ["documentation"], message: "Describe the action" });
});
export type Activity = z.infer<typeof activitySchema>;

export const activityList = z.array(activitySchema).min(1).max(8).superRefine((activities, ctx) => {
  const kinds = new Set(activities.map(({ kind }) => kind));
  if (kinds.size !== activities.length || (kinds.has("no-action") && kinds.size > 1) ||
      (kinds.has("preserved") && kinds.has("returned"))) {
    ctx.addIssue({ code: "custom", message: "Report one entry per action. Returned stock already counts as preserved." });
  }
});

const literUnits = { uL: 1e-6, mL: 0.001, L: 1 } as const;
const massUnits = { g: 0.001, kg: 1 } as const;
export function liters(quantity: Quantity, density?: number) {
  switch (quantity.unit) {
    case "uL": case "mL": case "L": return quantity.value * literUnits[quantity.unit];
    case "g": case "kg": return density === undefined ? null : quantity.value * massUnits[quantity.unit] / density;
  }
}
export function kilograms(quantity: Quantity, density?: number) {
  switch (quantity.unit) {
    case "g": case "kg": return quantity.value * massUnits[quantity.unit];
    default: return density === undefined ? null : liters(quantity)! * density;
  }
}
function unitsIn(quantity: Quantity, per: Quantity["unit"], density?: number) {
  if (per === "kg" || per === "g") {
    const mass = kilograms(quantity, density);
    return mass === null ? null : mass / massUnits[per];
  }
  const volume = liters(quantity, density);
  return volume === null ? null : volume / literUnits[per];
}

export type Reference = {
  id: string; materialId: string; verified: boolean; value: number; unit: Quantity["unit"];
  materialVerified: boolean; institutionId: string | null;
} & ({ type: "price"; kind: "purchase" | "disposal" | "combined"; currency: string; divisor: number;
  supplier: string | null; effectiveDate: string | null } |
  { type: "carbon"; stage: CarbonStage | null; geography: string | null; boundary: string | null });

export interface Density {
  materialId: string; kgPerLiter: number;
}
export type Difference = { baseline: number | null; actual: number | null; difference: number | null };
export interface ImpactCalculation {
  formulaVersion: typeof formulaVersion;
  currency: string;
  beneficiary: Scenario["beneficiary"];
  financial: Record<FinancialKind, Difference>;
  emissions: Record<CarbonStage, Difference>;
  net: Difference;
  avoidedCo2e: Difference;
  wasteAvoided: Difference;
  wasteAvoidedKg: Difference;
  preserved: { liters: number | null; kilograms: number | null };
  assumptions: string;
  references: Scenario["references"];
}

function rounded(value: number) {
  return Number(value.toPrecision(14));
}

export function totalKnown(values: (number | null)[]) {
  if (!values.length || values.some((value) => value === null || !Number.isFinite(value))) return null;
  const sum = values.reduce<number>((acc, next) => acc + (next ?? 0), 0);
  return Number.isFinite(sum) ? rounded(sum) : null;
}

function compare(baseline: number | null, actual: number | null): Difference {
  return { baseline, actual, difference: baseline === null || actual === null ? null : rounded(baseline - actual) };
}

export function calculateImpact(input: Scenario, context: {
  references: ReadonlyMap<string, Reference>;
  densities: ReadonlyMap<string, Density>;
  institutionId: string | null;
  geography: string | null;
  date: string;
}): ImpactCalculation {
  type RateLine = z.infer<typeof pricedQuantity>;
  function rated(line: RateLine, ref: Reference) {
    if (!ref.verified || !ref.materialVerified || ref.materialId !== line.materialId ||
        (ref.institutionId !== null && ref.institutionId !== context.institutionId)) return null;
    const density = line.densityVersionId ? context.densities.get(line.densityVersionId) : undefined;
    if (line.densityVersionId && density?.materialId !== line.materialId) return null;
    const quantity = unitsIn(line.quantity, ref.unit, density?.kgPerLiter);
    const value = quantity === null ? null : quantity * (ref.type === "price" ? ref.value / ref.divisor : ref.value);
    return value !== null && Number.isFinite(value) ? rounded(value) : null;
  }
  function financialValue(line: z.infer<typeof financialLine>, kind: FinancialKind) {
    if ("amount" in line) return line.amount;
    const ref = context.references.get(line.versionId);
    if (!ref || ref.type !== "price" || ref.currency !== input.currency || !ref.effectiveDate ||
        ref.effectiveDate > context.date || ref.supplier !== (line.supplier ?? null)) return null;
    if ((kind === "purchase" || kind === "replacement") ? ref.kind !== "purchase" : (kind !== "disposal" || ref.kind !== "disposal")) return null;
    return rated(line, ref);
  }
  function carbonStage(stage: CarbonStage) {
    const scenario = input.emissions[stage];
    if (!scenario) return compare(null, null);
    const boundaries = new Set<string>();
    const value = (line: z.infer<typeof carbonLine>) => {
      if ("zero" in line) return 0;
      const ref = context.references.get(line.versionId);
      if (!ref || ref.type !== "carbon" || ref.stage !== stage || !ref.geography ||
          (ref.geography !== "global" && ref.geography !== context.geography) || !ref.boundary) return null;
      boundaries.add(ref.boundary);
      return rated(line, ref);
    };
    const baseline = totalKnown(scenario.baseline.map(value));
    const actual = totalKnown(scenario.actual.map(value));
    return boundaries.size > 1 ? compare(null, null) : compare(baseline, actual);
  }
  const financial = Object.fromEntries(financialKinds.map((kind) => {
    const item = input.financial[kind];
    return [kind, item ? compare(
      totalKnown(item.baseline.map((line) => financialValue(line, kind))),
      totalKnown(item.actual.map((line) => financialValue(line, kind))),
    ) : compare(null, null)];
  })) as ImpactCalculation["financial"];
  const emissions = Object.fromEntries(carbonStages.map((stage) => [stage, carbonStage(stage)])) as ImpactCalculation["emissions"];
  // Purchase and replacement are views of the same procurement ledger. Include one per operation.
  const procurement = input.financial.replacement && !input.financial.purchase ? "replacement" : "purchase";
  const costs = [financial[procurement], financial.disposal, financial.handling, financial.treatment, financial.recovery];
  const net = input.financial.purchase && input.financial.replacement ? compare(null, null) :
    compare(totalKnown(costs.map((item) => item.baseline)), totalKnown(costs.map((item) => item.actual)));
  const stages = Object.values(emissions);
  return {
    formulaVersion, currency: input.currency, beneficiary: input.beneficiary, financial, emissions, net,
    avoidedCo2e: compare(totalKnown(stages.map((item) => item.baseline)), totalKnown(stages.map((item) => item.actual))),
    wasteAvoided: compare(input.wasteBaseline ? liters(input.wasteBaseline) : null, input.wasteActual ? liters(input.wasteActual) : null),
    wasteAvoidedKg: compare(input.wasteBaseline ? kilograms(input.wasteBaseline) : null, input.wasteActual ? kilograms(input.wasteActual) : null),
    preserved: { liters: input.preserve ? liters(input.preserve) : null, kilograms: input.preserve ? kilograms(input.preserve) : null },
    assumptions: input.assumptions, references: input.references,
  };
}
