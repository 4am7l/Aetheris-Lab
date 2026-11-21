import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
      all: () => database.prepare(sql).all(...values),
      first: () => database.prepare(sql).get(...values) ?? null,
      run: () => database.prepare(sql).run(...values),
    };
  }
  return {
    prepare,
    batch(statements: ReturnType<typeof prepare>[]) {
      database.exec("BEGIN");
      try {
        const results = statements.map((statement) => statement.run());
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
  });

  afterAll(() => {
    db?.close();
  });

  it("reports intake and tracking readiness with the migrated database", async () => {
    const response = await call("/api/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      mode: "public-intake",
      submission: true,
      tracking: true,
      identification: false,
      review: false,
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
