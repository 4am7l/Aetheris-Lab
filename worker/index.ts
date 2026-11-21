import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import { requestInputSchema, solutionSchema, unknown } from "../src/domain";

interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  DB: D1Database;
  SUBMISSION_LIMIT: RateLimiter;
  TRACKING_LIMIT: RateLimiter;
  IMAGES: R2Bucket;
  ADMIN_REVIEW_SERVICE_TOKEN: string;
  CF_ACCESS_TEAM_DOMAIN: string;
  CF_ACCESS_AUD: string;
}

const publicRequestPath = "/api/requests";
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const submittedStatus = "Submitted";
const maxBodyBytes = 32 * 1024;
const jsonContentType = /^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?$/i;
const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const publicSolutionSchema = solutionSchema
  .strict()
  .superRefine((value, ctx) => {
    for (const field of ["concentration", "quantity", "temperature"] as const) {
      if (value[field] !== unknown && !decimal.test(value[field])) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: "Expected a decimal value.",
        });
      }
    }
    if (value.quantity !== unknown && value.quantityUnit === unknown) {
      ctx.addIssue({
        code: "custom",
        path: ["quantityUnit"],
        message: "Choose a quantity unit.",
      });
    }
  });
const publicInputSchema = requestInputSchema.strict().extend({
  a: publicSolutionSchema,
  b: publicSolutionSchema,
});

const unavailable = {
  error: "INTEGRATION_UNAVAILABLE",
  message:
    "Identity, evidence, authenticated storage, and administrator review integrations are not configured.",
};

function json(data: unknown, status = 200, extraHeaders?: Record<string, string>) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

function error(code: string, status: number, headers?: Record<string, string>) {
  return json({ error: code }, status, headers);
}

async function health(env: Env) {
  let ready = false;
  if (env.DB && env.SUBMISSION_LIMIT && env.TRACKING_LIMIT) {
    try {
      await env.DB.prepare(
        `SELECT r.id, r.input_json, r.status, r.created_at, r.updated_at, t.token_sha256
         FROM public_requests r JOIN public_request_tokens t ON t.request_id = r.id
         LIMIT 0`,
      ).all();
      ready = true;
    } catch {
      // Report readiness without exposing database details.
    }
  }
  return json(
    {
      mode: ready ? "public-intake" : "integration-unavailable",
      submission: ready,
      tracking: ready,
      identification: false,
      review: false,
    },
    ready ? 200 : 503,
  );
}

async function withinLimit(request: Request, limiter: RateLimiter) {
  // Cloudflare provides this header on direct ingress. Treat missing IPs as a shared bucket.
  const key = request.headers.get("CF-Connecting-IP") || "unknown-client";
  const { success } = await limiter.limit({ key });
  return success;
}

async function readPublicInput(request: Request) {
  const type = request.headers.get("Content-Type") ?? "";
  const encoding = request.headers.get("Content-Encoding");
  if (
    !jsonContentType.test(type) ||
    (encoding !== null && encoding.toLowerCase() !== "identity")
  ) {
    return error("UNSUPPORTED_MEDIA_TYPE", 415);
  }

  const length = request.headers.get("Content-Length");
  if (length !== null) {
    if (!/^\d+$/.test(length)) return error("INVALID_CONTENT_LENGTH", 400);
    if (Number(length) > maxBodyBytes) return error("PAYLOAD_TOO_LARGE", 413);
  }
  if (!request.body) return error("INVALID_JSON", 400);

  const bytes = new Uint8Array(maxBodyBytes);
  let size = 0;
  let input: unknown;
  const reader = request.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (size + value.byteLength > maxBodyBytes) {
        void reader.cancel().catch(() => {});
        return error("PAYLOAD_TOO_LARGE", 413);
      }
      bytes.set(value, size);
      size += value.byteLength;
    }
    if (length !== null && Number(length) !== size) {
      return error("INVALID_CONTENT_LENGTH", 400);
    }
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false })
      .decode(bytes.subarray(0, size));
    input = JSON.parse(text);
  } catch {
    return error("INVALID_JSON", 400);
  } finally {
    reader.releaseLock();
  }

  const parsed = publicInputSchema.safeParse(input);
  return parsed.success ? parsed.data : error("INVALID_REQUEST", 400);
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return hex(new Uint8Array(digest));
}

async function submit(request: Request, env: Env) {
  const input = await readPublicInput(request);
  if (input instanceof Response) return input;

  const id = crypto.randomUUID();
  const trackingToken = hex(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await hashToken(trackingToken);
  const createdAt = new Date().toISOString();

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO public_requests (id, input_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(id, JSON.stringify(input), submittedStatus, createdAt, createdAt),
    env.DB.prepare(
      "INSERT INTO public_request_tokens (request_id, token_sha256) VALUES (?, ?)",
    ).bind(id, tokenHash),
  ]);

  return json(
    { id, status: submittedStatus, createdAt, updatedAt: createdAt, trackingToken },
    201,
    { Location: `${publicRequestPath}/${id}` },
  );
}

async function track(request: Request, env: Env, id: string) {
  const authorization = request.headers.get("Authorization") ?? "";
  const token = /^Bearer ([a-f0-9]{64})$/i.exec(authorization)?.[1];
  if (!token || !uuid.test(id)) return error("NOT_FOUND", 404);

  const row = await env.DB.prepare(
    `SELECT r.id, r.created_at AS createdAt, r.updated_at AS updatedAt
     FROM public_requests r JOIN public_request_tokens t ON t.request_id = r.id
     WHERE r.id = ? AND t.token_sha256 = ?`,
  ).bind(id, await hashToken(token)).first();

  // This API reports receipt. Internal workflow decisions are never public statuses.
  return row ? json({ ...row, status: submittedStatus }) : error("NOT_FOUND", 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/health" && request.method === "GET") return health(env);

    const isSubmission = pathname === publicRequestPath;
    const trackingId = /^\/api\/requests\/([^/]+)$/.exec(pathname)?.[1];
    if (isSubmission || trackingId !== undefined) {
      const method = isSubmission ? "POST" : "GET";
      if (request.method !== method) {
        return error("METHOD_NOT_ALLOWED", 405, { Allow: method });
      }
      const limiter = isSubmission ? env.SUBMISSION_LIMIT : env.TRACKING_LIMIT;
      if (!env.DB || !limiter) return error("SERVICE_UNAVAILABLE", 503);
      try {
        if (!(await withinLimit(request, limiter))) {
          return error("RATE_LIMITED", 429, { "Retry-After": "60" });
        }
        return trackingId === undefined
          ? await submit(request, env)
          : await track(request, env, trackingId);
      } catch {
        return error("SERVICE_UNAVAILABLE", 503);
      }
    }
    // Fail closed. An Access header alone is not authentication. No route accepts client-supplied approval.
    if (pathname.startsWith("/api/admin/"))
      return json(
        {
          error: "REVIEW_AUTH_NOT_CONFIGURED",
          message:
            "Review ingestion is disabled until Access JWT validation, service authentication, and replay protection are implemented.",
        },
        503,
      );
    if (pathname.startsWith("/api/")) return json(unavailable, 503);
    return error("NOT_FOUND", 404);
  },
};
