import { describe, expect, it, vi } from "vitest";
import { onRequest } from "../functions/api/[[route]]";

function call(request: Request, fetch?: typeof globalThis.fetch) {
  return onRequest({ request, env: { AETHERIS_API: fetch && { fetch } } });
}

describe("same-origin Pages API", () => {
  it("forwards the incoming request and returns the Worker's metadata and headers", async () => {
    const request = new Request(
      "https://aetheris-lab.pages.dev/api/requests/test",
      {
        headers: {
          Authorization: "Bearer test",
          "CF-Connecting-IP": "192.0.2.1",
        },
      },
    );
    const response = new Response(null, {
      status: 429,
      headers: { "Retry-After": "60", "Cache-Control": "no-store" },
    });
    const fetch = vi.fn().mockResolvedValue(response);
    expect(await call(request, fetch)).toBe(response);
    expect(fetch).toHaveBeenCalledWith(request);
  });

  it("allows only the public API and rejects cross-origin preflights", async () => {
    const fetch = vi.fn();
    const internal = await call(
      new Request("https://aetheris-lab.pages.dev/api/admin/reviews"),
      fetch,
    );
    expect(internal.status).toBe(404);
    const preflight = await call(
      new Request("https://aetheris-lab.pages.dev/api/requests", {
        method: "OPTIONS",
        headers: {
          Origin: "https://other.example",
          "Access-Control-Request-Method": "POST",
        },
      }),
      fetch,
    );
    expect(preflight.status).toBe(403);
    expect(preflight.headers.has("Access-Control-Allow-Origin")).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns a non-cacheable 503 when the Worker binding is missing or fails", async () => {
    const request = new Request("https://aetheris-lab.pages.dev/api/health");
    for (const fetch of [
      undefined,
      vi.fn().mockRejectedValue(new Error("private details")),
    ]) {
      const response = await call(request, fetch);
      expect(response.status).toBe(503);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toEqual({ error: "SERVICE_UNAVAILABLE" });
    }
  });
});
