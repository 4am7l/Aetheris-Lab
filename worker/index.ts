import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
export interface Env {
  DB: D1Database;
  IMAGES: R2Bucket;
  ADMIN_REVIEW_SERVICE_TOKEN: string;
  CF_ACCESS_TEAM_DOMAIN: string;
  CF_ACCESS_AUD: string;
}
const unavailable = {
  error: "INTEGRATION_UNAVAILABLE",
  message:
    "Identity, evidence, authenticated storage, and administrator review integrations are not configured.",
};
export default {
  async fetch(request: Request, _env: Env): Promise<Response> {
    void _env;
    const url = new URL(request.url);
    const headers = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    };
    if (url.pathname === "/api/health" && request.method === "GET")
      return Response.json(
        {
          mode: "integration-unavailable",
          submission: false,
          identification: false,
          review: false,
        },
        { headers },
      );
    // Fail closed. An Access header alone is not authentication. No route accepts client-supplied approval.
    if (url.pathname.startsWith("/api/admin/"))
      return Response.json(
        {
          error: "REVIEW_AUTH_NOT_CONFIGURED",
          message:
            "Review ingestion is disabled until Access JWT validation, service authentication, and replay protection are implemented.",
        },
        { status: 503, headers },
      );
    if (url.pathname.startsWith("/api/"))
      return Response.json(unavailable, { status: 503, headers });
    return Response.json({ error: "NOT_FOUND" }, { status: 404, headers });
  },
};
