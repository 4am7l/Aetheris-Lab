// Source-linked substance aliases carried forward from the original NIOSH index.
export const substanceReferences = {
  ethanol: {
    cas: "64-17-5",
    aliases: ["Ethyl alcohol", "EtOH", "Grain alcohol"],
    formula: "CH3CH2OH",
    source: "https://www.cdc.gov/niosh/npg/npgd0262.html",
  },
  acetone: {
    cas: "67-64-1",
    aliases: ["Dimethyl ketone", "2-Propanone"],
    formula: "(CH3)2CO",
    source: "https://www.cdc.gov/niosh/npg/npgd0004.html",
  },
  "sodium-hydroxide": {
    cas: "1310-73-2",
    aliases: ["Caustic soda", "Lye", "Sodium hydrate"],
    formula: "NaOH",
    source: "https://www.cdc.gov/niosh/npg/npgd0565.html",
  },
  "hydrogen-peroxide": {
    cas: "7722-84-1",
    aliases: ["Hydrogen dioxide", "Peroxide", "Hydroperoxide"],
    formula: "H2O2",
    source: "https://www.cdc.gov/niosh/npg/npgd0335.html",
  },
};

export const substanceReferencesByCas = new Map<string, (typeof substanceReferences)[keyof typeof substanceReferences]>(
  Object.values(substanceReferences).map((record) => [record.cas, record]),
);
