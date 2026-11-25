import type { CalculationIssue, CalculationResult } from "../../src/chemistry";
import { blocked, type CalculationModel } from "./model";

const version = "1.0.0";
const maxConcentration = 0.01;
const minConcentration = 1e-6;
const minStockVolumeL = 0.001;
const maxStockVolumeL = 10;
const references: CalculationResult["references"] = [
  {
    id: "nist-srd69-nacl", publisher: "NIST", title: "NIST Chemistry WebBook: sodium chloride",
    url: "https://webbook.nist.gov/cgi/cbook.cgi?ID=C7647145",
    version: "SRD 69", locator: "CAS 7647-14-5; molecular weight 58.443",
    retrievedOn: "2026-11-25",
  },
  {
    id: "iupac-a00295", publisher: "IUPAC", title: "Gold Book: amount concentration",
    url: "https://goldbook.iupac.org/terms/view/A00295/pdf",
    version: "doi:10.1351/goldbook.A00295", locator: "Definition and units",
    retrievedOn: "2026-11-25",
  },
  {
    id: "usgs-phreeqc-pitzer", publisher: "U.S. Geological Survey", title: "PHREEQC Version 3 and Pitzer database",
    url: "https://github.com/phreeqc-dev/phreeqc3/blob/84971d373c2870eb8e82c0a3c7673df84429f86d/database/pitzer.dat",
    version: "IPhreeqc 3.7.3-15968", locator: "pitzer.dat: aqueous Na+ and Cl-; Halite; independent benchmark",
    retrievedOn: "2026-11-25",
  },
];

export const diluteSodiumChloride: CalculationModel = {
  supports: ({ solutions }) => solutions.every(({ identity }) => identity === "NaCl"),
  evaluate({ solutions, context, issues: inputIssues }) {
    const issues: CalculationIssue[] = [...inputIssues];
    for (const { side, temperatureC, concentrationMolL, volumeL } of solutions) {
      if (temperatureC !== null && temperatureC !== 25) {
        issues.push({ kind: "unsupported", code: "temperature", side });
      }
      if (concentrationMolL !== null
        && (concentrationMolL > maxConcentration || (concentrationMolL !== 0 && concentrationMolL < minConcentration))) {
        issues.push({ kind: "unsupported", code: "concentrationRange", side });
      }
      if (volumeL !== null && (volumeL < minStockVolumeL || volumeL > maxStockVolumeL)) {
        issues.push({ kind: "unsupported", code: "volumeRange", side });
      }
    }
    if (issues.length) return blocked(issues);

    const [a, b] = solutions;
    if (!context || a.concentrationMolL === null || b.concentrationMolL === null || a.volumeL === null || b.volumeL === null) {
      throw new Error("INCOMPLETE_NORMALIZATION");
    }
    const finalVolumeL = context.finalVolumeMl / 1000;
    const stockVolumeL = a.volumeL + b.volumeL;
    if (Math.abs(finalVolumeL - stockVolumeL) > 0.01 * stockVolumeL) {
      return blocked([{ kind: "unsupported", code: "volumeMismatch" }]);
    }
    const amountMol = a.concentrationMolL * a.volumeL + b.concentrationMolL * b.volumeL;
    const concentrationMolL = amountMol / finalVolumeL;
    if (concentrationMolL < minConcentration || concentrationMolL > maxConcentration) {
      return blocked([{ kind: "unsupported", code: "concentrationRange" }]);
    }
    const aqueous = { phase: "aqueous", amountMol, concentrationMolL } as const;
    return {
      status: "calculated",
      inputs: [
        { concentrationMolL: a.concentrationMolL, volumeL: a.volumeL },
        { concentrationMolL: b.concentrationMolL, volumeL: b.volumeL },
      ],
      result: {
        model: "dilute-aqueous-nacl", version, temperatureC: 25, finalVolumeL,
        phase: "single-aqueous-liquid", uncertainty: "not-quantified",
        species: [{ formula: "Na+", ...aqueous }, { formula: "Cl-", ...aqueous }],
        references,
      },
    };
  },
};
