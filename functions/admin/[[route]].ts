import { error } from "../../worker/http";

interface Context {
  request: Request;
  env: { AETHERIS_API?: { fetch(request: Request): Promise<Response> } };
  next(): Promise<Response>;
}

export async function onRequest({ request, env, next }: Context) {
  if (!env.AETHERIS_API) return error("SERVICE_UNAVAILABLE", 503);
  if (request.method !== "GET" && request.method !== "HEAD") return error("METHOD_NOT_ALLOWED", 405);
  const assertion = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!assertion) return error("UNAUTHORIZED", 401);

  try {
    const session = await env.AETHERIS_API.fetch(new Request(new URL("/api/admin/session", request.url), {
      headers: { "Cf-Access-Jwt-Assertion": assertion },
    }));
    if (!session.ok) return session;
    await session.body?.cancel();
    const content = await next();
    const response = new Response(content.body, content);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch {
    return error("SERVICE_UNAVAILABLE", 503);
  }
}
