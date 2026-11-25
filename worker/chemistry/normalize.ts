import type { CalculationIssue } from "../../src/chemistry";
import { unknown, type Solution } from "../../src/domain";

export const sodiumChloride = { formula: "NaCl", cas: "7647-14-5", molarMassGramPerMol: 58.443 };

export interface NormalizedSolution {
  side: "A" | "B";
  identity: "NaCl" | null;
  concentrationMolL: number | null;
  volumeL: number | null;
  temperatureC: number | null;
  solvent: "water" | null;
  state: Solution["state"];
  issues: CalculationIssue[];
}

function cleaned(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

export function normalizeSolution(solution: Solution, side: "A" | "B"): NormalizedSolution {
  const issues: CalculationIssue[] = [];
  const name = cleaned(solution.name);
  const formula = cleaned(solution.formula);
  const cas = solution.cas;
  const identityMissing = [name, formula, cas].every((value) => value === unknown);
  const identityMatches = !identityMissing
    && (name === unknown || ["sodium chloride", "كلوريد الصوديوم"].includes(name.toLowerCase())
      || name === sodiumChloride.cas || name === sodiumChloride.formula || name === "ClNa")
    && (formula === unknown || formula === sodiumChloride.formula || formula === "ClNa")
    && (cas === unknown || cas === sodiumChloride.cas);
  if (identityMissing) issues.push({ kind: "missing", code: "identity", side });
  else if (!identityMatches) issues.push({ kind: "unsupported", code: "identityUnresolved", side });

  const solventName = cleaned(solution.solvent).toLowerCase();
  const solvent = ["water", "h2o", "distilled water", "deionized water", "ماء", "ماء مقطر", "ماء منزوع الأيونات"].includes(solventName) ? "water" : null;
  if (solution.solvent === unknown) issues.push({ kind: "missing", code: "solvent", side });
  else if (!solvent) issues.push({ kind: "unsupported", code: "solvent", side });

  if (solution.state === unknown) issues.push({ kind: "missing", code: "state", side });
  else if (solution.state !== "Liquid") issues.push({ kind: "unsupported", code: "state", side });

  const temperatureC = solution.temperature === unknown ? null : Number(solution.temperature);
  if (temperatureC === null) issues.push({ kind: "missing", code: "temperature", side });

  let concentrationMolL: number | null = null;
  if (solution.concentration === unknown) issues.push({ kind: "missing", code: "concentration", side });
  if (solution.unit === unknown) {
    if (solution.concentration !== unknown) issues.push({ kind: "missing", code: "concentrationUnit", side });
  } else if (solution.unit !== "mol/L" && solution.unit !== "g/L") {
    issues.push({ kind: "unsupported", code: "concentrationUnit", side });
  } else if (solution.concentration !== unknown && (solution.unit === "mol/L" || identityMatches)) {
    concentrationMolL = Number(solution.concentration) / (solution.unit === "g/L" ? sodiumChloride.molarMassGramPerMol : 1);
    if (concentrationMolL === 0 && /[1-9]/.test(solution.concentration.split(/[eE]/, 1)[0])) {
      issues.push({ kind: "unsupported", code: "concentrationRange", side });
    }
  }

  let volumeL: number | null = null;
  if (solution.quantity === unknown) issues.push({ kind: "missing", code: "quantity", side });
  if (solution.quantityUnit === unknown) {
    if (solution.quantity !== unknown) issues.push({ kind: "missing", code: "quantityUnit", side });
  } else if (solution.quantityUnit !== "L" && solution.quantityUnit !== "mL") {
    issues.push({ kind: "unsupported", code: "quantityUnit", side });
  } else if (solution.quantity !== unknown) {
    volumeL = Number(solution.quantity) / (solution.quantityUnit === "mL" ? 1000 : 1);
  }

  return {
    side, identity: identityMatches ? "NaCl" : null, concentrationMolL, volumeL, temperatureC,
    solvent, state: solution.state, issues,
  };
}
