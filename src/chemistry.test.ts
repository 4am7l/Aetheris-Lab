import { afterEach, describe, expect, it, vi } from "vitest";
import { calculate } from "../worker/chemistry";
import { geminiFor } from "../worker/chemistry/gemini";
import { calculationResultSchema } from "./chemistry";
import { blankSolution, publicInputSchema, type RequestInput } from "./domain";
import benchmark from "./fixtures/nacl-reference.json";

const stock = {
  ...blankSolution, name: "Sodium chloride", formula: "ClNa", cas: "7647-14-5",
  state: "Liquid", solvent: "H₂O", temperature: "25.0",
} as const;
const supported: RequestInput = {
  a: { ...stock, concentration: "0.58443", unit: "g/L", quantity: "100", quantityUnit: "mL" },
  b: { ...stock, concentration: "0.002", unit: "mol/L", quantity: "0.4", quantityUnit: "L" },
  conditions: "", calculationContext: { closedWaterAndSaltOnly: true, atAmbientPressure: true, finalVolumeMl: 499 },
};

describe("dilute aqueous sodium chloride model", () => {
  it.each(benchmark.cases)("agrees with independent reference $id", (reference) => {
    const calculation = calculate(publicInputSchema.parse({
      ...supported,
      a: { ...stock, ...reference.stocks[0] },
      b: { ...stock, ...reference.stocks[1] },
      calculationContext: { closedWaterAndSaltOnly: true, atAmbientPressure: true, finalVolumeMl: reference.finalVolumeMl },
    }));
    expect(calculation.status).toBe("calculated");
    if (calculation.status !== "calculated") return;
    expect(calculationResultSchema.parse(calculation.result)).toEqual(calculation.result);
    expect(calculation.result).toMatchObject({
      phase: "single-aqueous-liquid", uncertainty: "not-quantified", finalVolumeL: reference.finalVolumeMl / 1000,
      species: [{ formula: "Na+", phase: "aqueous" }, { formula: "Cl-", phase: "aqueous" }],
    });
    const [sodium, chloride] = calculation.result.species;
    for (const [ion, expected] of [[sodium, reference.sodium], [chloride, reference.chloride]] as const) {
      expect(Math.abs(ion.amountMol / expected.amountMol - 1)).toBeLessThan(benchmark.relativeTolerance);
      expect(Math.abs(ion.concentrationMolL / expected.concentrationMolL - 1)).toBeLessThan(benchmark.relativeTolerance);
    }
    expect(reference.haliteMoles).toBe(0);
    expect(reference.haliteSi).toBeLessThan(0);
  });

  it("normalizes aliases, source units, and explicit zero without guessing identity", () => {
    const calculation = calculate({
      ...supported, b: { ...supported.b, name: "كلوريد الصوديوم", formula: "NaCl",
        solvent: "ماء", concentration: "0" },
    });
    expect(calculation).toMatchObject({
      status: "calculated", inputs: [{ concentrationMolL: 0.01, volumeL: 0.1 }, { concentrationMolL: 0, volumeL: 0.4 }],
    });
    if (calculation.status === "calculated") expect(calculation.result.species[0].amountMol).toBeCloseTo(0.001, 13);
  });

  it.each([
    [{ name: "Table salt" }, "identityUnresolved"],
    [{ cas: "56-81-5" }, "identityUnresolved"],
    [{ formula: "C3H8O3" }, "identityUnresolved"],
    [{ solvent: "ethanol" }, "solvent"],
    [{ state: "Solid" }, "state"],
    [{ temperature: "25.01" }, "temperature"],
    [{ unit: "% w/w" }, "concentrationUnit"],
    [{ unit: "% v/v" }, "concentrationUnit"],
    [{ quantityUnit: "g" }, "quantityUnit"],
    [{ quantity: "0" }, "volumeRange"],
    [{ quantity: "10001" }, "volumeRange"],
    [{ concentration: "1e-999" }, "concentrationRange"],
    [{ concentration: "1" }, "concentrationRange"],
  ] as const)("reports out-of-scope stock %j with no predicted values", (override, code) => {
    const calculation = calculate(publicInputSchema.parse({ ...supported, a: { ...supported.a, ...override } }));
    expect(calculation).toEqual({ status: "unsupported", issues: [{ kind: "unsupported", code, side: "A" }] });
  });

  it("distinguishes missing fields from unsupported conditions", () => {
    expect(calculate({ ...supported, b: { ...supported.b, temperature: "Unknown" }, calculationContext: undefined }))
      .toEqual({ status: "missing_input", issues: [
        { kind: "missing", code: "temperature", side: "B" },
        { kind: "missing", code: "calculationContext" },
      ] });
    expect(calculate({ ...supported, conditions: "Contains an additional ingredient." }))
      .toEqual({ status: "unsupported", issues: [{ kind: "unsupported", code: "unstructuredConditions" }] });
    expect(calculate({ ...supported, calculationContext: { closedWaterAndSaltOnly: true, atAmbientPressure: true, finalVolumeMl: 450 } }))
      .toEqual({ status: "unsupported", issues: [{ kind: "unsupported", code: "volumeMismatch" }] });
  });

  it("rejects a final concentration above the model range even with in-range stocks", () => {
    const calculation = calculate({
      ...supported, b: { ...supported.b, concentration: "0.01" },
    });
    expect(calculation).toEqual({ status: "unsupported", issues: [{ kind: "unsupported", code: "concentrationRange" }] });
  });
});

describe("Gemini grounded explanation", () => {
  afterEach(() => vi.unstubAllGlobals());

  const envelope = (answer: unknown, finishReason = "STOP") =>
    Response.json({ candidates: [{ finishReason, content: { parts: [{ text: JSON.stringify(answer) }] } }] });
  const provider = geminiFor("gemini-test-model", "test-key")!;
  const calculation = calculate(supported);

  it("sends the schema and coded context and keeps deterministic outputs independent", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(envelope({ topics: ["modelScope", "massBalance"] }));
    vi.stubGlobal("fetch", fetch);
    const before = structuredClone(calculation);
    await expect(provider.explain(calculation)).resolves.toEqual(["modelScope", "massBalance"]);
    expect(calculation).toEqual(before);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-test-model:generateContent");
    expect(options?.headers).toMatchObject({ "x-goog-api-key": "test-key" });
    const body = JSON.parse(String(options?.body));
    expect(body.generationConfig).toMatchObject({
      responseMimeType: "application/json",
      responseJsonSchema: { additionalProperties: false, properties: { topics: { items: { enum: ["massBalance", "modelScope", "measuredVolume"] } } } },
    });
    expect(JSON.parse(body.contents[0].parts[0].text)).toEqual({
      status: "calculated", topics: { massBalance: expect.any(String), modelScope: expect.any(String), measuredVolume: expect.any(String) }, issues: [],
    });
    expect(String(options?.body)).not.toMatch(/7647-14-5|0\.58443|https:\/\/webbook|test-key/);
  });

  it.each([
    [{ topics: ["massBalance", "massBalance"] }, "STOP"],
    [{ topics: ["massBalance", "inputRequirements"] }, "STOP"],
    [{ topics: ["massBalance", "modelScope"], citation: "https://invented.example" }, "STOP"],
    [{ topics: ["massBalance", "modelScope"], concentration: 42 }, "STOP"],
    [{ topics: ["massBalance", "modelScope"] }, "SAFETY"],
    [{ topics: ["massBalance", "modelScope"] }, "MAX_TOKENS"],
  ])("rejects invalid or ungrounded output %j (%s)", async (answer, reason) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(envelope(answer, reason)));
    await expect(provider.explain(calculation)).rejects.toBeDefined();
  });

  it("allows only scope and input requirements for unsupported submissions", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(envelope({ topics: ["inputRequirements", "modelScope"] })));
    await expect(provider.explain(calculate({ ...supported, conditions: "private text" })))
      .resolves.toEqual(["inputRequirements", "modelScope"]);
  });
});
