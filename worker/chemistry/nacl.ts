import { unknown, type RequestInput } from "../../src/domain";
import type { CalculationReference, CalculationReport } from "../../src/calculation";
import { identityMatches, liters, normalizeSolution, sodiumChloride, water } from "./normalize";

const model = { id: "dilute-aqueous-nacl", version: 1 } as const;
const molarMass = 58.443;
const temperatureK = 298.15;
const references = [
  {
    title: "NIST Chemistry WebBook, SRD 69: Sodium chloride",
    url: "https://webbook.nist.gov/cgi/cbook.cgi?ID=C7647145",
    locator: "CAS 7647-14-5; molecular weight 58.443",
    checkedOn: "2026-11-26",
  },
  {
    title: "IUPAC Gold Book: Amount concentration",
    url: "https://goldbook.iupac.org/terms/view/A00295",
    locator: "DOI 10.1351/goldbook.A00295; definition and units",
    checkedOn: "2026-11-26",
  },
  {
    title: "USGS PHREEQC Version 3 and pinned Pitzer database",
    url: "https://github.com/phreeqc-dev/phreeqc3/blob/84971d373c2870eb8e82c0a3c7673df84429f86d/database/pitzer.dat",
    locator: "IPhreeqc 3.7.3-15968 independent comparison; Na⁺, Cl⁻ and halite",
    checkedOn: "2026-11-25",
  },
] satisfies CalculationReference[];
type Reason = Extract<CalculationReport, { status: "unsupported" | "needs-information" }>["reasons"][number];

function inRange(molPerL: number) {
  return molPerL >= 1e-6 && molPerL <= 0.010;
}

export function calculateSodiumChloride(
  input: RequestInput & { calculation: NonNullable<RequestInput["calculation"]> },
): CalculationReport {
  const missing: Reason[] = [];
  const unsupported: Reason[] = [];
  const stocks = (["A", "B"] as const).map((side) => {
    const raw = input[side === "A" ? "a" : "b"];
    const stock = normalizeSolution(raw);
    const { concentration, quantity } = stock;
    if (raw.name === unknown && raw.cas === unknown) missing.push({ code: "calculationIdentityMissing", side });
    else if (!identityMatches(raw, sodiumChloride)) unsupported.push({ code: "identityUnsupported", side });
    if (stock.solvent === null) missing.push({ code: "solventMissing", side });
    else if (stock.solvent !== water.cid) unsupported.push({ code: "solventUnsupported", side });
    if (stock.state === null) missing.push({ code: "stateMissing", side });
    else if (stock.state !== "Liquid") unsupported.push({ code: "stateUnsupported", side });
    if (stock.temperatureK === null) missing.push({ code: "temperatureMissing", side });
    else if (stock.temperatureK !== temperatureK) unsupported.push({ code: "temperatureUnsupported", side });

    const molPerL = concentration ? concentration.value / (concentration.unit === "g/L" ? molarMass : 1) : 0;
    if (!concentration || concentration.unit === unknown) missing.push({ code: "stockConcentrationMissing", side });
    else if ((concentration.unit !== "mol/L" && concentration.unit !== "g/L")
      || (molPerL === 0 ? /[1-9]/.test(raw.concentration.split(/[eE]/, 1)[0]) : !inRange(molPerL))) {
      unsupported.push({ code: "saltConcentration", side });
    }
    const volumeL = quantity?.value ?? 0;
    if (!quantity) missing.push({ code: "stockVolumeMissing", side });
    else if (quantity.unit !== "L" || volumeL < 0.001 || volumeL > 10) {
      unsupported.push({ code: "saltVolume", side });
    }

    return { molPerL, volumeL };
  });
  if ([input.conditions, input.a.notes, input.b.notes].some((value) => value.trim())) {
    unsupported.push({ code: "additionalContext" });
  }

  const finalVolume = input.calculation.finalVolume;
  if (!finalVolume) missing.push({ code: "finalVolumeMissing" });
  const finalVolumeL = finalVolume ? liters(Number(finalVolume.value), finalVolume.unit) : 0;
  const totalVolumeL = stocks.reduce((sum, { volumeL }) => sum + volumeL, 0);
  if (finalVolume && (finalVolumeL <= 0 || (!unsupported.length && !missing.length &&
    Math.abs(finalVolumeL - totalVolumeL) > 0.01 * totalVolumeL + 4 * Number.EPSILON * totalVolumeL))) {
    unsupported.push({ code: "saltFinalVolume" });
  }
  if (unsupported.length) return { status: "unsupported", reasons: [...unsupported, ...missing] };
  if (missing.length) return { status: "needs-information", reasons: missing };

  const amountMolPerIon = stocks.reduce((sum, { molPerL, volumeL }) => sum + molPerL * volumeL, 0);
  const molPerLPerIon = amountMolPerIon / finalVolumeL;
  if (!inRange(molPerLPerIon)) return { status: "unsupported", reasons: [{ code: "saltConcentration" }] };
  return {
    status: "calculated", model, stocks, finalVolumeL, temperatureK, amountMolPerIon, molPerLPerIon, references,
  };
}
