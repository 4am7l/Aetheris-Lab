# Cloudflare configuration

Aetheris Lab uses two independent Cloudflare Pages projects built from `4am7l/Aetheris-Lab`. Both call the existing `aetheris-lab-api` Worker through a Pages service binding. The Worker remains at `https://aetheris-lab-api.4am7l.workers.dev` and keeps its existing D1 database, private R2 bucket, and public API rate-limit bindings. The approved Phase 4 release activates sign-in and the reviewer workflow. The earlier standalone admin build on `main` serves the static interface.

## 1. Configure the two Pages projects

1. Open **Workers & Pages** in the Cloudflare dashboard. Use the existing public project `aetheris-lab` and admin project `aetheris-admin`. If the admin project is missing, create it through **Create application → Pages → Connect to Git** and select `4am7l/Aetheris-Lab`.
2. Check the assigned admin hostname. Use that exact HTTPS origin wherever this guide shows `https://aetheris-admin.pages.dev`. The table shows the settings for the approved Phase 4 revision. Use Pages build system v3. Keep the current public build command in place while serving the earlier revision. That revision uses `npm run build`.

   | Setting | Public project | Admin project |
   | --- | --- | --- |
   | Production URL | `https://aetheris-lab.pages.dev` | `https://aetheris-admin.pages.dev`, subject to availability |
   | Production branch | `main` | `main` |
   | Framework preset | None | None |
   | Root directory | Leave blank (repository root) | `admin` |
   | Build command | `npm run build:public` | `npm --prefix .. ci && npm --prefix .. run build:admin` |
   | Build output directory | `dist` | `dist` (repository path `admin/dist`) |
   | Pages build variables | `NODE_VERSION=26` | `NODE_VERSION=26`, `SKIP_DEPENDENCY_INSTALL=true` |

   The admin command installs from the shared root lockfile. Setting the project root to `admin` makes Pages package `admin/functions/` for that project. The public project packages the root `functions/` directory. Neither application requires a `VITE_*` variable.
3. Under each project's **Settings → Bindings**, add or retain a **Service binding** named `AETHERIS_API` and select the existing `aetheris-lab-api` Worker for production. In the admin project's **Settings → Variables and Secrets**, add the text variable `ADMIN_ORIGIN` with the exact HTTPS origin and the encrypted secret `ADMIN_PROXY_SECRET`. Generate the proxy secret in a private terminal using `node -p "require('node:crypto').randomBytes(32).toString('hex')"`. Set that same 64-character value as a Worker secret. The public project needs only its service binding at runtime.
4. Under **Settings → Builds → Branch control**, select **None** for automatic preview deployments unless isolated staging is configured. Pause production auto-deploy before merging the Phase 4 PR. For staging, use a separate Worker, D1 database, private R2 bucket, proxy secret, and generated admin password. Configure the same stable staging HTTPS origin on admin Pages and its Worker. Preview deployment URLs and branch aliases each have their own origins.

Cloudflare references for [Pages monorepo setup](https://developers.cloudflare.com/pages/configuration/monorepos/), [build variables](https://developers.cloudflare.com/pages/configuration/build-image/), [Pages Functions directories](https://developers.cloudflare.com/pages/functions/get-started/#create-a-function), [service bindings](https://developers.cloudflare.com/pages/functions/bindings/#service-bindings), and [branch deployment controls](https://developers.cloudflare.com/pages/configuration/branch-build-controls/).

## 2. Generate the admin password and configure the Worker

1. From the repository root, run `node scripts/generate-admin-password.mjs` in a private terminal. The script generates 32 random bytes and displays the 43-character base64url password and its SHA-256 verifier. Save the password in your password manager. Use a freshly generated password for each environment. Keep both values out of chat, screenshots, logs, and repository files.
2. In **Workers & Pages → aetheris-lab-api → Settings → Variables and Secrets**, set the production values below. For `ADMIN_PASSWORD_HASH`, paste the part after `ADMIN_PASSWORD_HASH=` including `sha256$`.

   | Name | Kind | Value |
   | --- | --- | --- |
   | `ADMIN_ORIGIN` | Text | Exact assigned admin HTTPS origin, without a trailing slash |
   | `ADMIN_PROXY_SECRET` | Secret | Same 64 lowercase hex characters as on admin Pages |
   | `ADMIN_PASSWORD_HASH` | Secret | The generated verifier in `sha256$<64 lowercase hex characters>` format |
   | `PUBLIC_ORIGINS` | Optional text | Comma-separated exact origins for browser clients that call the public Worker directly. Leave unset for the standard Pages deployment. |

   Store `ADMIN_PASSWORD_HASH` only on the Worker. Only `ADMIN_ORIGIN` and `ADMIN_PROXY_SECRET` go on admin Pages alongside the service binding. The Worker checks the exact admin origin and proxy credential, then requires a valid session for reviewer data and actions. The public Pages gateway accepts only the health, submissions, and tracking routes. Keep runtime secrets out of `VITE_*` and other build variables.

## 3. Release the existing Worker and both frontends

1. Test against local D1 with `npx wrangler d1 migrations apply DB --local`. For an approved release, verify the configured D1 binding points to the existing database, then run `npx wrangler d1 migrations apply DB --remote` from the repository root. Migration 0003 backfills the public workflow and preserves existing requests and tracking-token hashes. Migration 0004 is retained for databases that already applied it. Migration 0005 invalidates earlier sign-in sessions and adds password sessions and login counters while preserving review records. Keep the `DB`, `IMAGES`, `SUBMISSION_LIMIT`, and `TRACKING_LIMIT` bindings. Keep the R2 bucket's public `r2.dev` URL and any public custom domains disabled.
2. Publish the existing Worker from the approved revision with `npm run worker:deploy -- --keep-vars` so Wrangler retains the dashboard text variables. Initially leave `AGENT_ENABLED=false` if Phase 4 analysis has yet to start. Keep the Pages runtime settings in place and release both Pages projects from the approved `main` revision. Changes to Pages Functions bindings take effect with a Pages deployment. [Wrangler dashboard variable preservation](https://developers.cloudflare.com/workers/wrangler/configuration/#source-of-truth).
3. Run the smoke checks below. To enable scheduled analysis, set `AGENT_ENABLED=true` when ready. Wrangler configures one cron tick a minute. Each tick takes the oldest eligible request. Failed or expired runs move to review and can be retried by a reviewer.

The optional OpenAI adapter requires `AI_PROVIDER=openai`, `AI_MODEL` set to a Chat Completions model supporting JSON mode, and Worker secrets `AGENT_API_KEY` and `AGENT_SYSTEM_PROMPT`. Use the supplied JSON schema and keep the original review constraints in the prompt. Treat source content as untrusted, flag only documented hazards and explicit pair concerns, make uncertainties explicit, and omit compatibility claims, narrative text, mixing procedures, ratios, and quantities. With no provider configured, the Worker still collects evidence and records that AI screening was unconfigured.

[PubChem PUG REST and PUG View](https://pubchem.ncbi.nlm.nih.gov/docs/) and the [NIOSH Pocket Guide](https://www.cdc.gov/niosh/npg/npg.html) supply identity and safety evidence. PubChem receives chemical identifiers. The optional AI adapter receives source excerpts, candidate reference identities, and coded information gaps. Tracking tokens, reviewer data, photos, free-form submission notes, and numeric solution conditions stay out of the AI request.

## API and smoke checks

- At the public Pages URL, submit a request and track it with its token. `POST /api/requests` accepts the existing Phase 3 JSON contract. The multipart form supports one `input` JSON string up to 32 KiB and optional `imageA` and `imageB` JPEG, PNG, or WebP files up to 10 MiB each.
- Check that `GET /api/requests/:id` returns `404` for missing, incorrect, and unrelated tokens. With the matching token, verify that only an approved receipt includes a published result.
- Open `/admin` on the public project and verify it shows the public app's not-found view. Check that `/api/admin/session` on public Pages returns `404`. On admin Pages, check that an unsigned call to `/api/admin/session` or to a request or photo endpoint returns `401` after configuration.
- In staging, try a wrong password and verify that the Worker returns `401` without issuing a session. Exercise rate limiting in staging and check for `429` and `Retry-After`. Sign in with the generated password. Refresh the page, inspect the private evidence and photos, record an approval, and verify the matching receipt contains only the reviewer-authored result. Sign out and verify the session no longer works. Use staging data for decision and submission tests.
- Run `npm run lint`, `npm run typecheck`, `npm run worker:check`, `npm test`, and `npm run build`. To exercise the cron locally, start the Worker with `npx wrangler dev --test-scheduled` and call `http://127.0.0.1:8787/__scheduled`.

## Security limits

- The admin login page and its static files are publicly reachable. The Worker gates reviewer data and actions. Its `Secure`, `HttpOnly`, `SameSite=Strict` session cookie stays on the admin hostname. Review changes and sign-out require the same origin and a session-bound CSRF token.
- Share the generated admin password only with qualified reviewers through a password manager. Audit entries record one shared identity, `password:admin`. Sessions expire after eight hours, and sign-out revokes the current session in D1. To rotate access, generate a fresh password, replace `ADMIN_PASSWORD_HASH` on the Worker, and activate the updated settings. Existing sessions tied to the old verifier then require a fresh sign-in.
- D1 allows up to 5 login attempts per IP and 30 across all IPs in a rolling 15-minute window. Once a limit is reached, even a valid password must wait until the window frees an attempt. The login limiter stores IP digests.
- The tracking token is a bearer credential. Anyone holding the matching token can read that request's approved assessment. Keep tokens, passwords, verifiers, and proxy credentials out of support screenshots and logs.
- Keep preview settings isolated. A new release does not remove historical Pages preview artifacts or rollbacks. Review those separately before using the public and admin projects with production data.
