# Cloudflare deployment preparation

Nothing has been deployed or provisioned. The frontend can run without an account. The Worker is a fail-closed scaffold and remains nonoperational after deployment until integrations are implemented.

## 1. Verify the source

```sh
npm ci
npm run lint
npm run typecheck
npm run worker:check
npm test
npm run build
```

## 2. Frontend with Pages

In Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git, select `4am7l/Aetheris-Lab` and the intended branch. Set framework Vite, root `/`, build command `npm run build`, output `dist`, and Node version 22.12+ (or the validated Node 26). No frontend secrets are needed; optional `VITE_APP_MODE=local-demo` is informational only. Approve deployment only after account/domain settings are ready. Alternatively, after authorization:

```sh
npx wrangler login
npx wrangler pages project create aetheris-lab
npx wrangler pages deploy dist --project-name aetheris-lab
```

The bundled `_redirects` handles SPA deep links; `_headers` sets MIME, referrer, camera and CSP policies. The CSP currently permits only same-origin connections. Extend `connect-src` to the configured backend origin only when the client transport is implemented, or use a same-origin `/api/*` Worker route. When self-hosting fonts, tighten font/style sources accordingly.

## 3. Provision future backend storage

Only with the selected account and authorization:

```sh
npx wrangler d1 create aetheris-lab
npx wrangler r2 bucket create aetheris-lab-private-images
```

Put the returned D1 UUID into `wrangler.toml` at `database_id`; confirm the R2 bucket binding/name. Keep R2 public access OFF. Apply migrations first locally, then remotely when authorized:

```sh
npx wrangler d1 migrations apply aetheris-lab --local
npx wrangler d1 migrations apply aetheris-lab --remote
```

## 4. Authentication, integrations and secrets

Create a dedicated Cloudflare Access application/policy for administrator service traffic. Configure team domain and audience, implement JWKS signature verification with pinned issuer/audience, and bind verified reviewers to application roles. Implement the contract in `admin-review.md` before enabling review routes.

Worker-only configuration names are listed in `.dev.vars.example`: identity provider URL/key, safety-data provider URL/key, agent key, Admin URL/service token, Access team domain/audience. Add the review signing secret and user authentication configuration when the provider is selected. Store secret values with `npx wrangler secret put NAME`; never prefix a secret with `VITE_` or commit `.dev.vars`. Nonsecret URLs/audience can be Worker vars. This scaffold does not use these values yet.

Implement D1 repository ownership, rate limiting, request/body/time limits, private image validation and retention, authenticated API client, durable orchestration, actual evidence services, admin service integration and verified final-result display. Test owner isolation, expired/forged JWTs, signature failures, replayed events, stale/revoked approvals, malicious label/source instructions and server failures before enabling submission.

## 5. Worker deployment

Keep `workers_dev=false` and configure an approved API custom domain/route in Cloudflare. Add the selected route to `wrangler.toml` or dashboard only after domain/account configuration is known. Then, with authorization:

```sh
npx wrangler deploy
```

Configure frontend-to-API routing and strict same-origin CSRF protection, or an exact CORS allowlist with credentials and origin checks for a separate API domain. Do not use wildcard CORS for authenticated endpoints. Deploying this scaffold alone does not enable analysis or approval: `/api/health` reports all live capabilities false and other API routes return 503.

Finally check SPA links, upload limits, camera permission/fallback on physical iOS/Android devices, keyboard/RTL/dark mode, owner isolation, and audit/rollback behavior in staging. Back up D1 and define retention, monitoring, review revocation and incident handling before production use.
