import { unknown, type Solution } from "../../src/domain";

export const methanol = {
  cid: 887, names: ["methanol", "methyl alcohol", "meoh"],
  formulas: ["CH4O", "CH3OH"], cas: "67-56-1",
};
export const water = {
  cid: 962, names: ["water", "distilled water", "deionized water", "pure water", "h2o"],
  formulas: ["H2O"], cas: "7732-18-5",
};

function normalizedText(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

export function identityMatches(solution: Solution, substance: typeof methanol) {
  const name = normalizedText(solution.name);
  const hasIdentifier = name !== unknown || solution.cas !== unknown;
  return hasIdentifier &&
    (name === unknown || substance.names.includes(name.toLowerCase()) || name === substance.cas) &&
    (solution.cas === unknown || solution.cas === substance.cas) &&
    (solution.formula === unknown || substance.formulas.includes(normalizedText(solution.formula)));
}

function valueOf(value: string) {
  return value === unknown ? null : Number(value);
}

export function liters(value: number, unit: "mL" | "L") {
  return unit === "mL" ? value / 1000 : value;
}

export function normalizeSolution(solution: Solution) {
  const quantity = valueOf(solution.quantity);
  const concentration = valueOf(solution.concentration);
  const celsius = valueOf(solution.temperature);
  const solvent = normalizedText(solution.solvent).toLowerCase();
  return {
    solvent: solution.solvent === unknown ? null : water.names.includes(solvent) ? water.cid : solvent,
    state: solution.state === unknown ? null : solution.state,
    temperatureK: celsius === null ? null : celsius + 273.15,
    concentration: concentration === null ? null : { value: concentration, unit: solution.unit },
    quantity: quantity === null ? null : {
      value: solution.quantityUnit === "mL" ? liters(quantity, "mL")
        : solution.quantityUnit === "g" ? quantity / 1000 : quantity,
      unit: solution.quantityUnit === "mL" ? "L" : solution.quantityUnit === "g" ? "kg" : solution.quantityUnit,
    },
  };
}
