import { z } from "zod";
import { unknown, validCas, type Solution } from "../src/domain";
import type { Evidence, EvidenceGap, Identity, SolutionSide } from "../src/review";
import { error, json, readBytes } from "./http";
import type { CompoundDetail, CompoundReference, MolecularModel } from "../src/impact/science";

const pubchem = "https://pubchem.ncbi.nlm.nih.gov";
const cdc = "https://www.cdc.gov/niosh/npg/";

/** Interactive reference lookups reuse the assessment's bounded PubChem client. */
export async function chemicalSearch(url: URL) {
  const q = (url.searchParams.get("q") ?? "").normalize("NFKC").trim();
  if (!q || q.length > 120) return error("INVALID_SEARCH", 400);
  try {
    const rows = /^\d{1,10}$/.test(q) ? [await compoundByCid(Number(q))].filter((item) => item !== null)
      : await compounds(molecularFormula(q) ? "fastformula" : "name", q);
    return json({ compounds: rows.map(referenceFrom), ambiguous: rows.length > 1 });
  } catch {
    return error("REFERENCE_UNAVAILABLE", 503);
  }
}

async function compoundByCid(cid: number) {
  const text = await retrieve(pubchem + "/rest/pug/compound/cid/" + cid +
    "/property/Title,MolecularFormula,MolecularWeight,ConnectivitySMILES,Charge/JSON", 64 * 1024);
  if (!text) return null;
  const properties = z.object({ PropertyTable: z.object({ Properties: z.array(compoundSchema.extend({ Charge: z.int().optional() })) }) })
    .parse(JSON.parse(text)).PropertyTable.Properties;
  return properties.length === 1 && properties[0].CID === cid ? properties[0] : null;
}

function referenceFrom(record: Compound): CompoundReference {
  return { cid: record.CID, name: record.Title, formula: record.MolecularFormula,
    mass: record.MolecularWeight ? Number(record.MolecularWeight) : null, url: pubchem + "/compound/" + record.CID };
}

function discrete(record: NonNullable<Awaited<ReturnType<typeof compoundByCid>>>) {
  const smiles = record.ConnectivitySMILES;
  // Multicomponent, charged, wildcard/polymer, or undefined representations do not pass.
  return Boolean(smiles && /^[^.*]+$/.test(smiles) && record.Charge === 0 &&
    !/\[[^\]]*[+-][^\]]*\]/.test(smiles));
}

const propertyHeadings = new Set(["Physical Description", "Solubility", "Boiling Point", "Melting Point", "Density", "Chemical Classes"]);
function physicalProperties(raw: unknown, url: string): CompoundDetail["properties"] {
  const rows: CompoundDetail["properties"] = [];
  function collect(node: unknown, depth: number) {
    const parsed = annotations.safeParse(node);
    if (!parsed.success || depth > 8 || rows.length >= 12) return;
    const { TOCHeading: label, Information, Section } = parsed.data;
    if (propertyHeadings.has(label)) for (const item of Information ?? []) {
      const value = item.Value?.StringWithMarkup?.[0]?.String.trim().slice(0, 350);
      if (!value || rows.filter((row) => row.label === label).length >= 2 || rows.some((row) => row.value === value)) continue;
      rows.push({ label, value, url: url + "#" + encodeURIComponent(label) });
    }
    for (const section of Section ?? []) collect(section, depth + 1);
  }
  if (Array.isArray(raw)) for (const s of raw) collect(s, 0);
  return rows;
}

async function heading(cid: number, label: string) {
  const raw = await retrieve(pubchem + "/rest/pug_view/data/compound/" + cid + "/JSON?heading=" + encodeURIComponent(label), 1024 * 1024);
  return raw ? { raw, section: z.object({ Record: z.object({ RecordNumber: z.literal(cid), Section: z.array(z.unknown()) }) })
    .parse(JSON.parse(raw)).Record.Section } : null;
}

const ghsNames = ["Explosive", "Flammable", "Oxidizer", "Gas under pressure", "Corrosive", "Acute toxicity", "Irritant", "Health hazard", "Environmental hazard"];
export async function chemicalKnowledge(cid: number) {
  try {
    const record = await compoundByCid(cid);
    if (!record) return error("NOT_FOUND", 404);
    const ref = referenceFrom(record);
    const gaps: string[] = [];
    const [cas, hazards, physical, ghs] = await Promise.all([
      compoundCas(cid).catch(() => { gaps.push("cas"); return null; }),
      pubchemSafety(record).catch(() => { gaps.push("hazards"); return []; }),
      heading(cid, "Chemical and Physical Properties").catch(() => { gaps.push("physical"); return null; }),
      heading(cid, "GHS Classification").catch(() => { gaps.push("ghs"); return null; }),
    ]);
    const codes = ghs ? [...new Set(ghs.raw.match(/GHS0[1-9](?=\.svg")/g) ?? [])] : [];
    const detail: CompoundDetail = { ...ref, cas: typeof cas === "string" ? cas : null,
      hazards: hazards.map((item) => item.kind === "incompatibility" ? { ...item, excerpt: "" } : item),
      properties: physicalProperties(physical?.section, ref.url),
      pictograms: codes.map((code) => ({ code, name: ghsNames[Number(code.at(-1)) - 1] })),
      sourceGaps: gaps.sort(), discreteModel: discrete(record) };
    return json(detail);
  } catch {
    return error("REFERENCE_UNAVAILABLE", 503);
  }
}

export function parsePubChemSdf(data: string, dimensions: MolecularModel["dimensions"], source: string): MolecularModel | null {
  const lines = data.replaceAll("\r", "").split("\n");
  const counts = lines[3];
  if (!counts?.includes("V2000") || !lines.includes("M  END")) return null;
  const atomCount = Number(counts.slice(0, 3));
  const bondCount = Number(counts.slice(3, 6));
  if (!Number.isInteger(atomCount) || atomCount < 1 || atomCount > 200 || !Number.isInteger(bondCount) || bondCount < 0 || bondCount > 400) return null;
  const atoms = lines.slice(4, 4 + atomCount).map((row) => ({
    element: row.slice(31, 34).trim(), x: Number(row.slice(0, 10)), y: Number(row.slice(10, 20)), z: Number(row.slice(20, 30)),
  }));
  const bonds = lines.slice(4 + atomCount, 4 + atomCount + bondCount).map((row) => ({
    from: Number(row.slice(0, 3)) - 1, to: Number(row.slice(3, 6)) - 1, order: Number(row.slice(6, 9)),
  }));
  if (atoms.length !== atomCount || bonds.length !== bondCount ||
      atoms.some(({ element, x, y, z }) => !/^[A-Z][a-z]?$/.test(element) || ![x, y, z].every(Number.isFinite)) ||
      bonds.some(({ from, to, order }) => !Number.isInteger(from) || !Number.isInteger(to) ||
        from < 0 || to < 0 || from >= atoms.length || to >= atoms.length || ![1, 2, 3, 4].includes(order))) return null;
  return { atoms, bonds, dimensions, source };
}

export async function chemicalModel(cid: number, dimensions: MolecularModel["dimensions"]) {
  try {
    const record = await compoundByCid(cid);
    if (!record || !discrete(record)) return error("DISCRETE_MODEL_UNAVAILABLE", 404);
    const source = pubchem + "/rest/pug/compound/cid/" + cid + "/SDF?record_type=" + dimensions;
    const sdf = await retrieve(source, 256 * 1024);
    const model = sdf && parsePubChemSdf(sdf, dimensions, source);
    return model ? json(model) : error("DISCRETE_MODEL_UNAVAILABLE", 404);
  } catch {
    return error("REFERENCE_UNAVAILABLE", 503);
  }
}

export async function pictogram(code: string) {
  if (!/^GHS0[1-9]$/.test(code)) return error("NOT_FOUND", 404);
  try {
    const svg = await retrieve(pubchem + "/images/ghs/" + code + ".svg", 24 * 1024);
    if (!svg || !svg.includes("<svg")) return error("NOT_FOUND", 404);
    return new Response(svg, { headers: {
      "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400",
      "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch {
    return error("REFERENCE_UNAVAILABLE", 503);
  }
}
const compoundSchema = z.object({
  CID: z.int().positive(),
  Title: z.string().min(1).max(500),
  MolecularFormula: z.string().min(1).max(500),
  MolecularWeight: z.string().regex(/^\d+(?:\.\d+)?$/).max(20).optional().catch(undefined),
  ConnectivitySMILES: z.string().min(1).max(360).optional().catch(undefined),
});
type Compound = z.infer<typeof compoundSchema>;
type Citation = Pick<Evidence, "source" | "kind" | "title" | "url" | "excerpt">;

class SourceFailure extends Error {
  constructor(readonly code: string, readonly httpStatus?: number) {
    super(code);
  }
}

async function retrieve(url: string, maxBytes: number) {
  const signal = AbortSignal.timeout(8_000);
  const response = await fetch(url, { redirect: "manual", signal }).catch(() => {
    throw new SourceFailure(signal.aborted ? "TIMEOUT" : "NETWORK_ERROR");
  });
  if (!response.ok) void response.body?.cancel().catch(() => {});
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) throw new SourceFailure("HTTP_ERROR", response.status);
  const bytes = await readBytes(response, maxBytes);
  if (signal.aborted) throw new SourceFailure("TIMEOUT");
  if (bytes instanceof Response) throw new SourceFailure("INVALID_BODY", response.status);
  return new TextDecoder().decode(bytes);
}

function chemicalText(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

// Compare elemental counts for simple molecular or condensed formulas.
function molecularFormula(value: string) {
  const text = chemicalText(value);
  if (!/^(?:[A-Z][a-z]?\d*){1,40}$/.test(text)) return null;
  const elements = new Map<string, number>();
  for (const [, element, digits] of text.matchAll(/([A-Z][a-z]?)(\d*)/g)) {
    const count = digits ? Number(digits) : 1;
    if (!Number.isSafeInteger(count) || count < 1 || count > 10_000) return null;
    elements.set(element, (elements.get(element) ?? 0) + count);
  }
  return JSON.stringify([...elements].sort(([a], [b]) => a.localeCompare(b)));
}

async function compounds(namespace: "name" | "fastformula", identifier: string) {
  const query = namespace === "fastformula" ? "?MaxRecords=3" : "";
  const data = await retrieve(
    pubchem + "/rest/pug/compound/" + namespace + "/" + encodeURIComponent(identifier)
      + "/property/Title,MolecularFormula,MolecularWeight,ConnectivitySMILES/JSON" + query, 128 * 1024,
  );
  if (!data) return [];
  return z.object({ PropertyTable: z.object({ Properties: z.array(compoundSchema) }) })
    .parse(JSON.parse(data)).PropertyTable.Properties.slice(0, 3);
}

async function identityOf(solution: Solution) {
  const formula = molecularFormula(solution.formula);
  const name = chemicalText(solution.name);
  const cas = solution.cas === unknown && name !== unknown && validCas(name)
    ? name : solution.cas;
  const usableName = name !== unknown && name !== cas;
  const embeddedFormula = usableName ? molecularFormula(name) : null;
  const byCas = cas === unknown ? [] : await compounds("name", cas);
  const byName = usableName && !embeddedFormula ? await compounds("name", name) : [];
  const candidates = byCas.length ? byCas : byName;
  const formulaText = formula ? chemicalText(solution.formula) : embeddedFormula ? name : undefined;
  const targetFormula = formula ?? embeddedFormula;
  let records = candidates;
  let conflict = Boolean(byCas.length && byName.length &&
    !byCas.some((candidate) => byName.some(({ CID }) => candidate.CID === CID)));
  conflict ||= Boolean(formula && embeddedFormula && formula !== embeddedFormula);
  if (byCas.length && byName.length && !conflict) {
    records = byCas.filter((candidate) => byName.some(({ CID }) => candidate.CID === CID));
  }
  if (targetFormula && records.length) {
    const matches = records.filter((record) => molecularFormula(record.MolecularFormula) === targetFormula);
    conflict ||= matches.length === 0;
    if (matches.length) records = matches;
  }
  if (!candidates.length && formulaText) records = await compounds("fastformula", formulaText);
  if (conflict) records = [...new Map([...byCas, ...byName].map((record) => [record.CID, record])).values()];
  const unverified = (cas !== unknown && !byCas.length)
    || (usableName && !embeddedFormula && !byName.length)
    || (solution.formula !== unknown && !formula);
  // Every supplied identifier must corroborate the match. Formula-only lookup stays ambiguous.
  const state = records.length === 0 ? "missing"
    : records.length !== 1 || conflict || unverified || !candidates.length ? "ambiguous" : "matched";
  return { records, state, cas, unverified } as const;
}

const annotations = z.object({
  TOCHeading: z.string(),
  Information: z.array(z.object({
    Name: z.string().optional(),
    ReferenceNumber: z.int().optional(),
    Value: z.object({ StringWithMarkup: z.array(z.object({ String: z.string() })).optional() }).optional(),
  })).optional(),
  Section: z.array(z.unknown()).optional(),
});
const incompatibilityHeadings = new Set([
  "Reactivity Profile", "Hazardous Reactivities and Incompatibilities",
]);

async function pubchemSafety(record: Compound): Promise<Citation[]> {
  const data = await retrieve(
    pubchem + "/rest/pug_view/data/compound/" + record.CID + "/JSON?heading=Safety%20and%20Hazards",
    1024 * 1024,
  );
  if (!data) return [];
  const result = z.object({
    Record: z.object({ RecordNumber: z.int(), Section: z.array(z.unknown()) }),
  }).parse(JSON.parse(data)).Record;
  if (result.RecordNumber !== record.CID) throw new Error("WRONG_COMPOUND");
  const found: Citation[] = [];
  function visit(raw: unknown, depth: number) {
    const parsed = annotations.safeParse(raw);
    if (!parsed.success || depth > 8) return;
    const section = parsed.data;
    const heading = section.TOCHeading;
    for (const entry of section.Information ?? []) {
      const kind = incompatibilityHeadings.has(heading) ? "incompatibility"
        : heading === "GHS Classification" && entry.Name === "GHS Hazard Statements" ? "hazard" : null;
      if (!kind) continue;
      for (const line of (entry.Value?.StringWithMarkup ?? []).slice(0, 18)) {
        const excerpt = line.String.replace(/\s+/g, " ").trim().slice(0, 900);
        if (!excerpt || (kind === "hazard" && !/^H\d{3}[a-z]*(?:\s|:|\+|$)/i.test(excerpt))) continue;
        const group = kind === "incompatibility" ? "" : excerpt.slice(0, 2).toUpperCase();
        if (kind === "hazard" && !["H2", "H3", "H4"].includes(group)) continue;
        if (found.filter((item) => item.kind === kind && item.excerpt.toUpperCase().startsWith(group)).length >= 3) continue;
        if (found.some((item) => item.excerpt === excerpt)) continue;
        found.push({
          source: "PubChem", kind, title: record.Title + " · " + heading,
          url: pubchem + "/compound/" + record.CID + "#" + encodeURIComponent(heading), excerpt,
        });
      }
    }
    for (const child of section.Section ?? []) visit(child, depth + 1);
  }
  for (const section of result.Section) visit(section, 0);
  return found;
}

function htmlText(html: string) {
  return html.replace(/<[^>]*>/g, " ").replace(/&(amp|lt|gt|quot|apos|nbsp|#\d{1,6}|#x[0-9a-f]{1,6});/gi,
    (original, entity: string) => {
      const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
      if (!entity.startsWith("#")) return named[entity] ?? original;
      const point = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return point <= 0x10ffff ? String.fromCodePoint(point) : original;
    }).replace(/\s+/g, " ").trim();
}

function indexEntries(html: string) {
  const items = new Map<string, { title: string; page: string }[]>();
  const rows = /<tr>\s*<td>\s*([^<]{1,200})<\/td>\s*<td>\s*<a\s+href=['"](npgd\d{4}\.html)['"]\s*>([\s\S]{1,600}?)<\/a>\s*<\/td>\s*<\/tr>/gi;
  for (const [, key, page, title] of html.matchAll(rows)) {
    const normalized = htmlText(key).toLowerCase();
    items.set(normalized, [...(items.get(normalized) ?? []), { title: htmlText(title), page }]);
  }
  if (!items.size) throw new SourceFailure("INDEX_FORMAT_CHANGED");
  return items;
}

async function compoundCas(cid: number) {
  const data = await retrieve(pubchem + "/rest/pug_view/data/compound/" + cid + "/JSON?heading=CAS", 128 * 1024);
  if (!data) return unknown;
  const schema = z.object({
    Record: z.object({ RecordNumber: z.literal(cid), Section: z.array(z.unknown()) }),
  });
  const numbers = new Set<string>();
  function visit(raw: unknown, depth: number) {
    const result = annotations.safeParse(raw);
    if (!result.success || depth > 6) return;
    const section = result.data;
    if (section.TOCHeading === "CAS") {
      for (const entry of section.Information ?? []) {
        for (const item of entry.Value?.StringWithMarkup ?? []) {
          if (item.String !== unknown && validCas(item.String)) numbers.add(item.String);
        }
      }
    }
    for (const child of section.Section ?? []) visit(child, depth + 1);
  }
  for (const section of schema.parse(JSON.parse(data)).Record.Section) visit(section, 0);
  return numbers.size === 1 ? [...numbers][0] : unknown;
}

const nioshFields = new Map<string, Citation["kind"]>([
  ["Incompatibilities & Reactivities", "incompatibility"],
  ["Symptoms", "hazard"], ["Exposure Routes", "hazard"], ["Target Organs", "hazard"], ["Flash Point", "hazard"],
  ["Physical Description", "identity"], ["Boiling Point", "identity"], ["Freezing Point", "identity"],
  ["Solubility", "identity"], ["Vapor Pressure", "identity"], ["Specific Gravity", "identity"],
  ["Melting Point", "identity"], ["Density", "identity"],
]);

function nioshCitation(title: string, url: string, heading: string, value: string): Citation | undefined {
  const kind = nioshFields.get(heading);
  const excerpt = value.replace(/\s+/g, " ").trim().slice(0, 900);
  if (kind && excerpt && !/^(?:none|not available|n\.d\.|\?)$/i.test(excerpt)) {
    return { source: "NIOSH", kind, title: title + " · " + heading, url, excerpt };
  }
}

async function nioshProfile(cas: string, { page, title }: { page: string; title: string }): Promise<Citation[]> {
  const url = cdc + page;
  const html = await retrieve(url, 768 * 1024);
  if (html === null) throw new SourceFailure("HTTP_ERROR", 404);

  const fields = new Map<string, string>();
  const cards = /<div\s+class=["']card-title h6["']>([\s\S]{1,300}?)<\/div>\s*<div\s+class=["']card-body["']>\s*<div\s+class=["']card-text["']>([\s\S]{0,4000}?)<\/div>/gi;
  for (const [, heading, body] of html.matchAll(cards)) {
    fields.set(htmlText(heading), htmlText(body));
  }
  if (!fields.has("CAS No.")) throw new SourceFailure("PROFILE_FORMAT_CHANGED");
  if (fields.get("CAS No.") !== cas) return [];

  const evidence: Citation[] = [{ source: "NIOSH", kind: "identity", title, url, excerpt: "CAS " + cas }];
  for (const [heading, value] of fields) {
    const citation = nioshCitation(title, url, heading, value);
    if (citation) evidence.push(citation);
  }
  return evidence;
}

async function nioshDeposits({ CID, Title }: Compound): Promise<Citation[]> {
  // PubChem publishes annotations deposited by NIOSH and identifies their original references.
  const data = await retrieve(pubchem + "/rest/pug_view/data/compound/" + CID + "/JSON", 4 * 1024 * 1024);
  if (data === null) return [];
  const schema = z.object({ Record: z.object({
    RecordNumber: z.literal(CID),
    Reference: z.array(z.object({
      ReferenceNumber: z.int(), SourceName: z.string().optional(), URL: z.string().optional(),
    })),
    Section: z.array(z.unknown()),
  }) });
  const record = schema.parse(JSON.parse(data)).Record;
  const profiles = new Map<number, string>();
  for (const { ReferenceNumber, SourceName, URL } of record.Reference) {
    if (SourceName === "The National Institute for Occupational Safety and Health (NIOSH)" &&
      URL && /^https:\/\/www\.cdc\.gov\/niosh\/npg\/npgd\d{4}\.html$/.test(URL)) {
      profiles.set(ReferenceNumber, URL);
    }
  }
  if (new Set(profiles.values()).size !== 1) return [];

  const evidence = new Map<string, Citation>();
  function visit(raw: unknown, depth: number) {
    const parsed = annotations.safeParse(raw);
    if (!parsed.success || depth > 8) return;
    const { TOCHeading, Information, Section } = parsed.data;
    const heading = TOCHeading === "Signs and Symptoms" ? "Symptoms"
      : TOCHeading === "Hazardous Reactivities and Incompatibilities" ? "Incompatibilities & Reactivities" : TOCHeading;
    for (const item of Information ?? []) {
      const url = profiles.get(item.ReferenceNumber ?? -1);
      if (!url) continue;
      for (const { String: value } of item.Value?.StringWithMarkup ?? []) {
        const citation = nioshCitation(Title, url, heading, value);
        if (citation && !evidence.has(heading)) evidence.set(heading, citation);
      }
    }
    for (const child of Section ?? []) visit(child, depth + 1);
  }
  for (const section of record.Section) visit(section, 0);
  return [...evidence.values()];
}

export function scientificSources(runId: string) {
  // Share lookups across both solutions during this run.
  let index: Promise<ReturnType<typeof indexEntries>> | undefined;
  const profiles = new Map<string, Promise<Citation[]>>();
  const deposits = new Map<number, Promise<Citation[]>>();
  function loadIndex() {
    return index ??= retrieve(cdc + "npgdcas.html", 1024 * 1024).then((html) => {
      if (html === null) throw new SourceFailure("HTTP_ERROR", 404);
      return indexEntries(html);
    });
  }
  async function collectNiosh(cas: string, chemical: Compound | undefined, solution: SolutionSide) {
    if (cas === unknown) return [];
    let stage = "cdc_index";
    function log(cause: unknown) {
      const error = cause instanceof SourceFailure ? cause : new SourceFailure("INVALID_RESPONSE");
      console.warn({ event: "niosh_lookup_failed", runId, solution, stage, code: error.code, httpStatus: error.httpStatus });
    }
    try {
      const entries = (await loadIndex()).get(cas) ?? [];
      const matches = [...new Map(entries.map((entry) => [entry.page, entry])).values()];
      if (matches.length !== 1) return [];
      stage = "cdc_profile";
      let profile = profiles.get(cas);
      if (!profile) {
        profile = nioshProfile(cas, matches[0]);
        profiles.set(cas, profile);
      }
      return await profile;
    } catch (cause) {
      log(cause);
      if (chemical) {
        stage = "pubchem_annotations";
        try {
          let fallback = deposits.get(chemical.CID);
          if (!fallback) {
            fallback = nioshDeposits(chemical);
            deposits.set(chemical.CID, fallback);
          }
          const evidence = await fallback;
          if (evidence.length) return evidence;
        } catch (fallbackCause) {
          log(fallbackCause);
        }
      }
      throw cause;
    }
  }
  return async function collect(solution: Solution, side: SolutionSide) {
    const gaps: EvidenceGap[] = [];
    const evidence: Evidence[] = [];
    const add = (code: EvidenceGap["code"]) => gaps.push({ code, solution: side });
    const cite = (citation: Citation) => evidence.push({
      ...citation, id: crypto.randomUUID(), solution: side, retrievedAt: new Date().toISOString(),
    });
    let identity: Identity = { solution: side, state: "missing", records: [] };
    let chemical: Compound | undefined;
    let cas = solution.cas;
    try {
      const match = await identityOf(solution);
      cas = match.cas;
      identity = {
        solution: side, state: match.state,
        records: match.records.map(({ CID, Title, MolecularFormula, MolecularWeight, ConnectivitySMILES }) =>
          ({ cid: CID, name: Title, formula: MolecularFormula, molecularWeight: MolecularWeight, smiles: ConnectivitySMILES })),
      };
      if (match.unverified) add("identifierUnverified");
      if (match.state === "matched") {
        chemical = match.records[0];
        cite({
          source: "PubChem", kind: "identity", title: chemical.Title,
          url: pubchem + "/compound/" + chemical.CID,
          excerpt: [
            "CID " + chemical.CID, chemical.MolecularFormula,
            chemical.MolecularWeight && chemical.MolecularWeight + " g/mol",
            chemical.ConnectivitySMILES && "SMILES " + chemical.ConnectivitySMILES,
          ].filter(Boolean).join(" · "),
        });
        if (cas === unknown) {
          try {
            cas = await compoundCas(chemical.CID);
          } catch {
            add("identifierUnverified");
          }
        }
        for (const citation of await pubchemSafety(chemical)) cite(citation);
      }
    } catch {
      add("pubchemUnavailable");
    }
    if (identity.state !== "matched") add("identity");
    try {
      const references = await collectNiosh(cas, chemical, side);
      if (!references.length) add("nioshNoRecord");
      for (const citation of references) cite(citation);
    } catch {
      add("nioshUnavailable");
    }
    for (const field of ["concentration", "solvent", "state", "temperature", "quantity"] as const) {
      if (solution[field] === unknown) add(field);
    }
    if (!evidence.some((value) => value.kind === "hazard")) add("hazards");
    if (!evidence.some((value) => value.kind === "incompatibility")) add("incompatibilities");
    return { identity, evidence, gaps };
  };
}
