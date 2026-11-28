import type { AssessmentImpactValues, ImpactMetric, ImpactTotals } from "./contracts";

export const impactSeries = [
  { key: "estimate", unit: "JOD", en: "Financial savings", ar: "التوفير المالي" },
  { key: "carbon", unit: "kg CO₂e", en: "Modeled avoided emissions", ar: "الانبعاثات المتجنبة المقدّرة بالنمذجة" },
  { key: "estimatedWaste", unit: "L", en: "Waste avoided by volume", ar: "حجم النفايات المتجنبة" },
  { key: "estimatedWasteKg", unit: "kg", en: "Waste avoided by mass", ar: "كتلة النفايات المتجنبة" },
  { key: "realized", unit: "JOD", en: "Financial savings", ar: "التوفير المالي" },
  { key: "verifiedCarbon", unit: "kg CO₂e", en: "Modeled avoided emissions", ar: "الانبعاثات المتجنبة المقدّرة بالنمذجة" },
  { key: "waste", unit: "L", en: "Waste avoided by volume", ar: "حجم النفايات المتجنبة" },
  { key: "wasteKg", unit: "kg", en: "Waste avoided by mass", ar: "كتلة النفايات المتجنبة" },
] as const;

export const impactGroups = [
  { id: "estimated", en: "Hypothetical experimental estimates", ar: "تقديرات التجارب الافتراضية", metrics: impactSeries.slice(0, 4) },
  { id: "verified", en: "Verified real-world outcomes", ar: "النتائج الفعلية الموثّقة", metrics: impactSeries.slice(4) },
] as const;

export function groupedTotals(totals: ImpactTotals): Record<keyof AssessmentImpactValues, ImpactMetric> {
  return {
    estimate: totals.estimatedFinancial, realized: totals.verifiedFinancial,
    carbon: totals.carbon, verifiedCarbon: totals.verifiedCarbon,
    estimatedWaste: totals.estimatedAvoided, estimatedWasteKg: totals.estimatedAvoidedKg,
    waste: totals.avoided, wasteKg: totals.avoidedKg,
  };
}
