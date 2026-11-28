import type { ChemicalRecord } from "../domain";
import { substanceReferences } from "./substanceReferences";
// Small, reviewed seed catalog. These are substance references, never solution-specific verdicts.
export const chemicals: ChemicalRecord[] = [
  {
    ...substanceReferences.ethanol,
    id: "ethanol",
    name: "Ethanol",
    category: "Solvents",
    mass: 46.1,
    state: "Liquid",
    description: "A clear, colorless liquid; miscible with water.",
    hazards:
      "NIOSH lists a Class IB flammable liquid. Consult the linked reference and your product SDS.",
    incompatibilities:
      "NIOSH lists strong oxidizers, sodium, and several other reactive substances; consult the full source.",
    verifiedOn: "2026-11-20",
  },
  {
    ...substanceReferences.acetone,
    id: "acetone",
    name: "Acetone",
    category: "Solvents",
    mass: 58.1,
    state: "Liquid",
    description: "A colorless liquid; miscible with water.",
    hazards:
      "NIOSH lists a Class IB flammable liquid. Consult the linked reference and your product SDS.",
    incompatibilities: "NIOSH lists oxidizers and acids.",
    verifiedOn: "2026-11-20",
  },
  {
    ...substanceReferences["sodium-hydroxide"],
    id: "sodium-hydroxide",
    name: "Sodium hydroxide",
    category: "Bases",
    mass: 40,
    state: "Solid",
    description:
      "An odorless white or colorless solid. Solution properties depend on concentration.",
    hazards:
      "NIOSH describes eye and skin burns and heat generation on contact with water.",
    incompatibilities:
      "NIOSH lists acids, certain metals, flammable liquids, water, and other substances; consult the full source.",
    verifiedOn: "2026-11-20",
  },
  {
    ...substanceReferences["hydrogen-peroxide"],
    id: "hydrogen-peroxide",
    name: "Hydrogen peroxide",
    category: "Oxidizers",
    mass: 34,
    state: "Liquid",
    description:
      "A colorless liquid, frequently supplied as an aqueous solution.",
    hazards:
      "NIOSH describes a powerful oxidizer; contact with combustible material can cause spontaneous combustion.",
    incompatibilities:
      "NIOSH lists oxidizable materials and several metals including iron and copper.",
    verifiedOn: "2026-11-20",
  },
];
export const categories = [
  "All entries",
  "Solvents",
  "Bases",
  "Oxidizers",
  "Acids",
  "Salts",
  "Elements",
  "Equipment",
  "Safety topics",
];
export function searchChemicals(query: string, category = "All entries") {
  const q = query
    .trim()
    .toLowerCase()
    .replace(/[₂₃]/g, (c) => (c === "₂" ? "2" : "3"));
  return chemicals.filter(
    (c) =>
      (category === "All entries" || c.category === category) &&
      [c.name, ...c.aliases, c.formula, c.cas, c.category].some((v) =>
        v.toLowerCase().includes(q),
      ),
  );
}
