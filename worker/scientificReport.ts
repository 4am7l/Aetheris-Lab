import { isSaltBalance } from "../src/calculation";
import type { RequestInput } from "../src/domain";
import type { Evidence, PreliminaryReport } from "../src/review";
import type { FindingCode, ScientificDraft, ScientificFinding } from "../src/scientificReport";

type Finding = ScientificFinding & { required?: true };
type SourceTopic = "properties" | "solubility" | "compatibility" | "fire" | "exposure" | "environment";

function sourceTopic(item: Evidence): SourceTopic | undefined {
  if (item.kind === "incompatibility") return "compatibility";
  if (item.kind === "identity" && item.source === "NIOSH" && item.title.includes(" · ")) {
    return item.title.endsWith(" · Solubility") ? "solubility" : "properties";
  }
  if (item.kind !== "hazard") return undefined;
  if (item.source === "NIOSH") return item.title.endsWith(" · Flash Point") ? "fire" : "exposure";
  const code = /^H(\d{3})/i.exec(item.excerpt)?.[1];
  if (!code) return undefined;
  const number = Number(code);
  if (number >= 400 && number < 500) return "environment";
  if (number >= 300 && number < 400) return "exposure";
  // H2xx covers other physical hazard classes as well.
  if ((number >= 200 && number <= 232) || (number >= 240 && number <= 242) ||
    (number >= 250 && number <= 252) || (number >= 260 && number <= 261) ||
    (number >= 270 && number <= 272)) return "fire";
  return number >= 200 && number < 300 ? "properties" : undefined;
}

export function scientificContext(input: RequestInput, report: PreliminaryReport, evidence: Evidence[]) {
  const candidates: Finding[] = [];
  function add(topic: Finding["topic"], code: FindingCode, basis: Finding["basis"], referenceIds: string[] = [], required = true) {
    candidates.push({ topic, code, basis, referenceIds, ...(required ? { required: true } : {}) });
  }

  const matched = new Set(report.identities.filter(({ state }) => state === "matched").map(({ solution }) => solution));
  const usable = evidence.filter(({ solution }) => matched.has(solution));
  const identities = usable.filter(({ kind, source }) => kind === "identity" && source === "PubChem");
  if (identities.length) add("identification", "identityRecords", "retrieved", identities.map(({ id }) => id));
  if (matched.size < 2) add("identification", "identityUnresolved", "limitation");
  const descriptors = new Set(report.identities.filter(({ state, records }) =>
    state === "matched" && records.some(({ smiles }) => smiles)).map(({ solution }) => solution));
  const structures = identities.filter(({ solution }) => descriptors.has(solution)).map(({ id }) => id);
  if (structures.length) add("structure", "molecularDescriptors", "retrieved", structures);

  add("conditions", "recordedConditions", "submitted");
  for (const [topic, code, basis] of [
    ["properties", "propertyRecords", "retrieved"],
    ["solubility", "substanceSolubility", "retrieved"],
    ["compatibility", "substanceReactivity", "interpretation"],
    ["exposure", "occupationalHazards", "retrieved"],
    ["fire", "substanceFire", "retrieved"],
    ["environment", "substanceEnvironmental", "retrieved"],
  ] as const) {
    const refs = usable.filter((item) => sourceTopic(item) === topic).slice(0, 20).map(({ id }) => id);
    if (refs.length) add(topic, code, basis, refs, topic !== "properties" && topic !== "solubility");
  }

  const calculation = report.calculation;
  if (calculation?.status === "calculated") {
    const refs = calculation.references.map((_, index) => "method-" + (index + 1));
    add("solvent", "aqueousScope", "interpretation", refs, false);
    if (isSaltBalance(calculation)) {
      add("stoichiometry", "saltDissociation", "calculated", refs);
      add("concentrations", "saltBalance", "calculated", refs);
    } else {
      add("concentrations", "methanolBalance", "calculated", refs);
    }
    add("uncertainty", "measurementUncertainty", "limitation", refs);
  } else {
    add("uncertainty", "modelUnavailable", "limitation");
  }
  if (report.gaps.some(({ code }) =>
    ["identity", "identifierUnverified", "concentration", "solvent", "state", "temperature", "quantity", "conditions"].includes(code))
    || calculation?.status === "needs-information") {
    add("missing", "missingInputs", "limitation");
  }
  add("uncertainty", "substanceScope", "limitation");
  add("safety", "reviewRequired", "interpretation");

  const included = new Set(candidates.flatMap(({ referenceIds }) => referenceIds));
  return {
    candidates,
    data: {
      identities: report.identities.map(({ solution, state, records }) => ({
        solution, state, ...(state === "matched" ? { records } : {}),
      })),
      gaps: report.gaps,
      declaredMethod: input.calculation?.kind,
      recordedConditions: {
        notesPresent: Boolean(input.conditions.trim() || input.a.notes.trim() || input.b.notes.trim()),
        states: [input.a.state, input.b.state],
      },
      calculation,
      evidence: usable.filter(({ id }) => included.has(id)).map(({ id, source, kind, solution, title, excerpt }) => ({
        id, source, kind, solution, title,
        // References about reactivity can contain procedures. Their presence is sufficient for classification.
        ...(kind === "incompatibility" ? {} : { excerpt }),
      })),
    },
  };
}

export type ScientificContext = ReturnType<typeof scientificContext>;

export function assembleScientificReport(
  context: ScientificContext,
  selection: FindingCode[],
  origin: ScientificDraft["origin"],
): ScientificDraft {
  const byCode = new Map(context.candidates.map((candidate) => [candidate.code, candidate]));
  return {
    version: 1,
    origin,
    findings: selection.map((code) => {
      const { topic, basis, referenceIds } = byCode.get(code)!;
      return { code, topic, basis, referenceIds };
    }),
  };
}
