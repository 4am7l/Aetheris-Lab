import type { Calculation, CalculationContext, CalculationIssue } from "../../src/chemistry";
import type { NormalizedSolution } from "./normalize";

export interface CalculationInput {
  solutions: readonly [NormalizedSolution, NormalizedSolution];
  context?: CalculationContext;
  issues: CalculationIssue[];
}

export interface CalculationModel {
  supports(input: CalculationInput): boolean;
  evaluate(input: CalculationInput): Calculation;
}

export function blocked(issues: CalculationIssue[]): Calculation {
  return { status: issues.some(({ kind }) => kind === "unsupported") ? "unsupported" : "missing_input", issues };
}
