import { describe, expect, it } from "vitest";
import { publicInputSchema } from "./domain";
import { calculate } from "../worker/chemistry";
import benchmark from "../tests/fixtures/methanol-dilution.json";

describe("aqueous methanol dilution", () => {
  it("reproduces the published OpenStax Chemistry 2e §3.3 answer after Example 3.19", () => {
    const report = calculate(publicInputSchema.parse(benchmark));
    expect(report).toMatchObject({
      status: "calculated",
      model: { id: "aqueous-methanol-dilution", version: 1 },
      inputs: {
        soluteCid: 887, solventCid: 962, stockMolPerL: 2.04,
        stockVolumeL: 0.025, finalVolumeL: 0.5, temperatureK: 298.15,
      },
      result: { measurementUncertainty: "unavailable" },
      references: [expect.objectContaining({ locator: expect.stringContaining("Example 3.19") }),
        expect.objectContaining({ url: expect.stringContaining("/887") }),
        expect.objectContaining({ url: expect.stringContaining("/962") })],
    });
    if (report.status !== "calculated") throw new Error("Published benchmark was declined");
    expect(Math.abs(report.result.analyticalMolPerL - 0.102)).toBeLessThan(1e-14);
    expect(Object.keys(report.result)).toEqual(["analyticalMolPerL", "measurementUncertainty"]);
  });

  it("matches an independent exact rational inventory benchmark in mixed units", () => {
    const report = calculate(publicInputSchema.parse({
      ...benchmark,
      a: { ...benchmark.a, name: "methyl alcohol", formula: "CH₃OH", concentration: "1.25",
        quantity: "0.080", quantityUnit: "L" },
      b: { ...benchmark.b, name: "Deionized water", quantity: "0.6", quantityUnit: "kg" },
      calculation: { ...benchmark.calculation, finalVolume: { value: "640", unit: "mL" } },
    }));
    if (report.status !== "calculated") throw new Error("Rational benchmark was declined");
    // 1/10 mol at 16/25 L yields 5/32 mol/L (exactly representable in binary).
    expect(report.result.analyticalMolPerL).toBe(0.15625);
  });

  it("keeps legacy submissions valid and reports missing measurements without numbers", () => {
    const { calculation, ...legacy } = benchmark;
    expect(calculate(publicInputSchema.parse(legacy))).toEqual({
      status: "unsupported", reasons: [{ code: "noModel" }],
    });
    expect(calculate(publicInputSchema.parse({
      ...legacy, a: { ...legacy.a, temperature: "Unknown", quantity: "Unknown" },
      calculation: { kind: calculation.kind, assumptionsConfirmed: true },
    }))).toEqual({
      status: "needs-information",
      reasons: [{ code: "temperatureMissing", side: "A" },
        { code: "stockVolumeMissing", side: "A" }, { code: "finalVolumeMissing" }],
    });
  });

  it.each([
    [{ name: "Ethanol" }, {}, {}, "identityUnsupported"],
    [{ cas: "64-17-5" }, {}, {}, "identityUnsupported"],
    [{ formula: "C2H6O" }, {}, {}, "identityUnsupported"],
    [{}, { name: "Brine" }, {}, "identityUnsupported"],
    [{ solvent: "Ethanol" }, {}, {}, "solventUnsupported"],
    [{ state: "Gas" }, {}, {}, "stateUnsupported"],
    [{}, { temperature: "26" }, {}, "temperatureUnsupported"],
    [{ unit: "g/L" }, {}, {}, "stockConcentrationUnsupported"],
    [{ concentration: "3.01" }, {}, {}, "stockConcentrationUnsupported"],
    [{ quantityUnit: "g" }, {}, {}, "stockVolumeUnsupported"],
    [{}, {}, { finalVolume: { value: "0.025", unit: "L" } }, "finalVolumeUnsupported"],
    [{}, { concentration: "0.1", unit: "mol/L" }, {}, "diluentConcentration"],
    [{}, { quantity: "0", quantityUnit: "mL" }, {}, "diluentQuantity"],
    [{ notes: "Other additives are present" }, {}, {}, "additionalContext"],
    [{ concentration: "1e-320" }, {}, {}, "numericRange"],
  ])("abstains on incompatible inputs (%j, %j, %j)", (a, b, calculation, code) => {
    const report = calculate(publicInputSchema.parse({
      ...benchmark, a: { ...benchmark.a, ...a }, b: { ...benchmark.b, ...b },
      calculation: { ...benchmark.calculation, ...calculation },
    }));
    expect(report).toEqual({ status: "unsupported", reasons: [expect.objectContaining({ code })] });
  });

  it("requires explicit confirmation and rejects extra or malformed calculation fields", () => {
    for (const change of [
      { assumptionsConfirmed: false },
      { extra: "infer a reaction" },
      { finalVolume: { value: "0x20", unit: "mL" } },
      { finalVolume: { value: "1", unit: "g" } },
    ]) {
      expect(publicInputSchema.safeParse({
        ...benchmark, calculation: { ...benchmark.calculation, ...change },
      }).success).toBe(false);
    }
  });
});
