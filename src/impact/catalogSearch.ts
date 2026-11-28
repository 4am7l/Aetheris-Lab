import { substanceReferencesByCas } from "../data/substanceReferences";
import type { CatalogChemical } from "./contracts";

export const chemicalSubscripts = "₀₁₂₃₄₅₆₇₈₉";

export function normalizeCatalogTerm(value: string) {
  return value.trim().toLowerCase().replace(/[₀-₉]/g, (digit) => String(chemicalSubscripts.indexOf(digit)));
}

export function readCatalogProvenance(value: string): {
  document?: string; section?: number; page?: number; row?: number; url?: string; aliases?: unknown;
} {
  const data: unknown = JSON.parse(value);
  return data && typeof data === "object" ? data : {};
}

export function catalogAliases(chemical: CatalogChemical) {
  const { aliases } = readCatalogProvenance(chemical.provenance);
  const stored = Array.isArray(aliases) ? aliases.filter((alias): alias is string => typeof alias === "string" && !!alias.trim()) : [];
  const legacy = substanceReferencesByCas.get(chemical.cas ?? "");
  return [...new Set([...stored, ...(legacy?.aliases ?? [])])];
}

export function matchesCatalogChemical(chemical: CatalogChemical, normalized: string) {
  if (!normalized) return true;
  const { nameAr, nameEn, cas, formula, concentration, formulation, category, cid } = chemical;
  const legacy = substanceReferencesByCas.get(cas ?? "");
  return (cid !== null && String(cid) === normalized) ||
    [nameAr, nameEn, cas, formula, concentration, formulation, category, legacy?.formula, ...catalogAliases(chemical)]
      .some((value) => value && normalizeCatalogTerm(value).includes(normalized));
}
