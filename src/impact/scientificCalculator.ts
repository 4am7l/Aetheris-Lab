import elements from "./elements.json";
import { soluteConcentration } from "../calculation";
import { kilograms, liters, quantitySchema, type Quantity } from "./model";

const weights = new Map(elements.filter((element) => !element.isotope).map(({ symbol, weight }) => [symbol, Number(weight)]));
export const periodicSource = "https://pubchem.ncbi.nlm.nih.gov/periodic-table/";
export const concentrationSource = "https://openstax.org/books/chemistry-2e/pages/3-3-molarity";

export function formulaMass(formula: string): number | null {
  const input = formula.normalize("NFKC").trim();
  if (!input || input.length > 120) return null;
  const tokens = input.match(/[A-Z][a-z]?|[0-9]+|[()[\]]/g) ?? [];
  if (tokens.join("") !== input) return null;
  let index = 0;
  function count() {
    if (!/^\d+$/.test(tokens[index] ?? "")) return 1;
    const value = Number(tokens[index++]);
    return Number.isSafeInteger(value) && value > 0 && value <= 1000 ? value : NaN;
  }
  function parse(expected: string, depth: number): number {
    if (depth > 6) return NaN;
    let sum = 0;
    while (index < tokens.length) {
      const token = tokens[index++];
      if (token === expected) return sum || NaN;
      if (token === "(" || token === "[") sum += parse(token === "(" ? ")" : "]", depth + 1) * count();
      else {
        const atomic = weights.get(token);
        if (atomic === undefined) return NaN;
        sum += atomic * count();
      }
    }
    return expected ? NaN : sum;
  }
  const result = parse("", 0);
  return Number.isFinite(result) && result > 0 ? result : null;
}
export type ScientificMode = "mass" | "molarity" | "molality" | "dilution" | "mass-concentration" | "percent-mass" |
  "percent-volume" | "percent-mass-volume" | "conversion" | "balance";
export interface ScientificInputs { formula?: string; first?: number; second?: number; third?: number; fourth?: number; final?: number; unit?: string }
export function scientific(mode: ScientificMode, input: ScientificInputs): { value: number; unit: string } | null {
  const { first, second, third, fourth, final } = input;
  const valid = (value?: number): value is number => value !== undefined && Number.isFinite(value) && value >= 0 && value <= 1e9;
  const positive = (value?: number): value is number => valid(value) && value > 0;
  const value = (v: number | null, unit: string) => v !== null && Number.isFinite(v) && v >= 0 ? { value: v, unit } : null;
  if (mode === "mass") return value(formulaMass(input.formula ?? ""), "g/mol");
  if (mode === "conversion") {
    const amount = quantitySchema.safeParse({ value: first, unit: input.unit });
    if (!amount.success) return null;
    const q: Quantity = amount.data;
    const volume = liters(q);
    return volume === null ? value(kilograms(q), "kg") : value(volume, "L");
  }
  if (mode === "balance") {
    if (!valid(first) || !valid(second) || !valid(third) || !valid(fourth) || !positive(final) || second + fourth <= 0) return null;
    return value((first * second + third * fourth) / final, "mol/L");
  }
  if (!valid(first) || !positive(second)) return null;
  if (mode === "dilution") {
    return positive(third) && third >= second ? value(soluteConcentration(first, second, third), "mol/L") : null;
  }
  if (mode === "molarity") return value(first / second, "mol/L");
  if (mode === "molality") return value(first / second, "mol/kg");
  if (mode === "mass-concentration") return value(first / second, "g/L");
  if (mode !== "percent-mass-volume" && first > second) return null;
  return value(100 * first / second, mode === "percent-mass" ? "% w/w" : mode === "percent-volume" ? "% v/v" : "% w/v");
}
