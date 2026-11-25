import { unknown, type RequestInput } from "../../src/domain";
import type { CalculationReference, CalculationReport } from "../../src/calculation";
import { identityMatches, liters, methanol, normalizeSolution, water } from "./normalize";

const model = { id: "aqueous-methanol-dilution", version: 1 } as const;
const references = [
  {
    title: "OpenStax Chemistry 2e, 3.3 Molarity",
    url: "https://openstax.org/books/chemistry-2e/pages/3-3-molarity",
    locator: "Dilution of Solutions; Check Your Learning after Example 3.19",
    checkedOn: "2026-11-25",
  },
  {
    title: "PubChem Compound Summary, Methanol",
    url: "https://pubchem.ncbi.nlm.nih.gov/compound/887",
    locator: "CID 887; molecular formula and CAS identifiers",
    checkedOn: "2026-11-25",
  },
  {
    title: "PubChem Compound Summary, Water",
    url: "https://pubchem.ncbi.nlm.nih.gov/compound/962",
    locator: "CID 962; molecular formula and CAS identifiers",
    checkedOn: "2026-11-25",
  },
] satisfies CalculationReference[];

type DilutionInput = RequestInput & { calculation: NonNullable<RequestInput["calculation"]> };
type Reason = Extract<CalculationReport, { status: "unsupported" | "needs-information" }>["reasons"][number];

export function calculateDilution(input: DilutionInput): CalculationReport {
  const missing: Reason[] = [];
  const unsupported: Reason[] = [];
  const temperatureK = 298.15;
  const a = normalizeSolution(input.a);
  const b = normalizeSolution(input.b);

  for (const [side, raw, normalized, substance] of [
    ["A", input.a, a, methanol], ["B", input.b, b, water],
  ] as const) {
    if (raw.name === unknown && raw.cas === unknown) missing.push({ code: "calculationIdentityMissing", side });
    else if (!identityMatches(raw, substance)) unsupported.push({ code: "identityUnsupported", side });
    if (normalized.state === null) missing.push({ code: "stateMissing", side });
    else if (normalized.state !== "Liquid") unsupported.push({ code: "stateUnsupported", side });
    if (normalized.temperatureK === null) missing.push({ code: "temperatureMissing", side });
    else if (normalized.temperatureK !== temperatureK) unsupported.push({ code: "temperatureUnsupported", side });
  }
  if (a.solvent === null) missing.push({ code: "solventMissing", side: "A" });
  else if (a.solvent !== water.cid) unsupported.push({ code: "solventUnsupported", side: "A" });
  if (b.solvent !== null && b.solvent !== water.cid) unsupported.push({ code: "solventUnsupported", side: "B" });
  if (b.quantity && b.quantity.value <= 0) unsupported.push({ code: "diluentQuantity", side: "B" });
  if (b.concentration !== null) unsupported.push({ code: "diluentConcentration", side: "B" });
  if (input.conditions.trim() || input.a.notes.trim() || input.b.notes.trim()) {
    unsupported.push({ code: "additionalContext" });
  }

  const stock = a.concentration;
  const stockVolume = a.quantity;
  if (!stock) missing.push({ code: "stockConcentrationMissing", side: "A" });
  else if (stock.unit !== "mol/L" || stock.value <= 0 || stock.value > 3) {
    unsupported.push({ code: "stockConcentrationUnsupported", side: "A" });
  }
  if (!stockVolume) missing.push({ code: "stockVolumeMissing", side: "A" });
  else if (stockVolume.unit !== "L" || stockVolume.value <= 0) {
    unsupported.push({ code: "stockVolumeUnsupported", side: "A" });
  }
  const final = input.calculation.finalVolume;
  const finalVolumeL = final ? liters(Number(final.value), final.unit) : null;
  if (finalVolumeL === null) missing.push({ code: "finalVolumeMissing" });
  else if (finalVolumeL <= 0 || (stockVolume?.unit === "L" && finalVolumeL <= stockVolume.value)) {
    unsupported.push({ code: "finalVolumeUnsupported" });
  }

  if (unsupported.length) return { status: "unsupported", reasons: [...unsupported, ...missing] };
  if (!stock || !stockVolume || finalVolumeL === null || missing.length) {
    return { status: "needs-information", reasons: missing };
  }

  const analyticalMolPerL = stock.value * (stockVolume.value / finalVolumeL);
  if (!Number.isFinite(analyticalMolPerL) || analyticalMolPerL < 2 ** -1022 || analyticalMolPerL >= stock.value) {
    return { status: "unsupported", reasons: [{ code: "numericRange" }] };
  }
  return {
    status: "calculated",
    model,
    inputs: {
      soluteCid: methanol.cid, solventCid: water.cid, stockMolPerL: stock.value,
      stockVolumeL: stockVolume.value, finalVolumeL, temperatureK,
    },
    result: { analyticalMolPerL, measurementUncertainty: "unavailable" },
    references,
  };
}
