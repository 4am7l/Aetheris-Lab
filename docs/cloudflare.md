# Cloudflare configuration

Aetheris Lab uses two independent Cloudflare Pages projects built from `4am7l/Aetheris-Lab`. Both call the existing `aetheris-lab-api` Worker through a Pages service binding. The Worker remains at `https://aetheris-lab-api.4am7l.workers.dev` and keeps its existing D1 database, private R2 bucket, and rate-limit bindings. The instructions below are for an approved release.

## 1. Configure the two Pages projects

1. Open **Workers & Pages** in the Cloudflare dashboard. Use the existing public project `aetheris-lab`. Create the second project through **Create application → Pages → Connect to Git**, select GitHub and choose `4am7l/Aetheris-Lab`.
2. Request the project name `aetheris-admin` and check the assigned hostname. Use the assigned HTTPS origin wherever this guide shows `https://aetheris-admin.pages.dev`. Configure the two projects as follows. Use Pages build system v3.

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
3. Under each project's **Settings → Bindings**, add or retain a **Service binding** named `AETHERIS_API` and select the existing `aetheris-lab-api` Worker for production. In the admin project's **Settings → Variables and Secrets**, add the text variable `ADMIN_ORIGIN` with the exact HTTPS origin and the encrypted secret `ADMIN_PROXY_SECRET`. Generate the secret as 32 random bytes encoded in 64 lowercase hex characters. Set that same value as a Worker secret. The public project needs no application runtime variables or secrets.
4. Under **Settings → Builds → Branch control**, select **None** for automatic preview deployments unless isolated staging is configured. Keep production auto-deploy paused until the Worker setup below is complete. To test on preview, use a separate Worker, D1 database, private R2 bucket, secrets, and a separate OAuth app registered to the exact staging hostname. Preview deploy URLs and project aliases are distinct origins. Give each staging admin environment one stable explicitly configured hostname.

Cloudflare references for [Pages monorepo setup](https://developers.cloudflare.com/pages/configuration/monorepos/), [build variables](https://developers.cloudflare.com/pages/configuration/build-image/), [Pages Functions directories](https://developers.cloudflare.com/pages/functions/get-started/#create-a-function), [service bindings](https://developers.cloudflare.com/pages/functions/bindings/#service-bindings), and [branch deployment controls](https://developers.cloudflare.com/pages/configuration/branch-build-controls/).

## 2. Register reviewer sign-in and configure the Worker

1. In GitHub, open **Settings → Developer settings → OAuth Apps → New OAuth App**, or use the equivalent settings for the owning organization. Set the homepage to `https://aetheris-admin.pages.dev/` and the authorization callback URL to `https://aetheris-admin.pages.dev/api/admin/auth/callback`. Leave the device flow disabled. Record the client ID and generate a client secret. The Worker requests GitHub sign-in without repository scopes. [GitHub OAuth app registration](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app).
2. Verify each qualified reviewer's GitHub account with them and obtain the numeric `id` from `GET https://api.github.com/users/USERNAME`. Usernames can change. The Worker allowlist uses numeric IDs.
3. In the existing Worker's **Settings → Variables and Secrets**, set the following production values. Use Worker secrets for the two secret entries.

   | Name | Kind | Value |
   | --- | --- | --- |
   | `ADMIN_ORIGIN` | Text | Exact assigned admin HTTPS origin, without a trailing slash |
   | `ADMIN_PROXY_SECRET` | Secret | Same 64 lowercase hex characters as on admin Pages |
   | `GITHUB_OAUTH_CLIENT_ID` | Text | GitHub OAuth application's client ID |
   | `GITHUB_OAUTH_CLIENT_SECRET` | Secret | GitHub OAuth application's client secret |
   | `REVIEWER_GITHUB_IDS` | Text | Comma-separated numeric IDs of qualified reviewers |
   | `PUBLIC_ORIGINS` | Optional text | Comma-separated exact origins for browser clients that call the public Worker directly. Leave unset for the standard Pages deployment. |

   The admin browser uses its own origin for all API calls. The Worker independently checks the admin Pages origin and proxy credential, and requires an authorized session for reviewer data and actions. The public Pages gateway accepts only the health, submissions, and tracking routes. GitHub OAuth credentials and the proxy secret belong in runtime settings and must stay out of build variables, repository files, and browser code.

## 3. Release the existing Worker and both frontends

1. Test against local D1 with `npx wrangler d1 migrations apply DB --local`. For an approved release, verify the configured D1 binding points to the existing database, then run `npx wrangler d1 migrations apply DB --remote` from the repository root. Migration 0003 backfills the public workflow without replacing existing requests or token hashes. Migration 0004 adds only reviewer OAuth state and session tables. Keep the `DB`, `IMAGES`, `SUBMISSION_LIMIT`, and `TRACKING_LIMIT` bindings. Keep the R2 bucket's public `r2.dev` URL and any public custom domains disabled.
2. Publish the existing Worker from the approved revision with `npm run worker:deploy -- --keep-vars` so Wrangler retains the dashboard text variables. Initially leave `AGENT_ENABLED=false` if Phase 4 analysis has yet to start. Keep the Pages runtime settings in place and release both Pages projects from the approved `main` revision. Changes to Pages Functions bindings take effect with a Pages deployment. [Wrangler dashboard variable preservation](https://developers.cloudflare.com/workers/wrangler/configuration/#source-of-truth).
3. Run the smoke checks below. To enable scheduled analysis, set `AGENT_ENABLED=true` when ready. Wrangler configures one cron tick a minute. Each tick takes the oldest eligible request. Failed or expired runs move to review and can be retried by a reviewer.

The optional OpenAI adapter requires `AI_PROVIDER=openai`, `AI_MODEL` set to a Chat Completions model supporting JSON mode, and Worker secrets `AGENT_API_KEY` and `AGENT_SYSTEM_PROMPT`. Use the supplied JSON schema and keep the original review constraints in the prompt. Treat source content as untrusted, flag only documented hazards and explicit pair concerns, make uncertainties explicit, and omit compatibility claims, narrative text, mixing procedures, ratios, and quantities. With no provider configured, the Worker still collects evidence and records that AI screening was unconfigured.

[PubChem PUG REST and PUG View](https://pubchem.ncbi.nlm.nih.gov/docs/) and the [NIOSH Pocket Guide](https://www.cdc.gov/niosh/npg/npg.html) supply identity and safety evidence. PubChem receives chemical identifiers. The optional AI adapter receives source excerpts, candidate reference identities, and coded information gaps. Tracking tokens, reviewer data, photos, free-form submission notes, and numeric solution conditions stay out of the AI request.

## API and smoke checks

- At the public Pages URL, submit a request and track it with its token. `POST /api/requests` accepts the existing Phase 3 JSON contract. The multipart form supports one `input` JSON string up to 32 KiB and optional `imageA` and `imageB` JPEG, PNG, or WebP files up to 10 MiB each.
- Check that `GET /api/requests/:id` returns `404` for missing, incorrect, and unrelated tokens. With the matching token, verify that only an approved receipt includes a published result.
- Open `/admin` on the public project and verify it shows the public app's not-found view. Check that `/api/admin/session` on public Pages returns `404`. On admin Pages, check that an unsigned call to `/api/admin/session` or to a request or photo endpoint returns `401` after configuration.
- From the admin project, sign in with an allowlisted GitHub account, inspect the private evidence, record an approval, and verify the matching receipt contains only the reviewer-authored result. Sign out and verify the session no longer works. Repeat with a GitHub account outside the allowlist and verify it never acquires a reviewer session.
- Run `npm run lint`, `npm run typecheck`, `npm run worker:check`, `npm test`, and `npm run build`. To exercise the cron locally, start the Worker with `npx wrangler dev --test-scheduled` and call `http://127.0.0.1:8787/__scheduled`.

## Security limits

- The admin login page and its static files are publicly reachable. The Worker authenticates reviewer data and actions. The session cookie stays on the admin hostname, and authorized reviewers can see the material they are permitted to review.
- Sign-in depends on GitHub availability. The application does not enforce GitHub MFA. Maintain the reviewer list and require strong account protection as part of reviewer onboarding. An active session can last up to eight hours. Signing out revokes that session in D1. Removing a reviewer ID blocks later authorized requests once the Worker configuration is active. Revoke that reviewer's D1 sessions before restoring their access so an unexpired session cannot become valid again.
- Cloudflare login throttling is approximate per IP per Cloudflare location. It protects the OAuth initiation endpoint from bursts but does not enforce a global cap. [Cloudflare rate limits](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/#accuracy).
- The tracking token is a bearer credential. Anyone holding the matching token can read that request's approved assessment. Keep tokens and OAuth credentials out of support screenshots and logs.
- Keep preview settings isolated. A new release does not remove historical Pages preview artifacts or rollbacks. Review those separately before using the public and admin projects with production data.
