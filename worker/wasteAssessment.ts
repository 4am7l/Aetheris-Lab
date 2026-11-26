import { isSaltBalance } from "../src/calculation";
import { hasPurity, unknown, type RequestInput } from "../src/domain";
import type { Evidence, PreliminaryReport } from "../src/review";
import { undeterminedWaste, type WasteClassification, type WasteDraft, type WasteEvidence } from "../src/wasteAssessment";
import { sodiumChloride, water } from "./chemistry/normalize";

export function assessWasteEvidence(input: RequestInput, report: PreliminaryReport, evidence: Evidence[]): WasteEvidence {
  const calculation = report.calculation;
  const model = calculation?.status === "calculated" ? calculation : undefined;
  const salt = model && isSaltBalance(model);
  const sides = [["A", input.a], ["B", input.b]] as const;
  const identityEvidence = evidence.filter(({ kind, source }) => kind === "identity" && source === "PubChem");
  const matched = model && [salt ? sodiumChloride.cid : model.inputs.soluteCid, salt ? sodiumChloride.cid : water.cid]
    .every((cid, index) => {
      const side = sides[index][0];
      return report.identities.some(({ solution, state, records }) => solution === side && state === "matched" &&
        records.length === 1 && records[0].cid === cid) && identityEvidence.some(({ solution, url }) =>
        solution === side && url === `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}`);
    });

  // Constituent hazard records flag questions for the reviewer. Only a validated composition model
  // with matching input identities can support a provisional segregation category here.
  const basis = matched ? salt ? "aqueousSodiumChloride" : "aqueousMethanol" : "insufficient";
  const supportedClassifications: WasteEvidence["supportedClassifications"] = matched
    ? salt ? ["Aqueous waste", "Inorganic waste"] : ["Aqueous waste"] : [];
  const missing: WasteEvidence["missing"] = [{ code: "mixtureHazards" }];
  if (!matched) missing.push({ code: "mixtureEvidence" });
  if (!input.conditions.trim() && !input.calculation) missing.push({ code: "conditions" });
  if (input.calculation && !input.calculation.finalVolume) missing.push({ code: "finalVolume" });
  for (const [side, solution] of sides) {
    if (!report.identities.some(({ solution: id, state }) => id === side && state === "matched") ||
      report.gaps.some(({ code, solution }) => code === "identifierUnverified" && solution === side)) {
      missing.push({ code: "identity", solution: side });
    }
    for (const field of ["concentration", "solvent", "state", "temperature", "quantity"] as const) {
      if (field === "concentration" && side === "B" && matched && !salt) continue;
      if (solution[field] === unknown || (field === "solvent" && solution.solvent === "Other" && !solution.customSolvent)) {
        missing.push({ code: field, solution: side });
      }
    }
    if (hasPurity(solution.solvent) && (!solution.purity || solution.purity === unknown)) {
      missing.push({ code: "purity", solution: side });
    }
    if (!solution.ph || solution.ph === unknown) missing.push({ code: "ph", solution: side });
  }

  return {
    basis, supportedClassifications, missing,
    referenceIds: [
      ...identityEvidence.map(({ id }) => id),
      ...(model?.references.map((_, index) => `method-${index + 1}`) ?? []),
    ],
    hazardReferenceIds: sides.flatMap(([side]) => evidence.filter(({ solution, kind }) =>
      solution === side && (kind === "hazard" || kind === "incompatibility")).slice(0, 4).map(({ id }) => id)),
  };
}

export function assembleWasteDraft(
  evidence: WasteEvidence,
  classifications: WasteClassification[] = evidence.supportedClassifications.length
    ? evidence.supportedClassifications : [undeterminedWaste],
): WasteDraft {
  return { ...evidence, classifications };
}
