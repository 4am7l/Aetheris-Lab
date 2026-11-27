import type { D1Database } from "@cloudflare/workers-types";
import { requestInputSchema, solventName, unknown, type Solution } from "../../src/domain";
import { carbonStages, evidenceKey, financialKinds, kilograms, liters, massUnit, quantitySchema, scenarioPhases, unitsIn,
  type Activity, type Density, type ImpactCalculation, type Quantity, type Reference, type Scenario } from "../../src/impact/model";

type Side = "A" | "B";
export type Stocks = Record<Side, { input: Solution; measure: Quantity | null }>;
export interface Formulation {
  cas: string | null;
  formula: string | null;
  concentration: string | null;
  purity: string | null;
  solvent: string | null;
  physicalState: string | null;
  materialVerified: boolean;
}
type Target = { institutionId: string | null; labId: string | null };
type ScopedReference = Reference & Formulation;
type RateLine = { materialId: string; versionId: string; quantity: Quantity; densityVersionId?: string };
type Allocation = { unit: "L" | "kg"; value: number; side?: Side };
const sides = ["A", "B"] as const;

export function assessedStocks(json: string): Stocks {
  const input = requestInputSchema.parse(JSON.parse(json));
  function stock(solution: Solution) {
    const measure = quantitySchema.safeParse({ value: Number(solution.quantity), unit: solution.quantityUnit });
    return { input: solution, measure: measure.success ? measure.data : null };
  }
  return { A: stock(input.a), B: stock(input.b) };
}

function formulaKey(value: string) {
  const normalized = value.normalize("NFKC").trim();
  if (!/^(?:[A-Z][a-z]?\d*){1,40}$/.test(normalized)) return normalized;
  const counts = new Map<string, number>();
  for (const [, atom, count] of normalized.matchAll(/([A-Z][a-z]?)(\d*)/g)) {
    counts.set(atom, (counts.get(atom) ?? 0) + (count ? Number(count) : 1));
  }
  return JSON.stringify([...counts].sort(([a], [b]) => a.localeCompare(b)));
}

const solventKey = (name: string) => {
  const key = evidenceKey(name);
  return ["water", "h2o", "aqueous", "ماء", "الماء", "مائي"].includes(key) ? "water" : key;
};
function concentrationKey(text: string) {
  const match = /^([+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(mol\s*\/\s*l|m|g\s*\/\s*l|%\s*[wv]\s*\/\s*[wv])$/i.exec(text.normalize("NFKC").trim());
  if (!match || match[2] === "m" || !Number.isFinite(Number(match[1]))) return null;
  const unit = match[2].toLowerCase().replace(/\s+/g, "");
  return Number(match[1]) + " " + (unit === "m" ? "mol/l" : unit);
}
function purityValue(text: string | null | undefined) {
  const expression = text?.normalize("NFKC").trim().replace(/\s*%$/, "");
  return expression && /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(expression) && Number(expression) <= 100 ? Number(expression) : null;
}

export function matchesFormulation(input: Solution, material: Formulation) {
  if (!material.materialVerified || input.cas === unknown || input.cas !== material.cas || input.solvent === unknown ||
      !material.solvent || solventKey(solventName(input)) !== solventKey(material.solvent)) return false;
  if (input.formula !== unknown && material.formula && formulaKey(input.formula) !== formulaKey(material.formula)) return false;
  if (material.physicalState && evidenceKey(material.physicalState) !== evidenceKey(input.state)) return false;
  const inputStrength = input.concentration === unknown ? null : concentrationKey(input.concentration + " " + input.unit);
  const referenceStrength = material.concentration ? concentrationKey(material.concentration) : null;
  if (inputStrength !== referenceStrength || (material.concentration && !referenceStrength)) return false;
  const inputPurity = purityValue(input.purity);
  const referencePurity = purityValue(material.purity);
  if (inputPurity !== referencePurity || (material.purity && referencePurity === null)) return false;
  return inputStrength !== null || inputPurity !== null;
}

export async function activityFormulations(db: D1Database, activities: Activity[], { institutionId, labId }: Target) {
  const ids = [...new Set(activities.flatMap(({ materialId }) => materialId ? [materialId] : []))];
  if (!ids.length) return new Map<string, Formulation>();
  const { results } = await db.prepare(`SELECT id, cas, formula, concentration, purity, solvent, physical_state AS physicalState, status = 'verified' AS materialVerified
    FROM chemical_references WHERE id IN (${ids.map(() => "?").join(",")}) AND
    (institution_id IS NULL OR (institution_id = ? AND (lab_id IS NULL OR lab_id = ?)))`)
    .bind(...ids, institutionId, labId).all<Formulation & { id: string }>();
  return new Map(results.map((row) => [row.id, row]));
}

function allocate(stocks: Stocks, quantity: Quantity, eligible: readonly Side[], density?: Density): Allocation | null {
  const nativeUnit = massUnit(quantity.unit) ? "kg" : "L";
  const known = eligible.filter((side) => stocks[side].measure !== null);
  const sameDimension = known.filter((side) => massUnit(stocks[side].measure!.unit) === massUnit(quantity.unit));
  const candidates = sameDimension.length ? sameDimension : known;
  if (!candidates.length || (!sameDimension.length && !density)) return null;
  const unit = sameDimension.length ? nativeUnit : nativeUnit === "kg" ? "L" : "kg";
  const value = unitsIn(quantity, unit, density?.kgPerLiter);
  return value === null ? null : { unit, value, side: candidates.length === 1 ? candidates[0] : undefined };
}

function fits(value: number, maximum: number) {
  return value <= maximum || Math.abs(value - maximum) <= Number.EPSILON * Math.max(value, maximum) * 16;
}

function withinStock(stocks: Stocks, allocations: readonly Allocation[]) {
  for (const unit of ["L", "kg"] as const) {
    const applied = allocations.filter((allocation) => allocation.unit === unit);
    for (const side of sides) {
      const quantity = stocks[side].measure;
      const capacity = quantity ? unitsIn(quantity, unit) ?? 0 : 0;
      if (!fits(applied.filter((item) => item.side === side).reduce((sum, item) => sum + item.value, 0), capacity)) return false;
    }
    const all = applied.reduce((sum, item) => sum + item.value, 0);
    const capacity = sides.reduce((sum, side) => {
      const quantity = stocks[side].measure;
      return sum + (quantity ? unitsIn(quantity, unit) ?? 0 : 0);
    }, 0);
    if (!fits(all, capacity)) return false;
  }
  return true;
}

export function validateActivities(stocks: Stocks, activities: Activity[], materials: ReadonlyMap<string, Formulation>) {
  const terminal: Allocation[] = [];
  for (const item of activities) {
    if (!item.quantity) continue;
    let eligible = item.side ? sides.filter((side) => side === item.side) : [...sides];
    if (item.materialId) {
      const material = materials.get(item.materialId);
      if (!material || !item.side) return "ACTIVITY_FORMULATION_REQUIRED";
      eligible = eligible.filter((side) => matchesFormulation(stocks[side].input, material));
      if (!eligible.length) return "ACTIVITY_FORMULATION_MISMATCH";
    }
    const allocation = allocate(stocks, item.quantity, eligible);
    if (!allocation || !withinStock(stocks, [allocation])) return "ACTIVITY_QUANTITY_UNSUPPORTED";
    // Segregation can describe the same waste later recovered or disposed. It is tracked independently.
    if (item.kind !== "segregation") terminal.push(allocation);
  }
  return withinStock(stocks, terminal) ? null : "ACTIVITY_QUANTITY_OVERLAP";
}

function ratedAllocation(stocks: Stocks, line: RateLine, refs: ReadonlyMap<string, ScopedReference>,
  densities: ReadonlyMap<string, Density>, kind: "price" | "carbon") {
  const reference = refs.get(line.versionId);
  if (!reference || reference.type !== kind || !reference.verified) return undefined;
  if (reference.materialId !== line.materialId) return null;
  const density = line.densityVersionId ? densities.get(line.densityVersionId) : undefined;
  if (line.densityVersionId && density?.materialId !== line.materialId) return null;
  const compatible = sides.filter((side) => {
    const { input, measure } = stocks[side];
    if (!matchesFormulation(input, reference) || !measure) return false;
    if (massUnit(line.quantity.unit) === massUnit(measure.unit) && massUnit(line.quantity.unit) === massUnit(reference.unit)) return true;
    return density && input.state === density.state && input.temperature !== unknown
      && Number(input.temperature) === density.temperatureC;
  });
  return allocate(stocks, line.quantity, compatible, density);
}

const preservationKinds = ["preserved", "returned"];
const procurementKinds = [...preservationKinds, "recovery"];

function documentedCapacity(activities: Activity[], allocation: Allocation, kinds: string[], materialId: string) {
  return activities.filter((action) => kinds.includes(action.kind) && (!action.materialId || action.materialId === materialId) &&
    (!allocation.side || !action.side || action.side === allocation.side)).reduce((sum, action) => {
    const value = action.quantity ? unitsIn(action.quantity, allocation.unit) : null;
    return sum + (value ?? 0);
  }, 0);
}

export function validateScenario(
  stocks: Stocks,
  input: Scenario,
  refs: ReadonlyMap<string, ScopedReference>,
  densities: ReadonlyMap<string, Density>,
  result: ImpactCalculation,
  activities?: Activity[],
) {
  const measures = [input.wasteBaseline, input.wasteActual, input.preserve].filter((q) => q !== undefined);
  if (input.wasteBaseline && input.wasteActual &&
      massUnit(input.wasteBaseline.unit) !== massUnit(input.wasteActual.unit)) return "SCENARIO_WASTE_UNITS";
  for (const quantity of measures) {
    const allocation = allocate(stocks, quantity, sides);
    if (!allocation || !withinStock(stocks, [allocation])) return "SCENARIO_QUANTITY_UNSUPPORTED";
  }
  const groups = [
    ...financialKinds.map((kind) => ({ kind, type: "price" as const, item: input.financial[kind], difference: result.financial[kind].difference })),
    ...carbonStages.map((kind) => ({ kind, type: "carbon" as const, item: input.emissions[kind], difference: result.emissions[kind].difference })),
  ];
  for (const { item, type, kind, difference } of groups) {
    if (!item) continue;
    if (activities && difference === null) return "SCENARIO_EVIDENCE_UNAVAILABLE";
    const modeled = { baseline: new Map<string, Allocation>(), actual: new Map<string, Allocation>() };
    for (const phase of scenarioPhases) {
      const amounts = modeled[phase];
      for (const line of item[phase]) {
        if (!("materialId" in line) || line.quantity.value === 0) continue;
        const allocation = ratedAllocation(stocks, line, refs, densities, type);
        if (allocation === null) return "SCENARIO_FORMULATION_OR_QUANTITY";
        if (allocation) amounts.set(line.materialId, allocation);
      }
      if (!withinStock(stocks, [...amounts.values()])) return "SCENARIO_QUANTITY_UNSUPPORTED";
    }
    if (!activities || difference === null || difference <= 0) continue;
    const isProcurement = kind === "purchase" || kind === "replacement" || kind === "manufacturing";
    const eligible = isProcurement ? procurementKinds : [...procurementKinds, "segregation", "disposal", "other"];
    if (!activities.some((action) => eligible.includes(action.kind))) return "SCENARIO_ACTION_MISMATCH";
    for (const [materialId, allocation] of modeled.baseline) {
      const actual = modeled.actual.get(materialId);
      if (actual && actual.unit !== allocation.unit) return "SCENARIO_QUANTITY_UNSUPPORTED";
      const avoided = allocation.value - (actual?.value ?? 0);
      // A segregation entry can overlap a terminal action, so use its own capacity.
      const terminal = documentedCapacity(activities, allocation, eligible.filter((key) => key !== "segregation"), materialId);
      const segregation = isProcurement ? 0 : documentedCapacity(activities, allocation, ["segregation"], materialId);
      if (avoided > 0 && !fits(avoided, Math.max(terminal, segregation))) return "SCENARIO_ACTION_QUANTITY";
    }
  }
  if (activities) {
    for (const [unit, waste] of [["L", result.wasteAvoided], ["kg", result.wasteAvoidedKg]] as const) {
      const avoided = waste.difference;
      if (avoided === null || avoided <= 0) continue;
      const preserved = activities.filter(({ kind }) => preservationKinds.includes(kind)).reduce((sum, action) =>
        sum + (action.quantity ? unitsIn(action.quantity, unit) ?? 0 : 0), 0);
      if (!fits(avoided, preserved)) return "WASTE_PREVENTION_EXCEEDS_PRESERVATION";
    }
  }
  return null;
}

function physicalTotals(measures: Quantity[]) {
  function sum(convert: (quantity: Quantity) => number | null) {
    const values = measures.map((quantity) => convert(quantity)).filter((value) => value !== null);
    return values.length ? values.reduce((total, value) => total + value, 0) : null;
  }
  return { liters: sum(liters), kilograms: sum(kilograms) };
}

export function assessedTotals(stocks: Stocks) {
  const measures = sides.flatMap((side) => stocks[side].measure ?? []);
  return { ...physicalTotals(measures), knownQuantities: measures.length, totalQuantities: sides.length };
}

export function preservationTotals(activities: Activity[]) {
  return physicalTotals(activities.flatMap(({ kind, quantity }) => quantity && preservationKinds.includes(kind) ? [quantity] : []));
}
