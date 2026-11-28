import { useQuery } from "@tanstack/react-query";
import { substanceReferences } from "../data/substanceReferences";
import { ImpactError, labApi } from "../impact/client";
import type { CatalogChemical, CatalogPage } from "../impact/contracts";
import type { ChemicalDetailData } from "../impact/Management";

const api = labApi("/api/impact");

async function fetchCatalog(signal: AbortSignal) {
  const chemicals: CatalogChemical[] = [];
  const seen = new Set<string>();
  let after: string | null = null;
  do {
    const path = after ? "/chemicals?" + new URLSearchParams({ after }) : "/chemicals";
    const page: CatalogPage = await api(path, undefined, signal);
    chemicals.push(...page.chemicals);
    after = page.next;
    if (after) {
      if (seen.has(after)) throw new Error("Repeated catalog cursor");
      seen.add(after);
    }
  } while (after);
  return chemicals;
}

export function usePublicCatalog(enabled = true) {
  return useQuery({ queryKey: ["public-chemical-catalog"], queryFn: ({ signal }) => fetchCatalog(signal), enabled, retry: false, staleTime: 60_000 });
}

export function usePublicChemical(id: string) {
  return useQuery({
    queryKey: ["public-chemical", id],
    async queryFn({ signal }) {
      try {
        return await api<ChemicalDetailData>("/chemicals/" + encodeURIComponent(id), undefined, signal);
      } catch (error) {
        if (!(error instanceof ImpactError && error.status === 404 && Object.hasOwn(substanceReferences, id))) throw error;
        return api<ChemicalDetailData>("/chemicals/reference-" + id, undefined, signal);
      }
    },
    retry: false,
  });
}
