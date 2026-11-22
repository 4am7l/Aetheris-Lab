import { describe, expect, it, vi } from "vitest";
import { onRequest } from "../functions/api/[[route]]";
import { onRequest as adminPage } from "../functions/admin/[[route]]";

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

  it("excludes unknown endpoints and rejects cross-origin preflights", async () => {
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


  it("passes the signed assertion through the Pages binding and blocks other origins", async () => {
    const endpoint = "https://review.example.test/api/admin/requests";
    const fetch = vi.fn().mockResolvedValue(Response.json({ requests: [] }));
    const active = new Request(endpoint, { headers: { "Cf-Access-Jwt-Assertion": "test-assertion" } });
    expect((await call(active, fetch)).status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(active);

    const foreign = new Request(endpoint, { headers: { Origin: "https://elsewhere.example" } });
    expect((await call(foreign, fetch)).status).toBe(403);
    expect(fetch).toHaveBeenCalledTimes(1);
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

describe("protected admin document", () => {
  function page(headers: HeadersInit, status: number) {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status }));
    const next = vi.fn().mockResolvedValue(new Response("protected HTML"));
    const response = adminPage({
      request: new Request("https://review.example.test/admin", { headers }),
      env: { AETHERIS_API: { fetch } },
      next,
    } as unknown as Parameters<typeof adminPage>[0]);
    return { response, fetch, next };
  }

  it("returns protected HTML only after the Worker authenticates the session", async () => {
    const missing = page({}, 200);
    expect((await missing.response).status).toBe(401);
    expect(missing.fetch).not.toHaveBeenCalled();
    expect(missing.next).not.toHaveBeenCalled();

    const denied = page({ "Cf-Access-Jwt-Assertion": "fake" }, 403);
    expect((await denied.response).status).toBe(403);
    expect(denied.next).not.toHaveBeenCalled();

    const allowed = page({ "Cf-Access-Jwt-Assertion": "signed-value" }, 200);
    const response = await allowed.response;
    expect(await response.text()).toBe("protected HTML");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    const checked = allowed.fetch.mock.calls[0][0] as Request;
    expect(checked.url).toBe("https://review.example.test/api/admin/session");
    expect(checked.headers.get("Cf-Access-Jwt-Assertion")).toBe("signed-value");
  });
});
