import { createRemoteJWKSet, jwtVerify } from "jose";
import { error } from "./http";

export interface AccessConfig {
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  REVIEWER_EMAILS?: string;
  ADMIN_ORIGIN?: string;
}

const keys = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export function accessConfig(env: AccessConfig) {
  const team = env.CF_ACCESS_TEAM_DOMAIN?.trim().toLowerCase();
  const audience = env.CF_ACCESS_AUD?.trim();
  const origin = env.ADMIN_ORIGIN?.trim();
  const reviewers = new Set((env.REVIEWER_EMAILS ?? "").split(",")
    .map((email) => email.trim().toLowerCase())
    .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)));
  if (!team || !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(team) ||
    !audience || !origin || !reviewers.size) return null;
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" || url.origin !== origin) return null;
  } catch {
    return null;
  }
  return { issuer: "https://" + team, audience, origin, reviewers };
}

export async function authenticateReviewer(request: Request, env: AccessConfig) {
  const config = accessConfig(env);
  if (!config) return error("REVIEW_AUTH_NOT_CONFIGURED", 503);
  if (new URL(request.url).origin !== config.origin) return error("FORBIDDEN", 403);
  const jwt = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!jwt || jwt.length > 8192) return error("UNAUTHORIZED", 401);
  // Access supplies the signed assertion to Pages. The Worker independently verifies it.
  let jwks = keys.get(config.issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL("/cdn-cgi/access/certs", config.issuer), { timeoutDuration: 4_000 });
    keys.set(config.issuer, jwks);
  }
  try {
    const { payload } = await jwtVerify(jwt, jwks, {
      issuer: config.issuer, audience: config.audience, algorithms: ["RS256"],
      requiredClaims: ["exp", "iat", "sub", "email"],
    });
    if (!payload.sub || payload.common_name || typeof payload.email !== "string") {
      return error("FORBIDDEN", 403);
    }
    const email = payload.email.toLowerCase();
    if (!config.reviewers.has(email)) return error("FORBIDDEN", 403);
    if (request.method !== "GET" && request.headers.get("Origin") !== config.origin) {
      return error("FORBIDDEN", 403);
    }
    return email;
  } catch {
    return error("UNAUTHORIZED", 401);
  }
}
