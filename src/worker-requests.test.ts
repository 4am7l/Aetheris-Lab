import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import worker, { type Env } from "../worker";
import { blankSolution } from "./domain";
import dilutionBenchmark from "../tests/fixtures/methanol-dilution.json";

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

async function call(path: string, init?: RequestInit, origin = "https://example.test") {
  const headers = new Headers(init?.headers);
  if (!headers.has("CF-Connecting-IP")) {
    headers.set("CF-Connecting-IP", `2001:db8::${(clientNumber++).toString(16)}`);
  }
  return worker.fetch(new Request(origin + path, { ...init, headers }), env);
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

  it("only allows explicitly configured public origins and endpoint-specific CORS headers", async () => {
    const allowed = "https://aetheris-lab.pages.dev";
    const blocked = "https://preview.aetheris-lab.pages.dev";
    env.PUBLIC_ORIGINS = allowed;
    try {
      const preflight = (pathname: string, origin: string, method: string, headers: string) =>
        call(pathname, {
          method: "OPTIONS",
          headers: {
            Origin: origin,
            "Access-Control-Request-Method": method,
            "Access-Control-Request-Headers": headers,
          },
        });
      const intake = await preflight(collection, allowed, "POST", "Content-Type");
      expect(intake.status).toBe(204);
      expect(intake.headers.get("Access-Control-Allow-Origin")).toBe(allowed);
      expect(intake.headers.get("Access-Control-Allow-Methods")).toBe("POST");
      expect(intake.headers.get("Access-Control-Allow-Headers")).toBe("content-type");
      expect(intake.headers.has("Access-Control-Allow-Credentials")).toBe(false);

      const submitted = await post(input, { ...jsonHeaders, Origin: allowed });
      expect(submitted.status).toBe(201);
      expect(submitted.headers.get("Access-Control-Allow-Origin")).toBe(allowed);
      const { id, trackingToken } = await submitted.json();
      const path = collection + "/" + id;
      const tracking = await preflight(path, allowed, "GET", "Authorization");
      expect(tracking.status).toBe(204);
      expect(tracking.headers.get("Access-Control-Allow-Headers")).toBe("authorization");
      const receipt = await call(path, { headers: { Origin: allowed, Authorization: "Bearer " + trackingToken } });
      expect(receipt.status).toBe(200);
      expect(receipt.headers.get("Vary")).toContain("Origin");

      for (const rejected of [
        await preflight(collection, blocked, "POST", "Content-Type"),
        await preflight(collection, allowed, "POST", "Content-Type, X-Aetheris-Admin-Proxy"),
        await preflight(path, allowed, "POST", "Authorization"),
        await post(input, { ...jsonHeaders, Origin: blocked }),
        await call(path, { headers: { Origin: blocked, Authorization: "Bearer " + trackingToken } }),
      ]) {
        expect(rejected.status).toBe(403);
        expect(rejected.headers.has("Access-Control-Allow-Origin")).toBe(false);
      }
    } finally {
      delete env.PUBLIC_ORIGINS;
    }
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


const adminOrigin = "https://aetheris-admin.pages.dev";
const adminPrefix = "/api/admin/";
const proxySecret = "1".repeat(64);
const sessionCookie = "__Host-aetheris-session";
const reviewer = { login: "admin" };
const reviewerActor = "password:admin";
// Test-only values. Production passwords are chosen in Cloudflare, never in source.
const password = "Test only: reviewer passphrase! 42";
const wrongPassword = "Test only: incorrect password! 42";
const nativePasswordComparison = vi.fn(timingSafeEqual);
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
  let session: string;
  let csrfToken: string;
  let mockFetch: ReturnType<typeof vi.fn<typeof fetch>>;
  let warn: MockInstance<typeof console.warn>;
  let onLookup: (() => Promise<void>) | undefined;
  let badOutput = false;
  const objects = new Map<string, Blob>();

  beforeAll(() => {
    // Node lacks Workers' SubtleCrypto extension; use Node's native equivalent in tests.
    Object.defineProperty(crypto.subtle, "timingSafeEqual", { configurable: true, value: nativePasswordComparison });
  });

  afterAll(() => {
    Reflect.deleteProperty(crypto.subtle, "timingSafeEqual");
  });

  function reviewerRequest(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("X-Aetheris-Admin-Proxy", proxySecret);
    if (!headers.has("X-Aetheris-Admin-Client-IP")) {
      headers.set("X-Aetheris-Admin-Client-IP", `2001:db8::${(clientNumber++).toString(16)}`);
    }
    return call(adminPrefix + path, { ...init, headers }, adminOrigin);
  }

  function adminCall(path: string, body?: unknown, cookie = session, origin = adminOrigin, csrf = csrfToken) {
    return reviewerRequest(path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Cookie: cookie,
        ...(body === undefined ? {} : { ...jsonHeaders, Origin: origin, "X-CSRF-Token": csrf }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  function mockGemini(implementation: typeof fetch) {
    const fetchSources = mockFetch.getMockImplementation()!;
    const gemini = vi.fn<typeof fetch>(implementation);
    mockFetch.mockImplementation((resource, options) =>
      String(resource).startsWith("https://generativelanguage.googleapis.com/")
        ? gemini(resource, options)
        : fetchSources(resource, options));
    return gemini;
  }

  function geminiCompletion(options?: RequestInit) {
    const request = JSON.parse(String(options?.body));
    const context = JSON.parse(request.contents[0].parts[0].text);
    const findings = context.findings.map(({ code }: { code: string }) => code);
    return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ findings }) }] } }] });
  }

  function browserCookie(response: Response, name: string) {
    return response.headers.getSetCookie().find((value) => value.startsWith(name + "="));
  }

  function login(data: unknown, headers: HeadersInit = { ...jsonHeaders, Origin: adminOrigin }) {
    return reviewerRequest("auth/login", {
      method: "POST", headers, body: JSON.stringify(data),
    });
  }

  async function signIn(value = password, previousSession = "") {
    const response = await login({ password: value }, { ...jsonHeaders, Origin: adminOrigin, Cookie: previousSession });
    expect(response.status).toBe(200);
    const cookie = browserCookie(response, sessionCookie) ?? "";
    const browserSession = cookie.split(";", 1)[0];
    const body = await response.clone().json() as { reviewer: typeof reviewer; csrfToken: string };
    return { response, cookie, session: browserSession, ...body };
  }

  beforeEach(async () => {
    db = new DatabaseSync(":memory:");
    objects.clear();
    onLookup = undefined;
    badOutput = false;
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    env = {
      DB: testDatabase(db),
      SUBMISSION_LIMIT: testLimiter(5),
      TRACKING_LIMIT: testLimiter(30),
      ADMIN_ORIGIN: adminOrigin,
      ADMIN_PROXY_SECRET: proxySecret,
      ADMIN_PASSWORD: password,
      AGENT_ENABLED: "true",
      IMAGES: {
        put: async (key: string, file: ArrayBuffer) => objects.set(key, new Blob([file])),
        get: async (key: string) => objects.has(key)
          ? { body: objects.get(key)?.stream() } : null,
        delete: async (keys: string | string[]) => {
          for (const key of [keys].flat()) objects.delete(key);
        },
      },
    } as unknown as Env;
    await migrate("0002_public_request_tracking.sql");
    await migrate("0003_public_assessment_workflow.sql");
    await migrate("0004_admin_auth.sql");
    await migrate("0005_admin_password.sql");
    await migrate("0006_admin_request_management.sql");
    mockFetch = vi.fn<typeof fetch>(async (resource, options) => {
      const url = new URL(String(resource));
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
          card("CAS No.", "56-81-5") + card("Symptoms", "Irritation")
          + "<div Class='card-title h6'>Solubility</div><div class='card-body'><div class='card-text'>Miscible</div></div>",
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
    ({ session, csrfToken } = await signIn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    db.close();
  });

  it("backfills Phase 3 requests and revokes legacy OAuth sessions during migration", async () => {
    db.close();
    db = new DatabaseSync(":memory:");
    env.DB = testDatabase(db);
    await migrate("0002_public_request_tracking.sql");
    const receipt = await (await post(input)).json();
    await migrate("0003_public_assessment_workflow.sql");
    await migrate("0004_admin_auth.sql");
    const legacyCookie = "a".repeat(64);
    db.prepare("INSERT INTO admin_sessions VALUES (?, ?, ?, ?)").run(
      createHash("sha256").update(legacyCookie).digest("hex"), "451", "legacy-reviewer", 2147483647,
    );
    await migrate("0005_admin_password.sql");
    await migrate("0006_admin_request_management.sql");
    expect(await (await track(receipt)).json()).toEqual({
      id: receipt.id, status: "Submitted", createdAt: receipt.createdAt, updatedAt: receipt.updatedAt,
    });
    expect(db.prepare("SELECT status FROM public_request_status_history").get()?.status).toBe("Submitted");
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'admin_oauth_states'").get()).toBeUndefined();
    expect((await adminCall("session", undefined, `${sessionCookie}=${legacyCookie}`)).status).toBe(401);
  });

  it("checks the proxy, exact origin and reviewer session before admin resource access", async () => {
    const request = "requests/" + randomUUID();
    for (const path of ["session", "requests", request, request + "/images/" + randomUUID()]) {
      const missing = await reviewerRequest(path);
      expect(missing.status).toBe(401);
      expect(missing.headers.get("Cache-Control")).toBe("no-store");
      expect(missing.headers.has("Access-Control-Allow-Origin")).toBe(false);
      expect((await adminCall(path, undefined, sessionCookie + "=" + "f".repeat(64))).status).toBe(401);
    }
    for (const path of [request + "/retry", request + "/decision", "auth/logout"]) {
      expect((await adminCall(path, {}, "")).status).toBe(401);
    }
    expect((await reviewerRequest("requests", {
      headers: { "Cf-Access-Jwt-Assertion": "legacy-assertion" },
    })).status).toBe(401);
    expect((await call(adminPrefix + "session", { headers: { Cookie: session } }, adminOrigin)).status).toBe(403);
    expect((await call(adminPrefix + "session", {
      headers: { Cookie: session, "X-Aetheris-Admin-Proxy": "f".repeat(64) },
    }, adminOrigin)).status).toBe(403);
    expect((await call(adminPrefix + "session", {
      headers: { Cookie: session, "X-Aetheris-Admin-Proxy": proxySecret, Origin: adminOrigin },
    }, "https://aetheris-lab-api.4am7l.workers.dev")).status).toBe(403);

    const foreign = "https://preview.aetheris-admin.pages.dev";
    for (const rejected of [
      await reviewerRequest("requests", { headers: { Cookie: session, Origin: foreign } }),
      await adminCall(request + "/decision", {}, session, foreign),
      await reviewerRequest("auth/logout", { method: "POST", headers: { Cookie: session } }),
      await reviewerRequest("requests", {
        method: "OPTIONS",
        headers: { Origin: foreign, "Access-Control-Request-Method": "GET" },
      }),
    ]) {
      expect(rejected.status).toBe(403);
      expect(rejected.headers.has("Access-Control-Allow-Origin")).toBe(false);
    }
    expect(await (await adminCall("session")).json()).toEqual({ reviewer, csrfToken });
  });

  it.each([undefined, ""])("fails closed for missing or empty ADMIN_PASSWORD (%s)", async (value) => {
    env.ADMIN_PASSWORD = value;
    const count = db.prepare("SELECT COUNT(*) AS count FROM admin_sessions").get()?.count;
    for (const response of [await login({ password }), await adminCall("session"), await adminCall("requests")]) {
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "SERVICE_UNAVAILABLE" });
      expect(response.headers.getSetCookie()).toEqual([]);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
    expect(db.prepare("SELECT COUNT(*) AS count FROM admin_sessions").get()?.count).toBe(count);
  });

  it.each(["x", "  spaces stay significant  ", "كلمة مرور 🔐 café", "x".repeat(128)])(
    "accepts the exact chosen password without the old generator format (%s)", async (chosen) => {
      env.ADMIN_PASSWORD = chosen;
      const signedIn = await signIn(chosen);
      expect((await adminCall("session", undefined, signedIn.session)).status).toBe(200);
      expect((await login({ password: chosen + "x" })).status).toBe(401);
    },
  );

  it("uses a native timing-safe comparison for matches, mismatches and different lengths", async () => {
    for (const value of [password, wrongPassword, password.slice(1), password + "x", ""]) {
      nativePasswordComparison.mockClear();
      const response = await login({ password: value });
      expect(response.status).toBe(value === password ? 200 : 401);
      expect(nativePasswordComparison).toHaveBeenCalledTimes(1);
      const [candidate, expected] = nativePasswordComparison.mock.calls[0];
      expect(candidate.byteLength).toBe(expected.byteLength);
      if (response.status === 401) expect(response.headers.getSetCookie()).toEqual([]);
    }
  });

  it("verifies the password and issues an independent host-only session", async () => {
    const signedIn = await signIn();
    expect(signedIn.reviewer).toEqual(reviewer);
    expect(signedIn.csrfToken).toBeTruthy();
    expect(signedIn.csrfToken).not.toBe(csrfToken);
    expect(signedIn.session).not.toBe(session);
    expect(signedIn.response.headers.get("Cache-Control")).toBe("no-store");
    expect(signedIn.response.headers.get("Location")).toBeNull();
    expect(signedIn.cookie).toContain("; Secure");
    expect(signedIn.cookie).toContain("; HttpOnly");
    expect(signedIn.cookie).toContain("; SameSite=Strict");
    expect(signedIn.cookie).toContain("; Path=/");
    expect(signedIn.cookie).toContain("; Max-Age=28800");
    expect(signedIn.cookie).not.toContain("Domain=");
    const raw = signedIn.session.split("=", 2)[1];
    expect(raw).toMatch(/^[a-f0-9]{64}$/);
    const stored = db.prepare("SELECT * FROM admin_sessions").all();
    expect(stored).toHaveLength(2);
    for (const row of stored) expect(row.token_sha256).toMatch(/^[a-f0-9]{64}$/);
    for (const credential of [raw, password]) {
      expect(JSON.stringify(stored)).not.toContain(credential);
    }
    expect(JSON.stringify(db.prepare("SELECT * FROM admin_login_attempts").all())).not.toContain(password);
    expect(JSON.stringify(await signedIn.response.clone().json())).not.toContain(password);
    expect(JSON.stringify([...signedIn.response.headers])).not.toContain(password);
    expect(await (await adminCall("session", undefined, signedIn.session)).json()).toEqual({
      reviewer, csrfToken: signedIn.csrfToken,
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("accepts only same-origin JSON password submissions and rejects invalid credentials", async () => {
    const get = await reviewerRequest("auth/login");
    expect(get.status).toBe(405);
    expect(get.headers.get("Allow")).toBe("POST");
    expect((await reviewerRequest("auth/callback")).status).toBe(404);
    expect((await adminCall("auth/callback")).status).toBe(404);
    const failures = await Promise.all([
      login({ password: wrongPassword }),
      login({ password: 123 }),
      login({ password, login: reviewer.login }),
      login({ password }, { ...jsonHeaders, Origin: "https://preview.aetheris-admin.pages.dev" }),
      login({ password }, jsonHeaders),
      login({ password }, { "Content-Type": "text/plain", Origin: adminOrigin }),
      login({ password: "x".repeat(65536) }),
    ]);
    expect(failures.map(({ status }) => status)).toEqual([401, 400, 400, 403, 403, 415, 413]);
    expect(await failures[0].json()).toEqual({ error: "UNAUTHORIZED" });
    for (const failed of [get, ...failures]) {
      expect(failed.headers.getSetCookie()).toEqual([]);
      expect(failed.headers.get("Location")).toBeNull();
      expect(failed.headers.get("Cache-Control")).toBe("no-store");
    }
    expect(db.prepare("SELECT COUNT(*) AS count FROM admin_sessions").get()?.count).toBe(1);
    expect((await adminCall("session")).status).toBe(200);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("enforces the per-client cap when login attempts arrive concurrently", async () => {
    const headers = { ...jsonHeaders, Origin: adminOrigin, "X-Aetheris-Admin-Client-IP": "192.0.2.10" };
    const attempts = await Promise.all(Array.from({ length: 6 }, () => login({ password: wrongPassword }, headers)));
    expect(attempts.map(({ status }) => status).sort()).toEqual([401, 401, 401, 401, 401, 429]);
    const blocked = await login({ password }, { ...headers, "CF-Connecting-IP": "192.0.2.100" });
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "RATE_LIMITED" });
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(blocked.headers.getSetCookie()).toEqual([]);
    expect((await login({ password })).status).toBe(200);
    db.prepare("UPDATE admin_login_attempts SET attempted_at = 0").run();
    expect((await login({ password }, headers)).status).toBe(200);
  });

  it("limits password attempts across clients and recovers after the window", async () => {
    // The fixture sign-in already used one attempt in the shared window.
    const attempts = await Promise.all(Array.from({ length: 30 }, () => login({ password: wrongPassword })));
    expect(attempts.filter(({ status }) => status === 401)).toHaveLength(29);
    expect(attempts.filter(({ status }) => status === 429)).toHaveLength(1);
    expect((await login({ password })).status).toBe(429);
    db.prepare("UPDATE admin_login_attempts SET attempted_at = 0").run();
    expect((await login({ password })).status).toBe(200);
  });

  it("fails closed if password throttling is unavailable", async () => {
    db.exec("DROP TABLE admin_login_attempts");
    const response = await login({ password });
    expect(response.status).toBe(503);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) AS count FROM admin_sessions").get()?.count).toBe(1);
  });

  it("requires a CSRF token from the same session for admin mutations", async () => {
    const request = "requests/" + randomUUID();
    const other = await signIn();
    for (const path of [request + "/retry", request + "/decision", "auth/logout"]) {
      const missing = await reviewerRequest(path, {
        method: "POST", headers: { ...jsonHeaders, Origin: adminOrigin, Cookie: session }, body: "{}",
      });
      expect(missing.status).toBe(403);
      expect((await adminCall(path, {}, session, adminOrigin, other.csrfToken)).status).toBe(403);
    }
    expect((await adminCall("session")).status).toBe(200);
    expect((await adminCall("session", undefined, other.session)).status).toBe(200);
  });

  it("expires sessions and deletes them on logout", async () => {
    const logout = await adminCall("auth/logout", {});
    expect(logout.status).toBe(200);
    expect(browserCookie(logout, sessionCookie)).toContain("Max-Age=0");
    expect((await adminCall("session")).status).toBe(401);
    expect(db.prepare("SELECT COUNT(*) AS count FROM admin_sessions").get()?.count).toBe(0);

    ({ session, csrfToken } = await signIn());
    db.prepare("UPDATE admin_sessions SET expires_at = 0").run();
    expect((await adminCall("requests")).status).toBe(401);
  });

  it("replaces the previous session on a successful re-login in the same browser", async () => {
    const rotated = await signIn(password, session);
    expect(rotated.session).not.toBe(session);
    expect((await adminCall("session")).status).toBe(401);
    expect((await adminCall("session", undefined, rotated.session)).status).toBe(200);
    expect(db.prepare("SELECT COUNT(*) AS count FROM admin_sessions").get()?.count).toBe(1);
  });

  it.each([wrongPassword, password + "\0"])("invalidates prior sessions and mutations when only ADMIN_PASSWORD changes", async (newPassword) => {
    const other = await signIn();
    env.ADMIN_PASSWORD = newPassword;
    for (const old of [session, other.session]) {
      expect((await adminCall("session", undefined, old)).status).toBe(401);
      expect((await adminCall("requests", undefined, old)).status).toBe(401);
      expect((await adminCall("auth/logout", {}, old)).status).toBe(401);
      expect((await adminCall("requests/" + randomUUID() + "/decision", {}, old)).status).toBe(401);
    }
    expect((await login({ password })).status).toBe(401);
    const rotated = await signIn(newPassword);
    expect(await (await adminCall("session", undefined, rotated.session)).json()).toEqual({
      reviewer, csrfToken: rotated.csrfToken,
    });
  });

  it.each([
    ["signed multi-part report", null],
    ["inapplicable finding", "AI_INVALID_RESPONSE"],
    ["duplicate finding", "AI_INVALID_RESPONSE"],
    ["invented property", "AI_INVALID_RESPONSE"],
    ["missing safety assessment", "AI_INVALID_RESPONSE"],
    ["truncated response", "AI_INVALID_RESPONSE"],
    ["malformed JSON", "AI_INVALID_RESPONSE"],
    ["blocked response", "AI_REJECTED"],
    ["rate limit", "AI_RATE_LIMITED"],
    ["timeout", "AI_TIMEOUT"],
    ["provider unavailable", "AI_UNAVAILABLE"],
    ["network failure", "AI_UNAVAILABLE"],
    ["configuration error", "AI_CONFIGURATION"],
  ])("records a private Gemini %s outcome and keeps the deterministic draft", async (scenario, failureCode) => {
    env.AGENT_API_KEY = "test-gemini-key";
    const gemini = mockGemini(async (resource, options) => {
      expect(resource).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-4-hydrogen:generateContent");
      expect(new Headers(options?.headers).get("x-goog-api-key")).toBe("test-gemini-key");
      expect(options?.signal).toBeInstanceOf(AbortSignal);
      const raw = String(options?.body);
      expect(raw).not.toContain("test-gemini-key");
      const body = JSON.parse(raw);
      const context = JSON.parse(body.contents[0].parts[0].text);
      expect(context.calculation.result.analyticalMolPerL).toBeCloseTo(0.102, 14);
      expect(body.generationConfig).toMatchObject({
        candidateCount: 1, thinkingConfig: { thinkingLevel: "LOW", includeThoughts: false },
        responseMimeType: "application/json",
        responseJsonSchema: {
          properties: { findings: { items: { enum: expect.arrayContaining(["methanolBalance", "reviewRequired"]) } } },
          required: ["findings"], additionalProperties: false,
        },
      });
      expect(body.generationConfig.thinkingConfig).not.toHaveProperty("thinkingBudget");
      if (scenario === "rate limit") return new Response("private upstream detail", { status: 429 });
      if (scenario === "provider unavailable") return new Response("private upstream detail", { status: 503 });
      if (scenario === "network failure") throw new Error("private upstream detail test-gemini-key");
      if (scenario === "configuration error") return new Response("private upstream detail", { status: 403 });
      if (scenario === "timeout") throw new DOMException("private upstream detail", "TimeoutError");
      if (scenario === "blocked response") return Response.json({ promptFeedback: { blockReason: "SAFETY" } });
      const required = context.findings.filter((item: { required?: true }) => item.required)
        .map((item: { code: string }) => item.code).reverse();
      const findings = scenario === "inapplicable finding" ? [...required, "saltBalance"]
        : scenario === "duplicate finding" ? [...required, required[0]]
        : scenario === "missing safety assessment" ? required.filter((code: string) => code !== "reviewRequired")
        : required;
      const output = scenario === "malformed JSON" ? "{ bad JSON" : JSON.stringify({
        findings,
        ...(scenario === "invented property" ? { concentration: 42, citation: "https://unverified.example" } : {}),
      });
      return Response.json({ candidates: [{
        finishReason: scenario === "truncated response" ? "MAX_TOKENS" : "STOP",
        content: { parts: [
          { text: "private raw thought", thought: true, thoughtSignature: "private-signature" },
          { text: output.slice(0, 12), thoughtSignature: "private-signature" },
          { thoughtSignature: "private-signature" },
          { text: output.slice(12) },
        ] },
      }] });
    });
    const response = await post(dilutionBenchmark);
    expect(response.status).toBe(201);
    const receipt = await response.json();

    await Promise.all([scheduled(), scheduled()]);
    await scheduled();
    expect(gemini).toHaveBeenCalledOnce();
    const path = "requests/" + receipt.id;
    const detail = await (await adminCall(path)).json();
    expect(detail.run).toMatchObject({
      status: failureCode ? "failed" : "completed", provider: "gemini", model: "gemini-4-hydrogen", failureCode,
    });
    if (failureCode) {
      const httpStatus = { "rate limit": 429, "provider unavailable": 503, "configuration error": 403,
        "timeout": undefined, "network failure": undefined } as Record<string, number | undefined>;
      expect(warn).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        event: "gemini_assessment_failed", runId: detail.run.id, model: "gemini-4-hydrogen",
        failureCode, httpStatus: Object.hasOwn(httpStatus, scenario) ? httpStatus[scenario] : 200,
        stage: expect.any(String), elapsedMs: expect.any(Number), timeoutMs: 120_000,
      }));
      expect(JSON.stringify(warn.mock.calls)).not.toMatch(/private upstream detail|test-gemini-key/);
    } else {
      expect(warn).not.toHaveBeenCalled();
    }
    expect(detail.report.calculation.result.analyticalMolPerL).toBeCloseTo(0.102, 14);
    expect(detail.report.scientificReport).toMatchObject({
      version: 1, origin: failureCode ? "evidence-review" : "gemini",
      findings: expect.arrayContaining([{
        topic: "concentrations", code: "methanolBalance", basis: "calculated",
        referenceIds: ["method-1", "method-2", "method-3"],
      }]),
    });
    expect(JSON.stringify(detail)).not.toMatch(/private-signature|private raw thought|private upstream detail|test-gemini-key/);
    expect(await (await track(receipt)).json()).toEqual({
      id: receipt.id, status: "Pending Review", createdAt: receipt.createdAt, updatedAt: expect.any(String),
    });
    expect((await reviewerRequest(path, { headers: { Authorization: "Bearer " + receipt.trackingToken } })).status).toBe(401);
    expect((await call("/api/admin/" + path)).status).toBe(403);

    if (!failureCode) {
      expect(detail.report.scientificReport.findings[0].code).toBe("reviewRequired");
      expect((await adminCall(path + "/retry", { runId: detail.run.id })).status).toBe(409);
      const section = {
        topic: "concentrations", en: "Reviewer confirmed the nominal concentration of 0.102 mol/L.",
        ar: "تحقق المراجع من التركيز الاسمي البالغ 0.102 مول/لتر.",
        referenceIds: ["method-1"],
      };
      const review = {
        runId: detail.run.id, decision: "Approved", notes: approvalNotes,
        result: {
          classification: "Insufficient information", conditions: "Documented dilution conditions",
          hazards: [], incompatibilities: [], storage: "Not assessed", container: "Not assessed",
          limitations: ["Compatibility requires separate evidence"], evidenceIds: [],
          externalSources: [{ title: "OpenStax Chemistry 2e", url: "https://openstax.org/books/chemistry-2e/pages/3-3-molarity" }],
          scientificSections: [section], attestation: true,
        },
      };
      expect((await adminCall(path + "/decision", {
        ...review, result: { ...review.result, scientificSections: [{ ...section, referenceIds: [randomUUID()] }] },
      })).status).toBe(400);
      expect((await adminCall(path + "/decision", {
        ...review, result: { ...review.result, scientificSections: [{ ...section, ar: "" }] },
      })).status).toBe(400);
      expect((await (await track(receipt)).json()).result).toBeUndefined();
      expect((await adminCall(path + "/decision", review)).status).toBe(200);
      const published = await (await track(receipt)).json();
      expect(published).toMatchObject({
        status: "Approved", result: { scientificReport: [{
          topic: section.topic, en: section.en, ar: section.ar,
          sources: [{ title: "OpenStax Chemistry 2e, 3.3 Molarity", url: review.result.externalSources[0].url }],
        }] },
      });
      expect(JSON.stringify(published)).not.toMatch(/methanolBalance|measurementUncertainty|method-1|test-gemini-key|stockMolPerL/);
    }
  });

  it("grounds Gemini in matched sources, withholds private data, and keeps rejection private", async () => {
    env.AGENT_API_KEY = "test-gemini-key";
    const receipt = await (await post(documented)).json();
    const gemini = mockGemini(async (_resource, options) => {
      const raw = String(options?.body);
      for (const secret of [documented.a.notes, documented.conditions, receipt.trackingToken, env.ADMIN_PASSWORD]) {
        expect(raw).not.toContain(secret);
      }
      const body = JSON.parse(raw);
      const context = JSON.parse(body.contents[0].parts[0].text);
      expect(context.evidence).toEqual(expect.arrayContaining([
        expect.objectContaining({ source: "PubChem", excerpt: expect.stringContaining("C3H8O3") }),
        expect.objectContaining({ source: "NIOSH", excerpt: "Irritation" }),
        expect.objectContaining({ source: "NIOSH", title: "Glycerin (mist) · Solubility", excerpt: "Miscible" }),
      ]));
      const findings = context.findings.map(({ code }: { code: string }) => code);
      return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ findings }) }] } }] });
    });
    await scheduled();
    expect(gemini).toHaveBeenCalledOnce();
    const path = "requests/" + receipt.id;
    const detail = await (await adminCall(path)).json();
    expect(detail.report.scientificReport.origin).toBe("gemini");
    expect(detail.report.scientificReport.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "occupationalHazards", basis: "retrieved", referenceIds: [expect.any(String)] }),
    ]));
    expect((await adminCall(path + "/decision", { runId: detail.run.id, decision: "Rejected", notes: approvalNotes })).status).toBe(200);
    const published = await (await track(receipt)).json();
    expect(published.status).toBe("Rejected");
    expect(published.result).toBeUndefined();
    expect(JSON.stringify(published)).not.toContain(approvalNotes);
  });

  it.each(["slow success", "headers timeout", "body timeout"])("handles a Gemini %s with the 120-second deadline", async (scenario) => {
    env.AGENT_API_KEY = "test-gemini-key";
    const receipt = await (await post(documented)).json();
    const path = "requests/" + receipt.id;
    vi.useFakeTimers();
    let providerStarted!: () => void;
    const started = new Promise<void>((resolve) => { providerStarted = resolve; });
    const gemini = mockGemini(async (_resource, options) => {
      const signal = options!.signal!;
      providerStarted();
      if (scenario === "headers timeout") {
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      }
      if (scenario === "body timeout") {
        return new Response(new ReadableStream({
          start(controller) {
            signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
          },
        }));
      }
      await new Promise((resolve) => setTimeout(resolve, 119_999));
      return geminiCompletion(options);
    });

    const running = scheduled();
    await started;
    const checkpoint = await (await adminCall(path)).json();
    expect(checkpoint).toMatchObject({
      status: "Analyzing", canRetry: false, report: { scientificReport: { origin: "evidence-review" } },
      evidence: expect.arrayContaining([expect.objectContaining({ source: "PubChem" }), expect.objectContaining({ source: "NIOSH" })]),
    });
    for (const advance of [60_000, 59_998]) {
      await vi.advanceTimersByTimeAsync(advance);
      await scheduled();
      expect(gemini).toHaveBeenCalledOnce();
      expect(gemini.mock.calls[0][1]?.signal?.aborted).toBe(false);
      expect((await (await track(receipt)).json()).status).toBe("Analyzing");
    }
    const succeeded = scenario === "slow success";
    await vi.advanceTimersByTimeAsync(succeeded ? 1 : 2);
    await running;
    await scheduled();

    const result = await (await adminCall(path)).json();
    expect(gemini).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      status: "Pending Review", canRetry: !succeeded, evidence: checkpoint.evidence,
      run: { id: checkpoint.run.id, status: succeeded ? "completed" : "failed", failureCode: succeeded ? null : "AI_TIMEOUT" },
      report: { scientificReport: { origin: succeeded ? "gemini" : "evidence-review" } },
    });
    if (!succeeded) {
      expect(warn).toHaveBeenCalledWith(expect.objectContaining({
        failureCode: "AI_TIMEOUT", elapsedMs: 120_000,
        stage: scenario === "headers timeout" ? "request" : "response_body",
      }));
    }
  });

  it("declines Gemini dispatch when source and database delays exhaust the lease budget", async () => {
    env.AGENT_API_KEY = "test-gemini-key";
    const receipt = await (await post(documented)).json();
    vi.useFakeTimers();
    const delayedTime = Date.now() + 110_000;
    onLookup = async () => { vi.setSystemTime(delayedTime); };
    const gemini = mockGemini(async () => { throw new Error("Unexpected Gemini request"); });
    await scheduled();
    await scheduled();
    expect(gemini).not.toHaveBeenCalled();
    expect(await (await adminCall("requests/" + receipt.id)).json()).toMatchObject({
      status: "Pending Review", canRetry: true, run: { failureCode: "LEASE_INSUFFICIENT" },
      report: { scientificReport: { origin: "evidence-review" } },
      evidence: expect.arrayContaining([expect.objectContaining({ source: "PubChem" })]),
    });
  });

  it("retains the evidence-only draft and discards a late Gemini result after lease recovery", async () => {
    env.AGENT_API_KEY = "test-gemini-key";
    const receipt = await (await post(documented)).json();
    const path = "requests/" + receipt.id;
    vi.useFakeTimers();
    let start!: () => void;
    const started = new Promise<void>((resolve) => { start = resolve; });
    let resume!: () => void;
    const paused = new Promise<void>((resolve) => { resume = resolve; });
    const gemini = mockGemini(async (_resource, options) => {
      start();
      await paused;
      return geminiCompletion(options);
    });
    const running = scheduled();
    await started;
    const checkpoint = await (await adminCall(path)).json();
    const lease = db.prepare("SELECT lease_until FROM public_agent_runs WHERE id = ?").get(checkpoint.run.id);
    // Simulate an invocation suspended until after a later cron recovers its expired lease.
    vi.setSystemTime(new Date(String(lease?.lease_until)));
    await scheduled();
    resume();
    await running;
    await scheduled();
    expect(gemini).toHaveBeenCalledOnce();
    expect(await (await adminCall(path)).json()).toMatchObject({
      status: "Pending Review", canRetry: true, report: checkpoint.report, evidence: checkpoint.evidence,
      run: { id: checkpoint.run.id, status: "failed", failureCode: "LEASE_EXPIRED" },
    });
  });

  it.each(["blocked index", "changed profile"])("uses attributed NIOSH annotations after a %s and keeps honest gaps", async (scenario) => {
    const sources = mockFetch.getMockImplementation()!;
    const original = "https://www.cdc.gov/niosh/npg/npgd0302.html";
    mockFetch.mockImplementation((resource, options) => {
      const url = String(resource);
      if (scenario === "blocked index" && url.endsWith("/npgdcas.html")) {
        return Promise.resolve(new Response("private upstream body", { status: 403 }));
      }
      if (scenario === "changed profile" && url === original) {
        return Promise.resolve(new Response("<html>Unrecognized profile markup</html>"));
      }
      if (url.endsWith("/753/JSON")) {
        return Promise.resolve(Response.json({ Record: {
          RecordNumber: 753,
          Reference: [
            { ReferenceNumber: 1, SourceName: "The National Institute for Occupational Safety and Health (NIOSH)", URL: original },
            { ReferenceNumber: 2, SourceName: "Another depositor", URL: original },
            { ReferenceNumber: 3, SourceName: "The National Institute for Occupational Safety and Health (NIOSH)", URL: "https://example.test/npgd0302.html" },
          ],
          Section: [{ TOCHeading: "Toxicity", Section: [{
            TOCHeading: "Signs and Symptoms", Information: [1, 2, 3].map((number) => ({
              ReferenceNumber: number, Value: { StringWithMarkup: [{ String: number === 1 ? "Irritation" : "Unattributed text" }] },
            })),
          }] }],
        } }));
      }
      if (url.endsWith("/962/JSON")) {
        return Promise.resolve(Response.json({ Record: { RecordNumber: 962, Reference: [], Section: [] } }));
      }
      return sources(resource, options);
    });
    const receipt = await (await post(documented)).json();
    await scheduled();
    const result = await (await adminCall("requests/" + receipt.id)).json();
    expect(result.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ source: "PubChem" })]));
    expect(result.evidence.filter(({ source }: { source: string }) => source === "NIOSH")).toEqual([
      expect.objectContaining({ solution: "A", title: "Glycerol · Symptoms", kind: "hazard", url: original, excerpt: "Irritation" }),
    ]);
    expect(result.report.gaps.filter(({ code }: { code: string }) => code.startsWith("niosh"))).toEqual([
      { solution: "B", code: scenario === "blocked index" ? "nioshUnavailable" : "nioshNoRecord" },
    ]);
    expect(mockFetch.mock.calls.filter(([url]) => String(url).endsWith("/npgdcas.html"))).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(expect.objectContaining(scenario === "blocked index"
      ? { event: "niosh_lookup_failed", runId: result.run.id, stage: "cdc_index", code: "HTTP_ERROR", httpStatus: 403 }
      : { event: "niosh_lookup_failed", runId: result.run.id, stage: "cdc_profile", code: "PROFILE_FORMAT_CHANGED" }));
    expect(JSON.stringify(warn.mock.calls)).not.toContain("private upstream body");
  });

  it("retains PubChem evidence when both NIOSH lookups fail and requires an explicit Gemini retry", async () => {
    env.AGENT_API_KEY = "test-gemini-key";
    const sources = mockFetch.getMockImplementation()!;
    mockFetch.mockImplementation((resource, options) => {
      const url = new URL(String(resource));
      if (url.hostname === "www.cdc.gov" || url.pathname.endsWith("/JSON") && url.search === "" &&
        url.pathname.startsWith("/rest/pug_view/")) {
        return Promise.resolve(new Response(null, { status: 503 }));
      }
      return sources(resource, options);
    });
    const gemini = mockGemini(async (_resource, options) => geminiCompletion(options));
    gemini.mockRejectedValueOnce(new DOMException("Mock provider deadline", "TimeoutError"));
    const receipt = await (await post(documented)).json();
    const path = "requests/" + receipt.id;

    await scheduled();
    await scheduled();
    expect(gemini).toHaveBeenCalledOnce();
    const failed = await (await adminCall(path)).json();
    expect(failed).toMatchObject({
      status: "Pending Review", canRetry: true, run: { status: "failed", failureCode: "AI_TIMEOUT" },
      report: { scientificReport: { origin: "evidence-review" } },
    });
    expect(failed.report.gaps.filter(({ code }: { code: string }) => code.startsWith("niosh"))).toEqual([
      { code: "nioshUnavailable", solution: "A" }, { code: "nioshUnavailable", solution: "B" },
    ]);
    expect(failed.evidence).toEqual([
      expect.objectContaining({ source: "PubChem", solution: "A" }),
      expect.objectContaining({ source: "PubChem", solution: "B" }),
    ]);
    const priorDraft = () => db.prepare("SELECT report_json FROM public_assessment_drafts WHERE run_id = ?").get(failed.run.id);
    const snapshot = priorDraft();
    const retry = { runId: failed.run.id };
    expect((await adminCall(path + "/retry", retry, "")).status).toBe(401);
    const clicks = await Promise.all([adminCall(path + "/retry", retry), adminCall(path + "/retry", retry)]);
    expect(clicks.map(({ status }) => status).sort()).toEqual([200, 409]);
    expect((await (await track(receipt)).json()).status).toBe("Submitted");
    expect(gemini).toHaveBeenCalledOnce();

    await Promise.all([scheduled(), scheduled(), scheduled()]);
    expect(gemini).toHaveBeenCalledTimes(2);
    const recovered = await (await adminCall(path)).json();
    expect(recovered).toMatchObject({
      id: receipt.id, status: "Pending Review", canRetry: false,
      run: { status: "completed" }, report: { scientificReport: { origin: "gemini" } },
    });
    expect(recovered.run.id).not.toBe(failed.run.id);
    expect(priorDraft()).toEqual(snapshot);
    expect(db.prepare("SELECT COUNT(*) AS count FROM public_assessment_evidence WHERE run_id = ?").get(failed.run.id)?.count).toBe(2);
    expect((await adminCall(path + "/retry", retry)).status).toBe(409);
    expect((await adminCall(path + "/retry", { runId: recovered.run.id })).status).toBe(409);
    expect((await (await track(receipt)).json()).result).toBeUndefined();
  });

  it("skips Gemini when neither matched evidence nor a validated calculation is available", async () => {
    env.AGENT_API_KEY = "test-gemini-key";
    const receipt = await (await post(input)).json();
    await scheduled();
    expect(mockFetch.mock.calls.some(([url]) => String(url).includes("generativelanguage.googleapis.com"))).toBe(false);
    const detail = await (await adminCall("requests/" + receipt.id)).json();
    expect(detail.report.scientificReport.origin).toBe("evidence-review");
    expect(detail.report.scientificReport.findings.map(({ code }: { code: string }) => code))
      .toContain("modelUnavailable");
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
    expect((await reviewerRequest(path + "/decision", {
      method: "POST", headers: { ...jsonHeaders, Origin: adminOrigin, Authorization: "Bearer " + receipt.trackingToken },
      body: JSON.stringify(review),
    })).status).toBe(401);
    expect(await (await track(receipt)).json()).toEqual({
      id: receipt.id, status: "Pending Review", createdAt: receipt.createdAt, updatedAt: expect.any(String),
    });

    const replies = await Promise.all([
      adminCall(path + "/decision", review), adminCall(path + "/decision", review),
    ]);
    expect(replies.map(({ status }) => status).sort()).toEqual([200, 409]);
    const published = await (await track(receipt)).json();
    expect(published).toMatchObject({
      status: "Approved",
      result: { classification: "Insufficient information", conditions: review.result.conditions },
    });
    for (const secret of [approvalNotes, reviewerActor, "reviewerId", "hazardEvidenceIds", documented.a.notes, receipt.trackingToken]) {
      expect(JSON.stringify(published)).not.toContain(secret);
    }
    const other = await (await post(input)).json();
    expect((await track(receipt, other.trackingToken)).status).toBe(404);
    expect((await track(other, receipt.trackingToken)).status).toBe(404);
    expect((await (await track(other)).json()).result).toBeUndefined();

    const reviewed = await (await adminCall(path)).json();
    expect(reviewed.review.notes).toBe(approvalNotes);
    expect(reviewed.review.reviewerId).toBe(reviewerActor);
    expect(reviewed.history.at(-1).actor).toBe(reviewerActor);
    expect(reviewed.history.map(({ status }: { status: string }) => status)).toEqual([
      "Submitted", "Analyzing", "Pending Review", "Approved",
    ]);
    expect(mockFetch.mock.calls.filter(([url]) => String(url).startsWith("https://api.openai.com/"))).toHaveLength(1);

    expect(() => db.prepare("DELETE FROM public_review_decisions WHERE request_id = ?").run(receipt.id)).toThrow(/append-only/);
    expect(() => db.prepare("DELETE FROM public_request_status_history WHERE request_id = ?").run(receipt.id)).toThrow(/append-only/);
    expect(await (await adminCall("requests/manage", { action: "delete", ids: [receipt.id] })).json()).toEqual({ changed: 1 });
    expect((await track(receipt)).status).toBe(404);
    expect((await adminCall(path)).status).toBe(404);
    expect((await track(other)).status).toBe(200);
    expect(db.prepare("SELECT * FROM public_review_decisions").all()).toHaveLength(0);
    expect(db.prepare("SELECT * FROM public_agent_runs").all()).toHaveLength(0);
    expect(db.prepare("SELECT * FROM public_assessment_drafts").all()).toHaveLength(0);
    expect(db.prepare("SELECT * FROM public_assessment_evidence").all()).toHaveLength(0);
    expect(db.prepare("SELECT request_id, action, actor FROM public_request_management_events").all()).toEqual([
      { request_id: receipt.id, action: "delete", actor: reviewerActor },
    ]);
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
    expect((await reviewerRequest(imageRoute, { headers: { Authorization: "Bearer " + receipt.trackingToken } })).status).toBe(401);
    expect((await adminCall("requests/" + randomUUID() + "/images/" + images[0].id)).status).toBe(404);
    const image = await adminCall(imageRoute);
    expect(image.headers.get("Content-Type")).toBe("image/png");
    expect(image.headers.get("Cache-Control")).toBe("no-store");
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(new Uint8Array(png));

    expect(await (await adminCall("requests/manage", { action: "delete", ids: [receipt.id] })).json()).toEqual({ changed: 1 });
    expect((await adminCall(imageRoute)).status).toBe(404);
    expect(objects.size).toBe(1);
    const deleteObjects = env.IMAGES.delete;
    env.IMAGES.delete = async () => { throw new Error("Temporary R2 failure"); };
    env.AGENT_ENABLED = "false";
    await scheduled();
    expect(db.prepare("SELECT object_key FROM public_request_image_deletions").all()).toHaveLength(1);
    env.IMAGES.delete = deleteObjects;
    await scheduled();
    expect(objects.size).toBe(0);
    expect(db.prepare("SELECT object_key FROM public_request_image_deletions").all()).toHaveLength(0);
  });

  it("archives and restores selected requests without changing the receipt or processing archived requests", async () => {
    const receipt = await (await post(input)).json();
    const path = "requests/" + receipt.id;
    const archive = { action: "archive", ids: [receipt.id] };
    expect((await adminCall("requests/manage", archive, "")).status).toBe(401);
    expect((await adminCall("requests/manage", archive, session, adminOrigin, "wrong")).status).toBe(403);
    expect(await (await adminCall("requests/manage", archive)).json()).toEqual({ changed: 1 });
    expect(await (await adminCall("requests/manage", archive)).json()).toEqual({ changed: 0 });
    expect(await (await adminCall("requests")).json()).toMatchObject({ requests: [] });
    expect(await (await adminCall("requests?archived=true")).json()).toMatchObject({ requests: [{ id: receipt.id }] });
    expect(await (await adminCall(path)).json()).toMatchObject({ archivedAt: expect.any(String), status: "Submitted" });
    await scheduled();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(await (await track(receipt)).json()).toMatchObject({ status: "Submitted" });
    expect(await (await adminCall("requests/manage", { ...archive, action: "restore" })).json()).toEqual({ changed: 1 });
    expect(await (await adminCall(path)).json()).toMatchObject({ archivedAt: null });
    await scheduled();
    const detail = await (await adminCall(path)).json();
    expect(detail.status).toBe("Pending Review");
    await adminCall("requests/manage", archive);
    expect((await adminCall(path + "/retry", { runId: detail.run.id })).status).toBe(409);
    expect((await adminCall(path + "/decision", {
      runId: detail.run.id, decision: "Rejected", notes: "Fixture decision",
    })).status).toBe(409);
  });

  it("commits bulk deletion atomically and preserves paging after a cursor record is deleted", async () => {
    const ids = Array.from({ length: 32 }, () => randomUUID());
    const insert = db.prepare("INSERT INTO public_requests VALUES (?, ?, 'Submitted', ?, ?)");
    ids.forEach((id, index) => {
      const time = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
      insert.run(id, JSON.stringify(input), time, time);
    });
    const firstPage = await (await adminCall("requests")).json();
    expect(firstPage.requests).toHaveLength(30);
    const [firstId, cursorId] = [firstPage.requests[0].id, firstPage.requests.at(-1).id];
    db.exec(`CREATE TRIGGER test_reject_delete BEFORE DELETE ON public_requests WHEN OLD.id = '${cursorId}'
      BEGIN SELECT RAISE(ABORT, 'Fixture failure'); END;`);
    const deletion = { action: "delete", ids: [firstId, cursorId] };
    expect((await adminCall("requests/manage", { ...deletion, ids: [] })).status).toBe(400);
    expect((await adminCall("requests/manage", { ...deletion, ids })).status).toBe(400);
    expect((await adminCall("requests/manage", deletion)).status).toBe(503);
    expect(db.prepare("SELECT * FROM public_request_management_events").all()).toHaveLength(0);
    expect((await adminCall(`requests/${firstId}`)).status).toBe(200);
    db.exec("DROP TRIGGER test_reject_delete");
    expect(await (await adminCall("requests/manage", deletion)).json()).toEqual({ changed: 2 });
    expect(await (await adminCall("requests/manage", deletion)).json()).toEqual({ changed: 0 });
    const next = await (await adminCall("requests?after=" + encodeURIComponent(firstPage.next))).json();
    expect(next.requests.map(({ id }: { id: string }) => id)).toEqual(ids.slice(0, 2).reverse());
    expect(next.next).toBeNull();
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
