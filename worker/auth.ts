import type { D1Database } from "@cloudflare/workers-types";
import { error, hex, json } from "./http";

export interface ReviewerAuthEnv {
  ADMIN_ORIGIN?: string;
  ADMIN_PROXY_SECRET?: string;
  GITHUB_OAUTH_CLIENT_ID?: string;
  GITHUB_OAUTH_CLIENT_SECRET?: string;
  REVIEWER_GITHUB_IDS?: string;
}

const loginPath = "/api/admin/auth/login";
const callbackPath = "/api/admin/auth/callback";
const sessionCookie = "__Host-aetheris-session";
const stateCookie = "__Host-aetheris-oauth";
const sessionSeconds = 8 * 60 * 60;
const stateSeconds = 10 * 60;
const tokenPattern = /^[a-f0-9]{64}$/;
const githubIdPattern = /^[1-9][0-9]*$/;

export function adminConfig(env: ReviewerAuthEnv) {
  const origin = env.ADMIN_ORIGIN;
  const proxySecret = env.ADMIN_PROXY_SECRET;
  const clientId = env.GITHUB_OAUTH_CLIENT_ID?.trim();
  const clientSecret = env.GITHUB_OAUTH_CLIENT_SECRET?.trim();
  const reviewers = new Set(env.REVIEWER_GITHUB_IDS?.split(",").map((id) => id.trim()).filter(Boolean));
  if (!origin || !proxySecret || !tokenPattern.test(proxySecret) || !clientId || !clientSecret ||
    !reviewers.size || [...reviewers].some((id) => !githubIdPattern.test(id))) return null;
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" || url.origin !== origin) return null;
  } catch {
    return null;
  }
  return { origin, proxySecret, clientId, clientSecret, reviewers };
}

type Config = NonNullable<ReturnType<typeof adminConfig>>;

export function fromAdminProxy(request: Request, config: Config) {
  const candidate = request.headers.get("X-Aetheris-Admin-Proxy") ?? "";
  const origin = request.headers.get("Origin");
  if (!tokenPattern.test(candidate) || new URL(request.url).origin !== config.origin ||
    (origin !== null && origin !== config.origin) ||
    (request.method !== "GET" && origin !== config.origin)) return false;
  let mismatch = 0;
  for (let i = 0; i < candidate.length; i++) {
    mismatch |= candidate.charCodeAt(i) ^ config.proxySecret.charCodeAt(i);
  }
  return mismatch === 0;
}

function newToken() {
  return hex(crypto.getRandomValues(new Uint8Array(32)));
}

async function sha256(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function hashToken(token: string) {
  return hex(await sha256(token));
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function readCookie(request: Request, name: string) {
  const values = (request.headers.get("Cookie") ?? "").split(";").map((value) => value.trim())
    .filter((value) => value.startsWith(name + "="));
  const value = values.length === 1 ? values[0].slice(name.length + 1) : "";
  return tokenPattern.test(value) ? value : null;
}

function cookie(name: string, token: string, maxAge: number, sameSite: "Lax" | "Strict") {
  return name + "=" + token + "; Path=/; Max-Age=" + maxAge + "; Secure; HttpOnly; SameSite=" + sameSite;
}

function redirect(location: string, cookies: string[]) {
  const headers = new Headers({
    Location: location,
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  for (const value of cookies) headers.append("Set-Cookie", value);
  return new Response(null, { status: 303, headers });
}

async function startLogin(db: D1Database, config: Config) {
  const state = newToken();
  const browserToken = newToken();
  const verifier = newToken();
  const now = nowSeconds();
  await db.batch([
    db.prepare("DELETE FROM admin_oauth_states WHERE expires_at <= ?").bind(now),
    db.prepare("DELETE FROM admin_sessions WHERE expires_at <= ?").bind(now),
    db.prepare(
      "INSERT INTO admin_oauth_states (state_sha256, browser_sha256, code_verifier, expires_at) VALUES (?, ?, ?, ?)",
    ).bind(await hashToken(state), await hashToken(browserToken), verifier, now + stateSeconds),
  ]);
  const challenge = btoa(String.fromCharCode(...await sha256(verifier)))
    .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.origin + callbackPath,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    allow_signup: "false",
  }).toString();
  return redirect(authorize.href, [cookie(stateCookie, browserToken, stateSeconds, "Lax")]);
}

async function githubIdentity(code: string, verifier: string, config: Config) {
  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      code_verifier: verifier,
      redirect_uri: config.origin + callbackPath,
    }),
    redirect: "manual",
    signal: AbortSignal.timeout(8000),
  });
  if (!tokenResponse.ok) return null;
  const token = (await tokenResponse.json() as { access_token?: unknown } | null)?.access_token;
  if (typeof token !== "string" || !/^[a-zA-Z0-9_]{1,512}$/.test(token)) return null;
  const userResponse = await fetch("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + token,
      "User-Agent": "Aetheris-Lab",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    redirect: "manual",
    signal: AbortSignal.timeout(8000),
  });
  if (!userResponse.ok) return null;
  const user = await userResponse.json() as { id?: unknown; login?: unknown } | null;
  if (typeof user?.id !== "number" || !Number.isSafeInteger(user.id) || user.id < 1 ||
    typeof user.login !== "string" || !/^[a-zA-Z0-9-]{1,39}$/.test(user.login)) return null;
  return { githubId: String(user.id), login: user.login };
}

async function finishLogin(request: Request, db: D1Database, config: Config) {
  const params = new URL(request.url).searchParams;
  const state = params.get("state") ?? "";
  const code = params.get("code");
  const browserToken = readCookie(request, stateCookie);
  const clear = cookie(stateCookie, "", 0, "Lax");
  const failed = () => redirect(config.origin + "/?auth=failed", [clear]);
  if (!tokenPattern.test(state) || !browserToken) return failed();
  // Consume state atomically so a concurrent callback cannot reuse it.
  const saved = await db.prepare(
    "DELETE FROM admin_oauth_states WHERE state_sha256 = ? AND browser_sha256 = ? AND expires_at > ? RETURNING code_verifier",
  ).bind(await hashToken(state), await hashToken(browserToken), nowSeconds()).first<{ code_verifier: string }>();
  if (!saved || !code || code.length > 1024 || params.has("error")) return failed();
  const identity = await githubIdentity(code, saved.code_verifier, config).catch(() => null);
  if (!identity || !config.reviewers.has(identity.githubId)) return failed();
  const token = newToken();
  await db.prepare(
    "INSERT INTO admin_sessions (token_sha256, github_id, login, expires_at) VALUES (?, ?, ?, ?)",
  ).bind(await hashToken(token), identity.githubId, identity.login, nowSeconds() + sessionSeconds).run();
  return redirect(config.origin + "/", [clear, cookie(sessionCookie, token, sessionSeconds, "Strict")]);
}

export async function reviewerLogin(request: Request, db: D1Database, config: Config, allowLogin: () => Promise<boolean>) {
  const { pathname } = new URL(request.url);
  if (pathname !== loginPath && pathname !== callbackPath) return null;
  if (request.method !== "GET") return error("METHOD_NOT_ALLOWED", 405, { Allow: "GET" });
  if (pathname === callbackPath) return finishLogin(request, db, config);
  if (!await allowLogin()) return error("RATE_LIMITED", 429, { "Retry-After": "60" });
  return startLogin(db, config);
}

export async function authenticateReviewer(request: Request, db: D1Database, config: Config) {
  const token = readCookie(request, sessionCookie);
  if (!token) return error("UNAUTHORIZED", 401);
  const tokenHash = await hashToken(token);
  const session = await db.prepare(
    "SELECT github_id AS githubId, login FROM admin_sessions WHERE token_sha256 = ? AND expires_at > ?",
  ).bind(tokenHash, nowSeconds()).first<{ githubId: string; login: string }>();
  if (!session) return error("UNAUTHORIZED", 401);
  if (!config.reviewers.has(session.githubId)) return error("FORBIDDEN", 403);
  return { ...session, tokenHash };
}

export async function logout(db: D1Database, tokenHash: string) {
  await db.prepare("DELETE FROM admin_sessions WHERE token_sha256 = ?").bind(tokenHash).run();
  return json({ signedOut: true }, 200, { "Set-Cookie": cookie(sessionCookie, "", 0, "Strict") });
}
