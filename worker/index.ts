import type { D1Database, R2Bucket, ScheduledController } from "@cloudflare/workers-types";
import {
  publicInputSchema, publicReceiptSchema, publicRequestIdSchema, publicRequestPath,
  publicResultSchema, type PublicRequestStatus,
} from "../src/domain";
import { admin } from "./admin";
import { processNextRequest } from "./orchestrator";
import { providerFor, type AIConfig } from "./ai";
import { accessConfig, type AccessConfig } from "./auth";
import { error, hex, json } from "./http";
import { readSubmission, storeImages } from "./images";

interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env extends AccessConfig, AIConfig {
  DB: D1Database;
  SUBMISSION_LIMIT: RateLimiter;
  TRACKING_LIMIT: RateLimiter;
  IMAGES: R2Bucket;
  AGENT_ENABLED?: string;
}

const unavailable = { error: "INTEGRATION_UNAVAILABLE" };

async function health(env: Env) {
  let ready = false;
  if (env.DB && env.SUBMISSION_LIMIT && env.TRACKING_LIMIT) {
    try {
      await env.DB.prepare(
        `SELECT r.id, r.input_json, r.created_at, w.status, w.updated_at, t.token_sha256, v.approved_result_json
         FROM public_requests r JOIN public_request_tokens t ON t.request_id = r.id
         JOIN public_request_workflow w ON w.request_id = r.id
         LEFT JOIN public_review_decisions v ON v.request_id = r.id LIMIT 0`,
      ).all();
      ready = true;
    } catch {
      // Report readiness without exposing database details.
    }
  }
  const enabled = ready && env.AGENT_ENABLED === "true";
  return json({
    mode: ready ? "public-assessment" : "integration-unavailable",
    submission: ready,
    tracking: ready,
    identification: enabled,
    review: ready && Boolean(accessConfig(env)),
    agent: !enabled ? "disabled" : providerFor(env) ? "configured" : "unconfigured",
  }, ready ? 200 : 503);
}

async function withinLimit(request: Request, limiter: RateLimiter) {
  // Cloudflare provides this header on direct ingress. Treat missing IPs as a shared bucket.
  const key = request.headers.get("CF-Connecting-IP") || "unknown-client";
  const { success } = await limiter.limit({ key });
  return success;
}

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return hex(new Uint8Array(digest));
}

async function submit(request: Request, env: Env) {
  const submission = await readSubmission(request);
  if (submission instanceof Response) return submission;
  const parsed = publicInputSchema.safeParse(submission.input);
  if (!parsed.success) return error("INVALID_REQUEST", 400);
  if (submission.images.length && !env.IMAGES) return error("SERVICE_UNAVAILABLE", 503);

  const id = crypto.randomUUID();
  const trackingToken = hex(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await hashToken(trackingToken);
  const createdAt = new Date().toISOString();
  const images = submission.images.length ? await storeImages(env.IMAGES, id, submission.images) : [];

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO public_requests (id, input_json, status, created_at, updated_at)
         VALUES (?, ?, 'Submitted', ?, ?)`,
      ).bind(id, JSON.stringify(parsed.data), createdAt, createdAt),
      env.DB.prepare(
        "INSERT INTO public_request_tokens (request_id, token_sha256) VALUES (?, ?)",
      ).bind(id, tokenHash),
      ...images.map(({ id: imageId, solution, objectKey, mimeType, size }) => env.DB.prepare(
        `INSERT INTO public_request_images (id, request_id, solution, object_key, mime_type, size_bytes)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(imageId, id, solution, objectKey, mimeType, size)),
    ]);
  } catch (cause) {
    if (images.length) {
      // Resolve an ambiguous D1 failure on the primary before deleting any objects.
      try {
        const receipt = await env.DB.withSession("first-primary").prepare("SELECT id FROM public_requests WHERE id = ?")
          .bind(id).first();
        if (!receipt) await Promise.allSettled(images.map(({ objectKey }) => env.IMAGES.delete(objectKey)));
      } catch {
        // Keep inaccessible objects if the database could not confirm the outcome.
      }
    }
    throw cause;
  }

  return json(
    { id, status: "Submitted", createdAt, updatedAt: createdAt, trackingToken },
    201,
    { Location: `${publicRequestPath}/${id}` },
  );
}

async function track(request: Request, env: Env, id: string) {
  const authorization = request.headers.get("Authorization") ?? "";
  const token = /^Bearer ([a-f0-9]{64})$/i.exec(authorization)?.[1];
  if (!token || !publicRequestIdSchema.safeParse(id).success) return error("NOT_FOUND", 404);
  const row = await env.DB.prepare(
    `SELECT r.id, r.created_at AS createdAt, w.updated_at AS updatedAt, w.status,
       v.approved_result_json AS resultJson
     FROM public_requests r JOIN public_request_tokens t ON t.request_id = r.id
     JOIN public_request_workflow w ON w.request_id = r.id
     LEFT JOIN public_review_decisions v ON w.status = 'Approved' AND v.decision = 'Approved'
       AND v.request_id = w.request_id AND v.run_id = w.run_id
     WHERE r.id = ? AND t.token_sha256 = ?`,
  ).bind(id, await hashToken(token)).first<{
    id: string; createdAt: string; updatedAt: string; status: PublicRequestStatus; resultJson: string | null;
  }>();
  if (!row) return error("NOT_FOUND", 404);
  const { resultJson, ...receipt } = row;
  const response = row.status === "Approved"
    ? { ...receipt, result: publicResultSchema.parse(JSON.parse(resultJson ?? "null")) }
    : receipt;
  return json(publicReceiptSchema.parse(response));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/health" && request.method === "GET") return health(env);
    if (pathname === "/api/admin" || pathname.startsWith("/api/admin/")) {
      try {
        return await admin(request, env);
      } catch {
        return error("SERVICE_UNAVAILABLE", 503);
      }
    }
    const isSubmission = pathname === publicRequestPath;
    const trackingId = /^\/api\/requests\/([^/]+)$/.exec(pathname)?.[1];
    if (isSubmission || trackingId !== undefined) {
      const method = isSubmission ? "POST" : "GET";
      if (request.method !== method) return error("METHOD_NOT_ALLOWED", 405, { Allow: method });
      const origin = request.headers.get("Origin");
      if (isSubmission && origin !== null && origin !== new URL(request.url).origin) {
        return error("FORBIDDEN", 403);
      }
      const limiter = isSubmission ? env.SUBMISSION_LIMIT : env.TRACKING_LIMIT;
      if (!env.DB || !limiter) return error("SERVICE_UNAVAILABLE", 503);
      try {
        if (!(await withinLimit(request, limiter))) {
          return error("RATE_LIMITED", 429, { "Retry-After": "60" });
        }
        return trackingId === undefined ? await submit(request, env) : await track(request, env, trackingId);
      } catch {
        return error("SERVICE_UNAVAILABLE", 503);
      }
    }
    if (pathname.startsWith("/api/")) return json(unavailable, 503);
    return error("NOT_FOUND", 404);
  },

  async scheduled(_controller: ScheduledController, env: Env) {
    await processNextRequest(env);
  },
};
