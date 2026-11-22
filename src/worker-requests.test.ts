import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import worker, { type Env } from "../worker";
import { blankSolution } from "./domain";

const collection = "/api/requests";
const sample = { ...blankSolution, name: "Documented sample" };
const input = { a: sample, b: { ...sample, name: "عينة ثانية" }, conditions: "" };
const jsonHeaders = { "Content-Type": "application/json" };
let db: DatabaseSync;
let env: Env;
let clientNumber = 1;

function testDatabase(database: DatabaseSync): Env["DB"] {
  // Use SQLite for SQL, constraints and rollback. The adapter mirrors the D1 methods used by the API.
  function prepare(sql: string, values: SQLInputValue[] = []) {
    return {
      bind: (...params: SQLInputValue[]) => prepare(sql, params),
      all: () => ({ results: database.prepare(sql).all(...values) }),
      first: () => database.prepare(sql).get(...values) ?? null,
      run: () => database.prepare(sql).run(...values),
      execute: () => {
        const statement = database.prepare(sql);
        if (statement.columns().length) return { results: statement.all(...values) };
        return { results: [], meta: statement.run(...values) };
      },
    };
  }
  return {
    prepare,
    withSession: () => ({ prepare }),
    batch(statements: ReturnType<typeof prepare>[]) {
      database.exec("BEGIN");
      try {
        const results = statements.map((statement) => statement.execute());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as Env["DB"];
}

function testLimiter(max: number) {
  const counts = new Map<string, number>();
  return {
    async limit({ key }: { key: string }) {
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return { success: count <= max };
    },
  };
}

async function call(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  if (!headers.has("CF-Connecting-IP")) {
    headers.set("CF-Connecting-IP", `2001:db8::${(clientNumber++).toString(16)}`);
  }
  return worker.fetch(new Request(`https://example.test${path}`, { ...init, headers }), env);
}

function post(data: unknown, headers: HeadersInit = jsonHeaders) {
  return call(collection, { method: "POST", headers, body: JSON.stringify(data) });
}

async function migrate(file: string) {
  const sql = await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8");
  db.exec(sql);
}

describe("public request API", () => {
  beforeAll(async () => {
    db = new DatabaseSync(":memory:");
    env = {
      DB: testDatabase(db),
      SUBMISSION_LIMIT: testLimiter(5),
      TRACKING_LIMIT: testLimiter(30),
    } as Env;
    await migrate("0001_initial.sql");
    const health = await call("/api/health");
    expect(health.status).toBe(503);
    expect(await health.json()).toMatchObject({ submission: false, tracking: false });
    await migrate("0002_public_request_tracking.sql");
    await migrate("0003_public_assessment_workflow.sql");
  });

  afterAll(() => {
    db?.close();
  });

  it("reports intake and tracking readiness with the migrated database", async () => {
    const response = await call("/api/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      mode: "public-assessment",
      submission: true,
      tracking: true,
      identification: false,
      review: false,
      agent: "disabled",
    });
  });

  it("stores the submitted data and only a SHA-256 digest of the token", async () => {
    const response = await post(input);
    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const receipt = await response.json();
    expect(receipt.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(receipt.trackingToken).toMatch(/^[0-9a-f]{64}$/);
    expect(receipt.status).toBe("Submitted");
    expect(receipt.createdAt).toBe(receipt.updatedAt);
    expect(response.headers.get("Location")).toBe(`${collection}/${receipt.id}`);

    const stored = db.prepare(
      "SELECT * FROM public_requests JOIN public_request_tokens ON request_id = id WHERE id = ?",
    ).get(receipt.id);
    expect(stored?.status).toBe("Submitted");
    expect(JSON.parse(String(stored?.input_json))).toEqual(input);
    expect(stored?.token_sha256).toBe(createHash("sha256").update(receipt.trackingToken).digest("hex"));
    expect(JSON.stringify(stored)).not.toContain(receipt.trackingToken);
  });

  it("lets only the matching bearer token read receipt metadata", async () => {
    const { id, trackingToken, createdAt, updatedAt } = await (await post(input)).json();
    const other = await (await post(input)).json();
    expect(other.id).not.toBe(id);
    expect(other.trackingToken).not.toBe(trackingToken);

    const authorization = { Authorization: `Bearer ${trackingToken}` };
    const path = `${collection}/${id}`;
    const response = await call(path, { headers: authorization });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ id, status: "Submitted", createdAt, updatedAt });

    for (const attempt of [
      await call(path),
      await call(path, { headers: { Authorization: "Basic fake" } }),
      await call(path, { headers: { Authorization: `Bearer ${other.trackingToken}` } }),
      await call(`${collection}/${randomUUID()}`, { headers: authorization }),
      await call(`${path}?token=${trackingToken}`),
    ]) {
      expect(attempt.status).toBe(404);
      expect(await attempt.json()).toEqual({ error: "NOT_FOUND" });
    }
    expect((await call(collection)).status).toBe(405);
  });

  it("keeps requests without a token record inaccessible", async () => {
    const id = randomUUID();
    const timestamp = new Date().toISOString();
    db.prepare("INSERT INTO public_requests VALUES (?, ?, 'Submitted', ?, ?)")
      .run(id, JSON.stringify(input), timestamp, timestamp);
    const response = await call(`${collection}/${id}`, {
      headers: { Authorization: `Bearer ${"0".repeat(64)}` },
    });
    expect(response.status).toBe(404);
  });

  it.each([
    { ...input, status: "Approved" },
    { ...input, a: { ...input.a, reviewerId: "fake" } },
    { ...input, a: { ...input.a, concentration: "0x10", unit: "g/L" } },
    { ...input, a: { ...input.a, concentration: "101", unit: "% v/v" } },
    { ...input, b: { ...input.b, cas: "64-17-6" } },
    { ...input, b: { ...input.b, quantity: "0.5" } },
    { ...input, b: { ...input.b, temperature: "-274" } },
    { ...input, b: { ...input.b, notes: "x".repeat(2001) } },
    { a: input.a, conditions: "" },
    [],
    null,
  ].map((data) => ({ data })))("rejects invalid input %#", async ({ data }) => {
    const response = await post(data);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "INVALID_REQUEST" });
  });

  it("enforces the media type, UTF-8 and byte limit", async () => {
    expect((await post(input, { "Content-Type": "text/plain" })).status).toBe(415);
    expect((await post(input, { "Content-Type": "application/json; charset=latin1" })).status).toBe(415);
    expect((await post(input, { ...jsonHeaders, "Content-Encoding": "gzip" })).status).toBe(415);
    expect((await post(input, { "Content-Type": "application/json; charset=UTF-8" })).status).toBe(201);
    const body = (body: BodyInit, headers: HeadersInit = jsonHeaders) =>
      call(collection, { method: "POST", headers, body });
    expect((await body("{")).status).toBe(400);
    expect((await body(new Uint8Array([0x22, 0xff, 0x22]))).status).toBe(400);
    expect((await body("{}", { ...jsonHeaders, "Content-Length": "32769" })).status).toBe(413);
    const json = JSON.stringify(input);
    const padded = json + " ".repeat(32768 - Buffer.byteLength(json));
    expect((await body(padded)).status).toBe(201);
    expect((await body(padded + " ")).status).toBe(413);
    expect((await body(padded + " ", { ...jsonHeaders, "Content-Length": "2" })).status).toBe(413);
  });

  it("limits submission and tracking separately by Cloudflare client IP", async () => {
    const headers = { ...jsonHeaders, "CF-Connecting-IP": "192.0.2.10" };
    for (let i = 0; i < 5; i++) expect((await post(input, headers)).status).toBe(201);
    const blocked = await post(input, headers);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBe("60");

    const path = `${collection}/${randomUUID()}`;
    for (let i = 0; i < 30; i++) expect((await call(path, { headers })).status).toBe(404);
    expect((await call(path, { headers })).status).toBe(429);
    expect((await post(input)).status).toBe(201);
  });

  it("rolls back the request when the token insert fails", async () => {
    const count = () => db.prepare("SELECT COUNT(*) AS count FROM public_requests").get()?.count;
    const originalCount = count();
    db.exec(
      `CREATE TRIGGER test_fail_token BEFORE INSERT ON public_request_tokens
       BEGIN SELECT RAISE(ABORT, 'test failure'); END`,
    );
    try {
      const response = await post(input);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "SERVICE_UNAVAILABLE" });
      expect(count()).toBe(originalCount);
    } finally {
      db.exec("DROP TRIGGER test_fail_token");
    }
  });
});


const accessIssuer = "https://aetheris-test.cloudflareaccess.com";
const accessAudience = "test-audience";
const reviewer = "reviewer@example.test";
const approvalNotes = "Private laboratory review notes";
const documented = {
  a: { ...blankSolution, name: "Glycerol", formula: "C3H8O3", notes: "Private sample note" },
  b: { ...blankSolution, name: "Unknown", formula: "H2O", cas: "7732-18-5" },
  conditions: "Private conditions",
};

function track(receipt: { id: string; trackingToken: string }, token = receipt.trackingToken) {
  return call(collection + "/" + receipt.id, { headers: { Authorization: "Bearer " + token } });
}

const scheduled = () => worker.scheduled({} as Parameters<typeof worker.scheduled>[0], env);

describe("assessment and reviewer workflow", () => {
  let signingKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
  let jwk: Awaited<ReturnType<typeof exportJWK>>;
  let token: string;
  let mockFetch: ReturnType<typeof vi.fn<typeof fetch>>;
  let onLookup: (() => Promise<void>) | undefined;
  let badOutput = false;
  const objects = new Map<string, Blob>();

  async function assertion(email = reviewer, audience = accessAudience, expired = false) {
    return new SignJWT({ email, type: "app" }).setProtectedHeader({ alg: "RS256", kid: "test" })
      .setIssuer(accessIssuer).setAudience(audience).setSubject("reviewer-identity")
      .setIssuedAt().setExpirationTime(expired ? 1 : "5m").sign(signingKey);
  }

  function adminCall(path: string, body?: unknown, accessToken = token, origin = "https://example.test") {
    return call("/api/admin/" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Cf-Access-Jwt-Assertion": accessToken,
        ...(body === undefined ? {} : { ...jsonHeaders, Origin: origin }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  beforeAll(async () => {
    const keys = await generateKeyPair("RS256");
    signingKey = keys.privateKey;
    jwk = { ...await exportJWK(keys.publicKey), kid: "test", alg: "RS256" };
  });

  beforeEach(async () => {
    db = new DatabaseSync(":memory:");
    objects.clear();
    onLookup = undefined;
    badOutput = false;
    env = {
      DB: testDatabase(db),
      SUBMISSION_LIMIT: testLimiter(5),
      TRACKING_LIMIT: testLimiter(30),
      ADMIN_ORIGIN: "https://example.test",
      CF_ACCESS_TEAM_DOMAIN: "aetheris-test.cloudflareaccess.com",
      CF_ACCESS_AUD: accessAudience,
      REVIEWER_EMAILS: reviewer,
      AGENT_ENABLED: "true",
      IMAGES: {
        put: async (key: string, file: ArrayBuffer) => objects.set(key, new Blob([file])),
        get: async (key: string) => objects.has(key)
          ? { body: objects.get(key)?.stream() } : null,
        delete: async (key: string) => objects.delete(key),
      },
    } as unknown as Env;
    await migrate("0002_public_request_tracking.sql");
    await migrate("0003_public_assessment_workflow.sql");
    token = await assertion();
    mockFetch = vi.fn<typeof fetch>(async (resource, options) => {
      const url = new URL(String(resource));
      if (url.href === accessIssuer + "/cdn-cgi/access/certs") return Response.json({ keys: [jwk] });
      // workerd only supports "follow" or "manual"; the agent must refuse redirected evidence.
      expect(options?.redirect).toBe("manual");
      if (url.hostname === "pubchem.ncbi.nlm.nih.gov") {
        if (url.pathname.includes("/compound/name/")) {
          await onLookup?.();
          const glycerol = url.pathname.includes("/Glycerol/");
          if (!glycerol && !url.pathname.includes("/7732-18-5/")) return new Response(null, { status: 404 });
          return Response.json({ PropertyTable: { Properties: [
            glycerol ? { CID: 753, Title: "Glycerol", MolecularFormula: "C3H8O3" }
              : { CID: 962, Title: "Water", MolecularFormula: "H2O" },
          ] } });
        }
        if (url.searchParams.get("heading") === "CAS") {
          return Response.json({ Record: { RecordNumber: 753, Section: [{
            TOCHeading: "CAS", Information: [{ Value: { StringWithMarkup: [{ String: "56-81-5" }] } }],
          }] } });
        }
        const recordNumber = url.pathname.includes("/753/") ? 753 : 962;
        return Response.json({ Record: { RecordNumber: recordNumber, Section: [] } });
      }
      if (url.href.endsWith("/npgdcas.html")) {
        return new Response("<tr><td>56-81-5</td><td><a href='npgd0302.html'>Glycerin (mist)</a></td></tr>");
      }
      if (url.href.endsWith("/npgd0302.html")) {
        const card = (heading: string, body: string) => '<div class="card-title h6">' + heading
          + '</div><div class="card-body"><div class="card-text">' + body + '</div></div>';
        return new Response(
          card("CAS No.", "56-81-5") + card("Symptoms", "Irritation"),
        );
      }
      if (url.href === "https://api.openai.com/v1/chat/completions") {
        const raw = String(options?.body);
        expect(raw).not.toContain(documented.a.notes);
        expect(raw).not.toContain(documented.conditions);
        const prompt = JSON.parse(raw);
        const context = JSON.parse(prompt.messages[1].content);
        const hazard = context.evidence.find(({ kind }: { kind: string }) => kind === "hazard");
        return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
          hazardEvidenceIds: [badOutput ? randomUUID() : hazard.id],
          pairConcernEvidenceIds: [],
          uncertainty: ["pairEvidenceMissing", "substanceOnly"],
          ...(badOutput ? { citation: "https://unverified.example/" } : {}),
        }) } }] });
      }
      throw new Error("Unexpected outbound request");
    });
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    db.close();
  });

  it("backfills existing Phase 3 requests with their original token and submission time", async () => {
    db.close();
    db = new DatabaseSync(":memory:");
    env.DB = testDatabase(db);
    await migrate("0002_public_request_tracking.sql");
    const receipt = await (await post(input)).json();
    await migrate("0003_public_assessment_workflow.sql");
    expect(await (await track(receipt)).json()).toEqual({
      id: receipt.id, status: "Submitted", createdAt: receipt.createdAt, updatedAt: receipt.updatedAt,
    });
    expect(db.prepare("SELECT status FROM public_request_status_history").get()?.status).toBe("Submitted");
  });

  it("rejects missing, unsigned, expired, wrong-audience, unlisted and cross-origin admin calls", async () => {
    for (const path of ["session", "requests", "requests/" + randomUUID() + "/images/" + randomUUID()]) {
      expect((await call("/api/admin/" + path)).status).toBe(401);
      expect((await adminCall(path, undefined, "forged")).status).toBe(401);
    }
    expect((await adminCall("requests", undefined, await assertion(reviewer, "other"))).status).toBe(401);
    expect((await adminCall("requests", undefined, await assertion(reviewer, accessAudience, true))).status).toBe(401);
    expect((await adminCall("requests", undefined, await assertion("outsider@example.test"))).status).toBe(403);
    expect((await adminCall("requests/" + randomUUID() + "/decision", {}, token, "https://elsewhere.test")).status).toBe(403);
    expect((await adminCall("session")).status).toBe(200);
    env.REVIEWER_EMAILS = undefined;
    expect((await adminCall("requests")).status).toBe(503);
  });

  it("runs the agent once, keeps evidence private, and publishes only the human decision to its token owner", async () => {
    env.AI_PROVIDER = "openai";
    env.AI_MODEL = "test-model";
    env.AGENT_API_KEY = "test-key";
    env.AGENT_SYSTEM_PROMPT = "Private test instructions";
    const receipt = await (await post(documented)).json();
    const path = "requests/" + receipt.id;
    let release!: () => void;
    let entered!: () => void;
    const pause = new Promise<void>((resolve) => { release = resolve; });
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    onLookup = () => { entered(); return pause; };
    const running = scheduled();
    await ready;
    await scheduled();
    expect(await (await track(receipt)).json()).toMatchObject({ status: "Analyzing" });
    expect(db.prepare("SELECT COUNT(*) AS count FROM public_agent_runs").get()?.count).toBe(1);
    release();
    await running;

    const privateDetail = await (await adminCall(path)).json();
    expect(privateDetail.input).toEqual(documented);
    expect(privateDetail.run.status).toBe("completed");
    expect(privateDetail.report.assessment).toMatchObject({
      hazardEvidenceIds: [expect.any(String)], pairConcernEvidenceIds: [],
      uncertainty: ["pairEvidenceMissing", "substanceOnly"],
    });
    expect(new Set(privateDetail.evidence.map((item: { source: string }) => item.source))).toEqual(new Set(["PubChem", "NIOSH"]));
    expect(JSON.stringify(privateDetail)).not.toContain(receipt.trackingToken);
    expect(JSON.stringify(privateDetail)).not.toContain(env.AGENT_SYSTEM_PROMPT);
    expect(await (await track(receipt)).json()).toEqual({
      id: receipt.id, status: "Pending Review", createdAt: receipt.createdAt, updatedAt: expect.any(String),
    });
    expect((await (await adminCall("requests?status=Pending%20Review")).json()).requests).toHaveLength(1);
    expect((await (await adminCall("requests?status=Approved")).json()).requests).toEqual([]);
    const review = {
      runId: privateDetail.run.id, decision: "Approved", notes: approvalNotes,
      result: {
        classification: "Insufficient information", conditions: "Documented sample specifications",
        hazards: [], incompatibilities: [], storage: "Not assessed", container: "Not assessed",
        limitations: ["No formulation-specific evidence"], evidenceIds: [privateDetail.evidence[0].id],
        externalSources: [], attestation: true,
      },
    };
    expect((await adminCall(path + "/decision", { ...review, runId: randomUUID() })).status).toBe(400);
    expect((await adminCall(path + "/decision", {
      ...review, result: { ...review.result, classification: "Compatible under documented conditions" },
    })).status).toBe(400);
    expect((await adminCall(path + "/decision", {
      ...review, result: { ...review.result, attestation: false },
    })).status).toBe(400);
    expect((await call("/api/admin/" + path + "/decision", {
      method: "POST", headers: { ...jsonHeaders, Authorization: "Bearer " + receipt.trackingToken },
      body: JSON.stringify(review),
    })).status).toBe(401);

    const replies = await Promise.all([
      adminCall(path + "/decision", review), adminCall(path + "/decision", review),
    ]);
    expect(replies.map(({ status }) => status).sort()).toEqual([200, 409]);
    const published = await (await track(receipt)).json();
    expect(published).toMatchObject({
      status: "Approved",
      result: { classification: "Insufficient information", conditions: review.result.conditions },
    });
    for (const secret of [approvalNotes, reviewer, "hazardEvidenceIds", documented.a.notes, receipt.trackingToken]) {
      expect(JSON.stringify(published)).not.toContain(secret);
    }
    const other = await (await post(input)).json();
    expect((await track(receipt, other.trackingToken)).status).toBe(404);
    expect((await track(other, receipt.trackingToken)).status).toBe(404);
    expect((await (await track(other)).json()).result).toBeUndefined();

    const reviewed = await (await adminCall(path)).json();
    expect(reviewed.review.notes).toBe(approvalNotes);
    expect(reviewed.history.map(({ status }: { status: string }) => status)).toEqual([
      "Submitted", "Analyzing", "Pending Review", "Approved",
    ]);
    expect(mockFetch.mock.calls.filter(([url]) => String(url).startsWith("https://api.openai.com/"))).toHaveLength(1);
  });

  it.each(["Rejected", "Needs More Information"])("reports %s without notes or draft when AI is unconfigured", async (decision) => {
    const receipt = await (await post(documented)).json();
    const path = "requests/" + receipt.id;
    await scheduled();
    const auxiliary = await (await adminCall(path)).json();
    expect(auxiliary.run.status).toBe("unconfigured");
    expect(auxiliary.report.assessment).toBeNull();
    expect(auxiliary.evidence.length).toBeGreaterThan(0);
    expect(mockFetch.mock.calls.some(([url]) => String(url).startsWith("https://api.openai.com/"))).toBe(false);
    expect((await adminCall(path + "/decision", {
      runId: auxiliary.run.id, decision, notes: approvalNotes,
    })).status).toBe(200);
    expect(await (await track(receipt)).json()).toEqual({
      id: receipt.id, status: decision, createdAt: receipt.createdAt, updatedAt: expect.any(String),
    });
  });

  it("discards malformed model output and allows a single guarded retry", async () => {
    env.AI_PROVIDER = "openai";
    env.AI_MODEL = "test-model";
    env.AGENT_API_KEY = "test-key";
    env.AGENT_SYSTEM_PROMPT = "Private test instructions";
    badOutput = true;
    const receipt = await (await post(documented)).json();
    const path = "requests/" + receipt.id;
    await scheduled();
    const failed = await (await adminCall(path)).json();
    expect(failed.run).toMatchObject({ status: "failed", failureCode: "AI_UNAVAILABLE_OR_INVALID" });
    expect(failed.report.assessment).toBeNull();
    expect(JSON.stringify(failed)).not.toContain("unverified.example");
    expect((await adminCall(path + "/retry", { runId: failed.run.id })).status).toBe(200);
    expect((await adminCall(path + "/retry", { runId: failed.run.id })).status).toBe(409);
    badOutput = false;
    await scheduled();
    const retried = await (await adminCall(path)).json();
    expect(retried.run.status).toBe("completed");
    expect(retried.run.id).not.toBe(failed.run.id);
    expect((await adminCall(path + "/decision", {
      runId: failed.run.id, decision: "Rejected", notes: approvalNotes,
    })).status).toBe(409);
  });

  it("keeps attached images in private R2 and verifies MIME and request association", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCfQAAAAASUVORK5CYII=",
      "base64",
    );
    function submission(bytes: Uint8Array<ArrayBuffer>, type: string) {
      const body = new FormData();
      body.set("input", JSON.stringify(documented));
      body.set("imageA", new File([bytes], "private-label.png", { type }));
      return call(collection, { method: "POST", body });
    }
    expect((await post(documented, { ...jsonHeaders, Origin: "https://elsewhere.test" })).status).toBe(403);
    expect((await submission(new Uint8Array([1]), "image/png")).status).toBe(400);
    expect((await submission(new Uint8Array(png), "image/svg+xml")).status).toBe(400);
    const response = await submission(new Uint8Array(png), "image/png");
    expect(response.status).toBe(201);
    const receipt = await response.json();
    expect(JSON.stringify(await (await track(receipt)).json())).not.toContain("image");
    const path = "requests/" + receipt.id;
    const { images } = await (await adminCall(path)).json();
    expect(images).toEqual([{ id: expect.any(String), solution: "A" }]);
    const imageRoute = path + "/images/" + images[0].id;
    expect(objects.size).toBe(1);
    expect((await call("/api/admin/" + imageRoute, { headers: { Authorization: "Bearer " + receipt.trackingToken } })).status).toBe(401);
    expect((await adminCall("requests/" + randomUUID() + "/images/" + images[0].id)).status).toBe(404);
    const image = await adminCall(imageRoute);
    expect(image.headers.get("Content-Type")).toBe("image/png");
    expect(image.headers.get("Cache-Control")).toBe("no-store");
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(new Uint8Array(png));
  });
});
