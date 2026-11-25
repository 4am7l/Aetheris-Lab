import type { Calculation } from "../../src/chemistry";
import type { RequestInput } from "../../src/domain";
import { blocked, type CalculationInput, type CalculationModel } from "./model";
import { diluteSodiumChloride } from "./nacl";
import { normalizeSolution } from "./normalize";

const models: readonly CalculationModel[] = [diluteSodiumChloride];

export function calculate(request: RequestInput): Calculation {
  const solutions = [normalizeSolution(request.a, "A"), normalizeSolution(request.b, "B")] as const;
  const issues = solutions.flatMap((solution) => solution.issues);
  if (!request.calculationContext) issues.push({ kind: "missing", code: "calculationContext" });
  if (request.conditions.trim() || request.a.notes.trim() || request.b.notes.trim()) {
    issues.push({ kind: "unsupported", code: "unstructuredConditions" });
  }
  const input: CalculationInput = { solutions, context: request.calculationContext, issues };
  const model = models.find((candidate) => candidate.supports(input));
  return model ? model.evaluate(input) : blocked(issues);
}
