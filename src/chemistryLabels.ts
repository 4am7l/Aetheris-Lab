import { hasPurity, notApplicable, solventOption, unknown, type ChemicalClassification, type Solution, type SolventOption } from "./domain";
import { ar, en, type TextKey } from "./i18n";
import type { WasteClassification } from "./wasteAssessment";

type Localized = { en: string; ar: string };
export const localizedLabel = (key: TextKey, language: keyof Localized) => (language === "ar" ? ar[key] : en[key]) ?? en[key];
export const solventLabels: Record<SolventOption, Localized> = {
  Water: { en: "Water", ar: "الماء" },
  Neat: { en: "Neat", ar: "غير مخفّف" },
  Pure: { en: "Pure", ar: "نقي" },
  Unknown: { en: en.unknown, ar: localizedLabel("unknown", "ar") },
  Other: { en: "Other", ar: "أخرى" },
};

export const classificationLabels: Record<ChemicalClassification, Localized> = {
  Organic: { en: "Organic", ar: "عضوي" },
  Inorganic: { en: "Inorganic", ar: "غير عضوي" },
  Acid: { en: "Acid", ar: "حمض" },
  Base: { en: "Base", ar: "قاعدة" },
  Salt: { en: "Salt", ar: "ملح" },
  "Oxidizing agent": { en: "Oxidizing agent", ar: "عامل مؤكسد" },
  "Reducing agent": { en: "Reducing agent", ar: "عامل مختزل" },
  Alcohol: { en: "Alcohol", ar: "كحول" },
  Hydrocarbon: { en: "Hydrocarbon", ar: "هيدروكربون" },
  "Halogenated compound": { en: "Halogenated compound", ar: "مركّب مهلجن" },
  "Non-halogenated compound": { en: "Non-halogenated compound", ar: "مركّب غير مهلجن" },
  "Metal-containing compound": { en: "Metal-containing compound", ar: "مركّب يحتوي على معدن" },
  Other: { en: "Other", ar: "أخرى" },
  Unknown: { en: en.unknown, ar: localizedLabel("unknown", "ar") },
};

export const wasteClassificationLabels: Record<WasteClassification, Localized> = {
  "Halogenated organic waste": { en: "Halogenated organic waste", ar: "نفايات عضوية مهلجنة" },
  "Non-halogenated organic waste": { en: "Non-halogenated organic waste", ar: "نفايات عضوية غير مهلجنة" },
  "Aqueous waste": { en: "Aqueous waste", ar: "نفايات مائية" },
  "Acidic waste": { en: "Acidic waste", ar: "نفايات حمضية" },
  "Alkaline waste": { en: "Alkaline waste", ar: "نفايات قلوية" },
  "Heavy metal waste": { en: "Heavy metal waste", ar: "نفايات المعادن الثقيلة" },
  "Inorganic waste": { en: "Inorganic waste", ar: "نفايات غير عضوية" },
  "Oxidizing waste": { en: "Oxidizing waste", ar: "نفايات مؤكسدة" },
  "Reducing waste": { en: "Reducing waste", ar: "نفايات مختزلة" },
  "Reactive waste": { en: "Reactive waste", ar: "نفايات تفاعلية" },
  "Flammable waste": { en: "Flammable waste", ar: "نفايات قابلة للاشتعال" },
  "Toxic waste": { en: "Toxic waste", ar: "نفايات سامة" },
  "Corrosive waste": { en: "Corrosive waste", ar: "نفايات آكلة" },
  "Mixed chemical waste": { en: "Mixed chemical waste", ar: "نفايات كيميائية مختلطة" },
  Other: { en: "Other", ar: "أخرى" },
  Undetermined: { en: "Undetermined", ar: "غير محدّد" },
};

export const wasteNarrativeLabels = {
  justification: "wasteJustification",
  hazards: "wasteHazards",
  limitations: "wasteLimitations",
  missingInformation: "wasteMissing",
} as const;

export function submittedPhLabel(value: string, language: keyof Localized) {
  return value === unknown ? localizedLabel("unknown", language)
    : value === notApplicable ? localizedLabel("notApplicable", language) : value;
}

export function submittedSolutionFields(solution: Solution, language: keyof Localized) {
  const selected = solventOption(solution.solvent);
  const custom = solution.solvent === "Other" ? solution.customSolvent : solution.solvent;
  const solvent = selected === "Other" && custom ? `${solventLabels.Other[language]} · ${custom}` : solventLabels[selected][language];
  const fields: [TextKey, string][] = [["solvent", solvent]];
  if (hasPurity(selected)) {
    fields.push(["purity", !solution.purity || solution.purity === unknown ? localizedLabel("unknown", language) : `${solution.purity}%`]);
  }
  if (solution.ph !== undefined) {
    fields.push(["preMixingPh", submittedPhLabel(solution.ph, language)]);
  }
  if (solution.classifications?.length) {
    const values = solution.classifications.map((classification) => classification === "Other" && solution.customClassification
      ? `${classificationLabels.Other[language]} · ${solution.customClassification}` : classificationLabels[classification][language]);
    fields.push(["chemicalClassification", new Intl.ListFormat(language).format(values)]);
  }
  return fields;
}
