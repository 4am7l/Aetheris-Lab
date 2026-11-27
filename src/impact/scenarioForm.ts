import { field, numeric, optional } from "./formData";
import { carbonStages, financialKinds, scenarioSchema, type Scenario } from "./model";

export function readScenario(form: FormData): Scenario {
  function readLine(prefix: string, carbon: boolean) {
    const mode = field(form, prefix + ".mode");
    if (mode === "rate") return {
      materialId: field(form, prefix + ".material"), versionId: field(form, prefix + ".version"),
      quantity: { value: numeric(form, prefix + ".amount"), unit: field(form, prefix + ".unit") },
      densityVersionId: optional(form, prefix + ".density"), ...(carbon ? {} : { supplier: optional(form, prefix + ".supplier") }),
    };
    if (mode === "direct") return { ...(carbon ? { zero: true } : { amount: numeric(form, prefix + ".amount") }), evidence: field(form, prefix + ".evidence") };
    return undefined;
  }
  function groups(section: string, kinds: readonly string[]) {
    return Object.fromEntries(kinds.flatMap((kind) => {
      const [baseline, actual] = ["baseline", "actual"].map((phase) => Array.from({ length: 10 }, (_, i) =>
        readLine(section + "." + kind + "." + phase + "." + i, section === "emissions")).filter(Boolean));
      return baseline.length || actual.length ? [[kind, { baseline, actual }]] : [];
    }));
  }
  function quantity(name: string) {
    const value = numeric(form, "scenario." + name + ".amount");
    return value === undefined ? undefined : { value, unit: field(form, "scenario." + name + ".unit") };
  }
  return scenarioSchema.parse({
    currency: field(form, "scenario.currency").toUpperCase(), beneficiary: field(form, "scenario.beneficiary"),
    assumptions: field(form, "scenario.assumptions"), references: [{ title: field(form, "scenario.source"), url: optional(form, "scenario.url") }],
    financial: groups("financial", financialKinds), emissions: groups("emissions", carbonStages),
    wasteBaseline: quantity("wasteBaseline"), wasteActual: quantity("wasteActual"), preserve: quantity("preserve"),
  });
}
