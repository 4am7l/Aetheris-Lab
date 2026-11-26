import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  blankSolution,
  publicInputSchema,
  publicSolutionSchema,
  solutionSchema,
  solventOptions,
  validCas,
  validateImage,
  localRequestSchema,
} from "./domain";
import { searchChemicals } from "./data/chemicals";
import { listLocalRequests, saveLocalRequest } from "./services/local";
import {
  publishableResult,
  type VerifiedReviewContext,
} from "../worker/publication";
import worker from "../worker";
const solution = { ...blankSolution, name: "Documented sample" };
describe("structured validation", () => {
  it("keeps unknowns explicit and allows them without invented composition", () => {
    expect(solutionSchema.parse(solution).concentration).toBe("Unknown");
  });
  it("rejects invalid CAS checksum, percentages, and below-absolute-zero temperatures", () => {
    expect(validCas("64-17-5")).toBe(true);
    expect(validCas("64-17-6")).toBe(false);
    for (const patch of [
      { cas: "64-17-6" },
      { concentration: "101", unit: "% w/w" },
      { concentration: "-1" },
      { temperature: "-274" },
      { formula: "" },
    ])
      expect(solutionSchema.safeParse({ ...solution, ...patch }).success).toBe(
        false,
      );
  });
  it("restricts image MIME types, empty images, and image sizes", () => {
    expect(validateImage({ type: "image/svg+xml", size: 40 })).toBeTruthy();
    expect(
      validateImage({ type: "image/png", size: 11 * 1024 * 1024 }),
    ).toBeTruthy();
    expect(validateImage({ type: "image/png", size: 0 })).toBeTruthy();
    expect(validateImage({ type: "image/jpeg", size: 20 })).toBeNull();
  });
  it("searches indexed names, formula, CAS, alias and category", () => {
    for (const q of ["Ethanol", "CH3CH2OH", "64-17-5", "EtOH"])
      expect(searchChemicals(q)[0]?.id).toBe("ethanol");
    expect(searchChemicals("", "Acids")).toEqual([]);
    expect(searchChemicals("fictionalium")).toEqual([]);
  });
});

describe("pre-mixing solution declarations", () => {
  it.each(solventOptions)("accepts declared, unknown and inapplicable pH for %s", (solvent) => {
    for (const ph of ["6.25", "-1.25", "15.75", "Unknown", "Not Applicable"]) {
      expect(publicSolutionSchema.parse({ ...solution, solvent, ph })).toMatchObject({ solvent, ph });
    }
  });

  it.each(["Pure", "Neat"])("accepts separate purity and concentration for %s", (solvent) => {
    for (const purity of [undefined, "Unknown", "0", "95", "98.5", "99.99", "100"]) {
      expect(publicSolutionSchema.parse({ ...solution, solvent, purity, concentration: "43.2", unit: "% w/w" }))
        .toMatchObject({ solvent, purity, concentration: "43.2", unit: "% w/w" });
    }
    for (const purity of ["-0.01", "100.01", "0x20", "Infinity", "100%", ""]) {
      expect(publicSolutionSchema.safeParse({ ...solution, solvent, purity }).success).toBe(false);
    }
  });

  it("accepts Arabic decimal digits without manufacturing a numerical pH or purity", () => {
    expect(publicSolutionSchema.parse({ ...solution, solvent: "Neat", purity: "٩٨٫٥", ph: "−۰٫۲۵" }))
      .toMatchObject({ purity: "98.5", ph: "-0.25" });
    for (const ph of ["", "NaN", "pH 5", "0x9", "1e9999"]) {
      expect(publicSolutionSchema.safeParse({ ...solution, ph }).success).toBe(false);
    }
  });

  it("retains independent custom classifications, solvent names, and legacy free-text solvent values", () => {
    const a = { ...solution, solvent: "Other", customSolvent: " Propylene carbonate ", ph: "Not Applicable",
      classifications: ["Organic", "Other"], customClassification: " Carbonate " };
    const b = { ...solution, solvent: "Distilled water", ph: "5.9", classifications: ["Inorganic", "Salt"] };
    expect(publicInputSchema.parse({ a, b, conditions: "" })).toEqual({
      a: { ...a, customSolvent: "Propylene carbonate", customClassification: "Carbonate" }, b, conditions: "",
    });
    expect(publicSolutionSchema.parse({ ...solution, solvent: "Other" })).not.toHaveProperty("customSolvent");
  });

  it("rejects hidden-field mismatches, invalid categories and client-supplied waste results", () => {
    for (const patch of [{ purity: "99.9" }, { customSolvent: "Water" }, { customClassification: "Custom" },
      { classifications: ["Organic", "Organic"] }, { classifications: ["Acidic waste"] }]) {
      expect(publicSolutionSchema.safeParse({ ...solution, ...patch }).success).toBe(false);
    }
    expect(publicInputSchema.safeParse({ a: solution, b: solution, conditions: "", wasteAssessment: {} }).success).toBe(false);
  });
});
describe("local draft and archived data", () => {
  beforeEach(() => {
    const data = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => data.set(k, v),
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  it("never accepts Approved from local storage", () => {
    const r = saveLocalRequest({ a: solution, b: solution, conditions: "" });
    expect(
      localRequestSchema.safeParse({ ...r, status: "Approved" }).success,
    ).toBe(false);
    localStorage.setItem(
      "aetheris.requests.v1",
      JSON.stringify([{ ...r, status: "Approved" }]),
    );
    expect(() => listLocalRequests()).toThrow();
  });
  it("creates only drafts and still reads records from the retired preview", () => {
    const draft = saveLocalRequest({ a: solution, b: solution, conditions: "" });
    expect(draft).toMatchObject({ mode: "draft", status: "Draft" });
    const archive = { ...draft, mode: "demo", status: "Awaiting Administrator Review" };
    localStorage.setItem("aetheris.requests.v1", JSON.stringify([archive]));
    expect(listLocalRequests()).toEqual([archive]);
  });
});
describe("server approval gate", () => {
  const result = {
    classification: "Insufficient information",
    conditions: "Documented test conditions",
    hazards: [],
    incompatibilities: [],
    storage: "Not assessed",
    container: "Not assessed",
    limitations: ["Test fixture only; not a scientific verdict."],
    sources: [
      { title: "Fixture source", url: "https://example.org/reference" },
    ],
    reviewerId: "reviewer-test",
    reviewedAt: "2026-11-20T12:00:00Z",
    decision: "approved",
  };
  const context = {
    requestId: "test",
    assessmentVersion: 1,
    currentAssessmentVersion: 1,
    decision: "approved",
    reviewerId: "reviewer-test",
    reviewedAt: result.reviewedAt,
    authenticatedReviewer: true,
    signatureVerified: true,
    revoked: false,
    result,
  } as VerifiedReviewContext;
  it("requires authenticated, signed, current, unrevoked review with sources", () => {
    expect(publishableResult(context)).toBeTruthy();
    expect(publishableResult(undefined)).toBeNull();
    for (const patch of [
      { decision: "rejected" },
      { authenticatedReviewer: false },
      { signatureVerified: false },
      { revoked: true },
      { currentAssessmentVersion: 2 },
      { reviewerId: "other" },
      { result: { ...result, sources: [] } },
    ])
      expect(
        publishableResult({ ...context, ...patch } as VerifiedReviewContext),
      ).toBeNull();
  });
  it("does not accept approval headers or POST payloads on the admin route", async () => {
    const response = await worker.fetch(
      new Request("https://local/api/admin/reviews", {
        method: "POST",
        headers: { "Cf-Access-Jwt-Assertion": "fake" },
        body: JSON.stringify({ status: "Approved" }),
      }),
      {} as never,
    );
    expect(response.status).toBe(503);
  });
});
