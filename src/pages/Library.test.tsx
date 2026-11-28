// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import type { CatalogChemical } from "../impact/contracts";
import Library from "./Library";

const original: CatalogChemical = {
  id: "reference-hydrogen-peroxide", nameEn: "Hydrogen peroxide", nameAr: "بيروكسيد الهيدروجين",
  formula: "H2O2", cas: "7722-84-1", cid: null, concentration: "30%", category: "oxidizer",
  purity: null, solvent: null, formulation: null, state: null, hazards: null, wasteCategory: null,
  status: "unverified", updatedAt: "2026-11-27", provenance: "{}", institutionId: null, labId: null,
};
const supplemental: CatalogChemical = {
  ...original, id: "supplemental", formula: "H₂O₂", concentration: "3%",
  provenance: JSON.stringify({ aliases: ["Supplemental trade alias"] }),
};

function mount() {
  const client = new QueryClient();
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/library"]}>
    <Library />
  </MemoryRouter></QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("shows every page and filters cached records instantly without merging equal CAS numbers", async () => {
  const fetchCatalog = vi.fn(async (url: string) => url.includes("after=")
    ? Response.json({ chemicals: [supplemental], next: null })
    : Response.json({ chemicals: [original], next: original.id }));
  vi.stubGlobal("fetch", fetchCatalog);
  mount();
  await screen.findByText("2 catalog entries");
  const search = screen.getByRole("searchbox", { name: "Search library" });
  for (const term of ["PERoxi", "الهيدروجين", "7722-84", "h₂O₂", "H2O2", "Hydroperoxide"]) {
    fireEvent.change(search, { target: { value: term } });
    expect(screen.getAllByRole("link", { name: /Hydrogen peroxide/ })).toHaveLength(2);
  }
  fireEvent.change(search, { target: { value: "trade alias" } });
  expect(screen.getByRole("link", { name: /Hydrogen peroxide/ }).getAttribute("href")).toBe("/library/supplemental");
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  expect(screen.getAllByRole("link", { name: /Hydrogen peroxide/ })).toHaveLength(2);
  expect(fetchCatalog.mock.calls.map(([url]) => url)).toEqual([
    "/api/impact/chemicals", "/api/impact/chemicals?after=reference-hydrogen-peroxide",
  ]);
});

it("distinguishes a pending request, a recoverable API failure and an empty catalog", async () => {
  let resolve!: (response: Response) => void;
  const fetchCatalog = vi.fn(() => Promise.resolve(Response.json({ chemicals: [], next: null })))
    .mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; }));
  vi.stubGlobal("fetch", fetchCatalog);
  mount();
  expect(screen.getByRole("status").textContent).toBe("Loading…");
  resolve(Response.json({ error: "SERVICE_UNAVAILABLE" }, { status: 503 }));
  expect((await screen.findByRole("alert")).textContent).toContain("The chemical catalog could not be loaded.");
  expect(screen.queryByText("No matching entries")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("The catalog has no public entries.")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});
