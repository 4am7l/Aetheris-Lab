# Cloudflare deployment preparation

The Worker supports accountless public intake and tracking using D1. Each public receipt reports the `Submitted` state. Identification, analysis, and review integrations remain disabled. The frontend runs independently of the Worker.

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

## 3. Configure Worker bindings and migrations

Confirm that the `DB` binding and its database UUID in `wrangler.toml` point to the existing D1 database. Confirm the existing `IMAGES` bucket binding and keep its public access off. Public intake stores JSON in D1.

Migration `0002_public_request_tracking.sql` adds `public_request_tokens`, keyed by request ID. It creates `public_requests` only when missing, as the repository's initial migration does not define it. For an externally provisioned table, confirm that `id` is a text primary key and that `input_json`, `status`, `created_at`, and `updated_at` accept the API's insert with status `Submitted`. Check the existing schema before applying the migration to the remote database. Existing rows require a matching token record to be accessible through the API.

Wrangler configures two [Cloudflare Rate Limiting bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) with separate namespaces. Confirm that IDs `1001` and `1002` are unused by other applications in the account or assign unused IDs before deployment. Submission allows 5 calls/minute and tracking allows 30 calls/minute per `CF-Connecting-IP` at each Cloudflare location. Cloudflare's edge counters are approximate. A missing client IP shares a single bucket. Keep the Cloudflare-provided header on the public ingress route. Intake and tracking require no Cloudflare secrets.

```sh
npx wrangler d1 migrations apply DB --local
npm run worker:dev
```

## Public request API

`POST /api/requests` accepts an uncompressed UTF-8 `application/json` body of at most 32 KiB, with an optional `charset=utf-8` parameter. The required fields are `a`, `b`, and `conditions`. Each solution requires the fields below. Extra fields are rejected.

```json
{
  "a": {
    "name": "Sample A",
    "formula": "Unknown",
    "cas": "Unknown",
    "concentration": "Unknown",
    "unit": "Unknown",
    "solvent": "Unknown",
    "state": "Unknown",
    "temperature": "Unknown",
    "quantity": "Unknown",
    "quantityUnit": "Unknown",
    "notes": "",
    "source": "Manual entry"
  },
  "b": {
    "name": "Sample B",
    "formula": "Unknown",
    "cas": "Unknown",
    "concentration": "Unknown",
    "unit": "Unknown",
    "solvent": "Unknown",
    "state": "Unknown",
    "temperature": "Unknown",
    "quantity": "Unknown",
    "quantityUnit": "Unknown",
    "notes": "",
    "source": "Manual entry"
  },
  "conditions": ""
}
```

Names, formulas, CAS numbers, and solvents are trimmed and require 1–200 characters. A known CAS number must have a valid checksum. Numeric values are finite decimal strings or `"Unknown"`. Known concentrations and quantities require units and must be nonnegative. Percentages are limited to 100 and temperature is expressed in °C at or above −273.15. Concentration units are `% w/w`, `% v/v`, `mol/L`, `g/L`, and `Unknown`. Quantity units are `mL`, `L`, `g`, `kg`, and `Unknown`. States are `Liquid`, `Solid`, `Gas`, and `Unknown`. Sources are `Manual entry` and `NIOSH catalog`. Each `notes` field allows up to 2,000 characters and `conditions` allows up to 3,000.

A successful submission returns `201` with `id`, `status`, `createdAt`, `updatedAt`, and `trackingToken`. Save the token from the creation response. The Worker stores its SHA-256 digest and cannot recover the original. Example using the JSON above saved as `request.json` and the local Worker URL:

```sh
curl -i http://127.0.0.1:8787/api/requests \
  -H 'Content-Type: application/json' --data-binary @request.json
curl -i http://127.0.0.1:8787/api/requests/REQUEST_ID \
  -H 'Authorization: Bearer TRACKING_TOKEN'
```

`GET /api/requests/:id` accepts the token through the `Authorization` header and returns only `id`, `status`, `createdAt`, and `updatedAt`. Missing or incorrect tokens and unknown IDs all return `404`. Use HTTPS for non-local calls and keep tokens out of URLs and application logs. Both endpoints send `Cache-Control: no-store`. For browser use, serve the frontend and API on the same origin. The tracking token authorizes receipt access.

Invalid JSON or input returns `400`, oversized bodies return `413`, unsupported media types return `415`, and a throttled call returns `429` with `Retry-After: 60`. Storage or binding failures return `503`. The `GET /api/health` response reports readiness for submission and tracking once the bindings and D1 schema are available. Its `identification` and `review` flags remain false.

## 4. Future administrator authentication and integrations

Create a dedicated Cloudflare Access application/policy for administrator service traffic. Configure team domain and audience, implement JWKS signature verification with pinned issuer/audience, and bind verified reviewers to application roles. Implement the contract in `admin-review.md` before enabling review routes.

Worker-only configuration names are listed in `.dev.vars.example`: identity provider URL/key, safety-data provider URL/key, agent key, Admin URL/service token, Access team domain/audience. Add the review signing secret and user authentication configuration when the provider is selected. Store secret values with `npx wrangler secret put NAME`; never prefix a secret with `VITE_` or commit `.dev.vars`. Nonsecret URLs/audience can be Worker vars. This scaffold does not use these values yet.

Implement owner-scoped authenticated access, private image validation and retention, durable orchestration, evidence services, verified administrator review, and final-result display before enabling those integrations.

## 5. Worker deployment

For a production custom domain, set `workers_dev=false` and configure the selected API route in `wrangler.toml` or the dashboard. After the local checks pass, apply the remote migration and deploy when authorized:

```sh
npx wrangler d1 migrations apply DB --remote
npx wrangler deploy
```

In staging, check `/api/health` and verify submission, token-protected lookup and throttling before directing users to the API.
