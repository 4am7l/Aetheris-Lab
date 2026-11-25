import type { RequestInput } from "../../src/domain";
import type { CalculationReport } from "../../src/calculation";
import { calculateDilution } from "./dilution";

const models = {
  "aqueous-dilution": calculateDilution,
} satisfies Record<NonNullable<RequestInput["calculation"]>["kind"],
  (input: RequestInput & { calculation: NonNullable<RequestInput["calculation"]> }) => CalculationReport>;

export function calculate(input: RequestInput): CalculationReport {
  const { calculation } = input;
  if (!calculation) return { status: "unsupported", reasons: [{ code: "noModel" }] };
  return models[calculation.kind]({ ...input, calculation });
}
