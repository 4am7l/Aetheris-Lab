import {
  localRequestSchema,
  type LocalRequest,
  type RequestInput,
  requestInputSchema,
} from "../domain";
import { chemicals, searchChemicals } from "../data/chemicals";
import type {
  ChemicalDatabaseService,
  ChemicalIdentificationService,
} from "./contracts";
const KEY = "aetheris.requests.v1";
export const catalog: ChemicalDatabaseService = {
  search: async (q) => searchChemicals(q),
  get: async (id) => chemicals.find((c) => c.id === id),
};
export const identification: ChemicalIdentificationService = {
  identify: async () => {
    throw new Error(
      "AI identification unavailable. Confirm the identity using the label and manual entry.",
    );
  },
};
export function listLocalRequests(): LocalRequest[] {
  const raw = localStorage.getItem(KEY);
  if (!raw) return [];
  const parsed = localRequestSchema.array().safeParse(JSON.parse(raw));
  if (!parsed.success)
    throw new Error(
      "Saved request data could not be read. Export or clear this browser’s site data to recover.",
    );
  return parsed.data;
}
export function saveLocalRequest(
  input: RequestInput,
  mode: "draft" | "demo",
): LocalRequest {
  requestInputSchema.parse(input);
  const at = new Date().toISOString();
  const request: LocalRequest = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: at,
    status: "Draft",
    mode,
    history: [
      {
        status: "Draft",
        at,
        note:
          mode === "demo"
            ? "DEMO — stored only in this browser; never submitted."
            : "Local draft saved in this browser.",
      },
    ],
  };
  localStorage.setItem(KEY, JSON.stringify([request, ...listLocalRequests()]));
  return request;
}
export async function runDemo(
  id: string,
  onUpdate: () => void,
  fail = false,
): Promise<void> {
  const steps = fail
    ? (["Submitted", "Failed"] as const)
    : ([
        "Submitted",
        "Identifying Chemicals",
        "Analyzing",
        "Awaiting Administrator Review",
      ] as const);
  for (const status of steps) {
    await new Promise((resolve) => setTimeout(resolve, 850));
    const list = listLocalRequests();
    const r = list.find((v) => v.id === id);
    if (!r || r.mode !== "demo") return;
    r.status = status;
    r.history.push({
      status,
      at: new Date().toISOString(),
      note:
        status === "Failed"
          ? "DEMO — simulated service failure. No analysis performed."
          : status === "Awaiting Administrator Review"
            ? "DEMO — review placeholder only; no administrator was contacted."
            : "DEMO — workflow animation only. No external services called.",
    });
    localStorage.setItem(KEY, JSON.stringify(list));
    onUpdate();
  }
}
