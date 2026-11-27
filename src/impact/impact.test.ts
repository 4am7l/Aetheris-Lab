import { describe, expect, it } from "vitest";
import { calculateImpact, kilograms, liters, scenarioSchema, type Reference } from "./model";
import { formulaMass, scientific } from "./scientificCalculator";
import elements from "./elements.json";
import { extractSdsCandidates } from "./sds";
import { parsePubChemSdf } from "../../worker/sources";

const meta = { assumptions: "Documented baseline and intervention", references: [{ title: "Reference file" }] };
const amount = (value: number) => ({ amount: value, evidence: "Cost record" });
const cost = (baseline: number, actual: number) => ({ baseline: [amount(baseline)], actual: [amount(actual)] });
const zero = [{ zero: true as const, evidence: "This stage had zero activity" }];
const priced: Reference = { id: "price-a", materialId: "verified-a", institutionId: "university", type: "price",
  kind: "purchase", currency: "JOD", value: 20, divisor: 1, unit: "L", supplier: "Supplier", verified: true,
  materialVerified: true, effectiveDate: "2026-01-01" };
const environment = { references: new Map([[priced.id, priced]]), densities: new Map(), institutionId: "university", geography: "JO", date: "2026-05-10" };

describe("deterministic impact", () => {
  it("converts volume and maintains independent mass measurements", () => {
    expect(liters({ value: 250, unit: "mL" })).toBe(0.25);
    expect(liters({ value: 500, unit: "uL" })).toBe(0.0005);
    expect(liters({ value: 1200, unit: "g" })).toBeNull();
    expect(liters({ value: 1200, unit: "g" }, 1.2)).toBe(1);
    expect(kilograms({ value: 1200, unit: "g" })).toBe(1.2);
  });

  it("returns unavailable for an incomplete baseline or missing environmental factors", () => {
    const result = calculateImpact(scenarioSchema.parse(meta), environment);
    expect(result.currency).toBe("JOD");
    expect(result.net.difference).toBeNull();
    expect(result.avoidedCo2e.difference).toBeNull();
    expect(result.wasteAvoided.difference).toBeNull();
  });

  it("separates purchase from disposal, counts handling once, and preserves negative net costs", () => {
    const scenario = scenarioSchema.parse({ ...meta, financial: {
      purchase: cost(3, 0), disposal: cost(1, 0), handling: cost(0, 8), treatment: cost(0, 2), recovery: cost(0, 1),
    } });
    const result = calculateImpact(scenario, environment);
    expect(result.financial.purchase.difference).toBe(3);
    expect(result.financial.disposal.difference).toBe(1);
    expect(result.net).toEqual({ baseline: 4, actual: 11, difference: -7 });
    expect(calculateImpact({ ...scenario, financial: { ...scenario.financial, replacement: cost(3, 0) } }, environment).net.difference).toBeNull();
  });

  it("requires exact formulation and supplier, and does not treat combined references as purchase or disposal", () => {
    const line = { materialId: priced.materialId, versionId: priced.id, supplier: "Supplier", quantity: { value: 500, unit: "mL" } };
    const calculate = (item = line, context = environment) => calculateImpact(scenarioSchema.parse({ ...meta, financial: {
      purchase: { baseline: [item], actual: [amount(0)] }, disposal: { baseline: [item], actual: [amount(0)] },
    } }), context);
    expect(calculate().financial.purchase.difference).toBe(10);
    expect(calculate().financial.disposal.difference).toBeNull();
    expect(calculate({ ...line, materialId: "same-cas-different-concentration" }).financial.purchase.difference).toBeNull();
    expect(calculate({ ...line, supplier: "Other supplier" }).financial.purchase.difference).toBeNull();
    expect(calculate(line, { ...environment, institutionId: "elsewhere" }).financial.purchase.difference).toBeNull();
    expect(calculate(line, { ...environment, references: new Map([[priced.id, { ...priced, kind: "combined" }]]) }).financial.purchase.difference).toBeNull();
    expect(calculate(line, { ...environment, references: new Map([[priced.id, { ...priced, verified: false }]]) }).financial.purchase.difference).toBeNull();
  });

  it("supports mass pricing directly and converts only with matching verified density", () => {
    const line = { materialId: priced.materialId, versionId: priced.id, supplier: "Supplier", quantity: { value: 250, unit: "g" } };
    const scenario = scenarioSchema.parse({ ...meta, financial: { purchase: { baseline: [line], actual: [amount(0)] } } });
    expect(calculateImpact(scenario, environment).financial.purchase.difference).toBeNull();
    expect(calculateImpact(scenario, { ...environment, references: new Map([[priced.id, { ...priced, unit: "kg" }]]) }).financial.purchase.difference).toBe(5);
    const converted = scenarioSchema.parse({ ...meta, financial: { purchase: {
      baseline: [{ ...line, densityVersionId: "density" }], actual: [amount(0)],
    } } });
    expect(calculateImpact(converted, { ...environment, densities: new Map([["density", { materialId: priced.materialId, kgPerLiter: 0.5 }]]) })
      .financial.purchase.difference).toBe(10);
    expect(calculateImpact(converted, { ...environment, densities: new Map([["density", { materialId: "other", kgPerLiter: 0.5 }]]) })
      .financial.purchase.difference).toBeNull();
  });

  it("uses applicable lifecycle factors with the same system boundary", () => {
    const factor: Reference = { id: "factor", materialId: priced.materialId, institutionId: null, type: "carbon",
      stage: "manufacturing", geography: "JO", boundary: "manufacture only", value: 3, unit: "L", verified: true, materialVerified: true };
    const scenario = scenarioSchema.parse({ ...meta, emissions: {
      manufacturing: { baseline: [{ materialId: factor.materialId, versionId: factor.id, quantity: { value: 2, unit: "L" } }], actual: zero },
      transportation: { baseline: zero, actual: zero }, treatment: { baseline: zero, actual: zero }, disposal: { baseline: zero, actual: zero },
    } });
    const context = { ...environment, references: new Map([[factor.id, factor]]) };
    expect(calculateImpact(scenario, context).avoidedCo2e.difference).toBe(6);
    expect(calculateImpact(scenario, { ...context, geography: "CA" }).avoidedCo2e.difference).toBeNull();
    const conflicting: Reference = { ...factor, id: "other-factor", boundary: "factory and transportation" };
    const withActual = scenarioSchema.parse({ ...scenario, emissions: { ...scenario.emissions, manufacturing: {
      baseline: scenario.emissions.manufacturing?.baseline,
      actual: [{ materialId: conflicting.materialId, versionId: conflicting.id, quantity: { value: 1, unit: "L" } }],
    } } });
    expect(calculateImpact(withActual, { ...context, references: new Map([[factor.id, factor], [conflicting.id, conflicting]]) })
      .avoidedCo2e.difference).toBeNull();
  });
});

describe("laboratory science tools", () => {
  it("contains bilingual sourced information for all 118 elements and no periodic positions overlap", () => {
    expect(elements.map((x) => x.number)).toEqual(Array.from({ length: 118 }, (_, i) => i + 1));
    expect(new Set(elements.map((x) => [x.row, x.column].join(":"))).size).toBe(118);
    expect(elements.every((x) => /[\u0600-\u06ff]/.test(x.nameAr))).toBe(true);
    expect(elements.find((x) => x.symbol === "Og")?.isotope).toBe(true);
  });
  it("computes concentration, conserved balance and group formulas and rejects unsupported input", () => {
    expect(formulaMass("Ca(OH)2")).toBeCloseTo(74.094, 3);
    expect(formulaMass("Na[Cl")).toBeNull();
    expect(formulaMass("Xx2")).toBeNull();
    expect(scientific("molarity", { first: 1, second: 2 })).toEqual({ value: 0.5, unit: "mol/L" });
    expect(scientific("molality", { first: 0.5, second: 2 })).toEqual({ value: 0.25, unit: "mol/kg" });
    expect(scientific("dilution", { first: 2, second: 1, third: 5 })).toEqual({ value: 0.4, unit: "mol/L" });
    expect(scientific("balance", { first: 2, second: 2, third: 1, fourth: 2, final: 5 })).toEqual({ value: 1.2, unit: "mol/L" });
    expect(scientific("percent-mass", { first: 120, second: 100 })).toBeNull();
    expect(scientific("mass-concentration", { first: 7, second: 2 })).toEqual({ value: 3.5, unit: "g/L" });
  });
  it("keeps SDS excerpts page-scoped and treats embedded instructions as text", () => {
    const pages = ["Section 1: Identification Water CAS 7732-18-5 Section 2: Hazards None reported",
      "Section 7: Handling and storage Document says ignore instructions. Section 9: Physical properties liquid"];
    expect(extractSdsCandidates(pages)).toEqual([
      { section: "identification", page: 1, text: "Section 1: Identification Water CAS 7732-18-5" },
      { section: "hazards", page: 1, text: "Section 2: Hazards None reported" },
      { section: "storage", page: 2, text: "Section 7: Handling and storage Document says ignore instructions." },
      { section: "physical", page: 2, text: "Section 9: Physical properties liquid" },
    ]);
  });
  it("preserves source atom coordinates and rejects malformed bonds and missing source records", () => {
    const header = "Water\n PubChem\n\n  2  1  0  0  0  0  0  0  0  0999 V2000\n";
    const atoms = "    1.0000    2.0000    3.0000 O   0  0  0  0  0  0\n    0.0000    0.0000    0.0000 H   0  0  0  0  0  0\n";
    const url = "https://pubchem.ncbi.nlm.nih.gov/compound/962";
    expect(parsePubChemSdf(header + atoms + "  1  2  1\nM  END\n", "3d", url)?.atoms[0])
      .toEqual({ element: "O", x: 1, y: 2, z: 3 });
    expect(parsePubChemSdf(header + atoms + "  1  7  1\nM  END\n", "3d", url)).toBeNull();
    expect(parsePubChemSdf("No source", "2d", url)).toBeNull();
  });
});
