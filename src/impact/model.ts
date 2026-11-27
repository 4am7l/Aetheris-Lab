import { z } from "zod";

export const financialKinds = ["purchase", "replacement", "disposal", "handling", "treatment", "recovery"] as const;
export const carbonStages = ["manufacturing", "transportation", "treatment", "disposal"] as const;
export const activityKinds = ["preserved", "returned", "recovery", "segregation", "disposal", "abandoned", "no-action", "other"] as const;
export const impactStates = ["estimated", "action-reported", "pending-verification", "verified", "rejected", "corrected", "cancelled"] as const;
export const quantityUnits = ["uL", "mL", "L", "g", "kg"] as const;
export const formulaVersion = "baseline-actual/2";
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
export const scenarioPhases = ["baseline", "actual"] as const;
export function evidenceKey(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}
export const currencyPrecision = (currency: string) =>
  new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;

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
}).superRefine((input, ctx) => {
  if (input.financial.purchase && input.financial.replacement) {
    ctx.addIssue({ code: "custom", path: ["financial", "replacement"], message: "Use a single procurement category." });
  }
  for (const phase of scenarioPhases) {
    const evidence = new Set<string>();
    for (const kind of financialKinds) {
      const materials = new Set<string>();
      for (const line of input.financial[kind]?.[phase] ?? []) {
        const key = "amount" in line ? evidenceKey(line.evidence) : line.materialId;
        const seen = "amount" in line ? evidence : materials;
        if ("amount" in line ? line.amount === 0 : line.quantity.value === 0) continue;
        if (seen.has(key)) ctx.addIssue({ code: "custom", path: ["financial", kind, phase], message: "Each cost requires a distinct line reference or material allocation in this phase." });
        seen.add(key);
      }
    }
    for (const stage of carbonStages) {
      const lines = input.emissions[stage]?.[phase] ?? [];
      const materials = lines.filter((line) => "materialId" in line).map((line) => line.materialId);
      if (materials.length !== new Set(materials).size || (materials.length < lines.length && lines.length > 1)) {
        ctx.addIssue({ code: "custom", path: ["emissions", stage, phase], message: "Use one allocation per material or a single documented zero for this stage." });
      }
    }
  }
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
  side: z.enum(["A", "B"]).optional(),
  materialId: referenceId.optional(),
  documentation: z.string().trim().max(1600).optional(),
}).superRefine(({ kind, quantity, side, materialId, documentation }, ctx) => {
  if (["preserved", "returned", "recovery", "segregation", "disposal"].includes(kind) !== Boolean(quantity)) {
    ctx.addIssue({ code: "custom", path: ["quantity"], message: "Quantity is required for material movements only" });
  }
  if (materialId && !quantity) ctx.addIssue({ code: "custom", path: ["materialId"], message: "Select a material only for a quantified action" });
  if (side && !quantity) ctx.addIssue({ code: "custom", path: ["side"], message: "Select an input only for a quantified action" });
  if (kind === "other" && !documentation) ctx.addIssue({ code: "custom", path: ["documentation"], message: "Describe the action" });
});
export type Activity = z.infer<typeof activitySchema>;

export const activityList = z.array(activitySchema).min(1).max(8).superRefine((activities, ctx) => {
  const kinds = new Set(activities.map(({ kind }) => kind));
  const preserved = activities.find(({ kind }) => kind === "preserved");
  const returned = activities.find(({ kind }) => kind === "returned");
  if (kinds.size !== activities.length || (kinds.has("no-action") && kinds.size > 1) ||
      (preserved && returned && (!preserved.side || !returned.side || preserved.side === returned.side))) {
    ctx.addIssue({ code: "custom", message: "Report one entry per action. Assign preservation and return to separate assessed inputs." });
  }
});

const literUnits = { uL: 1e-6, mL: 0.001, L: 1 } as const;
const massUnits = { g: 0.001, kg: 1 } as const;
export const massUnit = (unit: Quantity["unit"]) => unit === "g" || unit === "kg";
const validDensity = (value: number | undefined): value is number => value !== undefined && Number.isFinite(value) && value > 0;
const finiteQuantity = (value: number) => Number.isFinite(value) && value >= 0 ? value : null;
export function liters(quantity: Quantity, density?: number) {
  switch (quantity.unit) {
    case "uL": case "mL": case "L": return finiteQuantity(quantity.value * literUnits[quantity.unit]);
    case "g": case "kg": return validDensity(density) ? finiteQuantity(quantity.value * massUnits[quantity.unit] / density) : null;
  }
}
export function kilograms(quantity: Quantity, density?: number) {
  switch (quantity.unit) {
    case "g": case "kg": return finiteQuantity(quantity.value * massUnits[quantity.unit]);
    default: return validDensity(density) ? finiteQuantity(quantity.value * literUnits[quantity.unit] * density) : null;
  }
}
export function unitsIn(quantity: Quantity, per: Quantity["unit"], density?: number) {
  if (per === "kg" || per === "g") {
    const mass = kilograms(quantity, density);
    return mass === null ? null : finiteQuantity(mass / massUnits[per]);
  }
  const volume = liters(quantity, density);
  return volume === null ? null : finiteQuantity(volume / literUnits[per]);
}

export type Reference = {
  id: string; materialId: string; verified: boolean; value: number; unit: Quantity["unit"];
  materialVerified: boolean; institutionId: string | null;
} & ({ type: "price"; kind: "purchase" | "disposal" | "combined"; currency: string; divisor: number;
  supplier: string | null; effectiveDate: string | null } |
  { type: "carbon"; stage: CarbonStage | null; geography: string | null; boundary: string | null; publicationDate?: string | null });

export interface Density {
  materialId: string; kgPerLiter: number;
  temperatureC?: number; state?: "Liquid" | "Solid";
}
export type Difference = { baseline: number | null; actual: number | null; difference: number | null };
export interface ImpactCalculation {
  formulaVersion: "baseline-actual/1" | typeof formulaVersion;
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
    if (!Number.isFinite(ref.value) || ref.value < 0 || (ref.type === "price" && !validDensity(ref.divisor))) return null;
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
  const boundaryStages = new Map<string, Set<CarbonStage>>();
  function carbonStage(stage: CarbonStage) {
    const scenario = input.emissions[stage];
    if (!scenario) return compare(null, null);
    const boundaries = new Set<string>();
    const value = (line: z.infer<typeof carbonLine>) => {
      if ("zero" in line) return 0;
      const ref = context.references.get(line.versionId);
      if (!ref || ref.type !== "carbon" || ref.stage !== stage || !ref.geography || !ref.boundary ||
          (ref.publicationDate && ref.publicationDate > context.date) ||
          !["global", evidenceKey(context.geography ?? "")].includes(evidenceKey(ref.geography))) return null;
      const result = rated(line, ref);
      if (result !== null && line.quantity.value > 0) {
        const boundary = evidenceKey(ref.boundary);
        boundaries.add(boundary);
        const owners = boundaryStages.get(boundary) ?? new Set<CarbonStage>();
        owners.add(stage);
        boundaryStages.set(boundary, owners);
      }
      return result;
    };
    const baseline = totalKnown(scenario.baseline.map(value));
    const actual = totalKnown(scenario.actual.map(value));
    return boundaries.size > 1 ? compare(null, null) : compare(baseline, actual);
  }
  const factor = 10 ** currencyPrecision(input.currency);
  function minorUnits(value: number | null) {
    if (value === null) return null;
    // Apply rounding once to the currency balance for this category and scenario.
    const minor = Math.round(Number((value * factor).toPrecision(15)));
    return Number.isSafeInteger(minor) ? minor : null;
  }
  function monetary(baseline: number | null, actual: number | null): Difference {
    const difference = baseline === null || actual === null ? null : baseline - actual;
    return { baseline: baseline === null ? null : baseline / factor, actual: actual === null ? null : actual / factor,
      difference: difference !== null && Number.isSafeInteger(difference) ? difference / factor : null };
  }
  const financialUnits = financialKinds.map((kind) => {
    const item = input.financial[kind];
    return { kind, baseline: item ? minorUnits(totalKnown(item.baseline.map((line) => financialValue(line, kind)))) : null,
      actual: item ? minorUnits(totalKnown(item.actual.map((line) => financialValue(line, kind)))) : null };
  });
  const financial = Object.fromEntries(financialUnits.map(({ kind, baseline, actual }) =>
    [kind, monetary(baseline, actual)])) as ImpactCalculation["financial"];
  const emissions = Object.fromEntries(carbonStages.map((stage) => [stage, carbonStage(stage)])) as ImpactCalculation["emissions"];
  for (const stages of boundaryStages.values()) {
    if (stages.size > 1) for (const stage of stages) emissions[stage] = compare(null, null);
  }
  // Purchase and replacement are views of the same procurement ledger. Include one per operation.
  const procurement = input.financial.replacement && !input.financial.purchase ? "replacement" : "purchase";
  const costs = financialUnits.filter(({ kind }) => kind !== (procurement === "purchase" ? "replacement" : "purchase"));
  const sumMoney = (side: typeof scenarioPhases[number]) => {
    const values = costs.map((row) => row[side]);
    if (values.some((value) => value === null)) return null;
    const sum = values.reduce<number>((result, next) => result + (next ?? 0), 0);
    return Number.isSafeInteger(sum) ? sum : null;
  };
  const net = input.financial.purchase && input.financial.replacement ? monetary(null, null) : monetary(sumMoney("baseline"), sumMoney("actual"));
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
