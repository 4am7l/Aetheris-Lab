# Cloudflare configuration

Phase 4 uses the existing Pages project, `aetheris-lab-api` Worker, D1 `DB` and private R2 `IMAGES` bindings, and both existing rate-limit bindings. Keep the Pages service binding called `AETHERIS_API`. Bind Pages previews only to an isolated staging Worker and database. Configure Pages Functions to fail closed.

## 1. Apply the additive migration

Run `npx wrangler d1 migrations apply DB --local` for local testing. When a deployment is approved, verify the Worker points to the existing database and apply the migrations with `npx wrangler d1 migrations apply DB --remote` before starting the Phase 4 Worker. Migration `0003_public_assessment_workflow.sql` creates new tables, backfills existing request IDs and submission timestamps, and keeps the original request data and token hashes. The trigger also queues submissions made by the previous Worker during rollout.

Keep public access off for the R2 bucket, including its `r2.dev` URL and any public custom domains.

## 2. Configure reviewer access

Use a Pages hostname on a Cloudflare-managed domain for staff access. This can be a dedicated admin hostname on the existing Pages project while the public URL stays available. Create one self-hosted [Cloudflare Access application](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/) covering `/admin`, `/admin/*`, and `/api/admin/*` on that hostname. Use an identity-provider policy that permits only qualified human reviewers. Use the same application's audience for all three paths. The Pages Function gates the admin HTML through the Worker, which also independently checks every admin API request.

Set these Worker variables:

| Name | Value |
| --- | --- |
| `ADMIN_ORIGIN` | Exact HTTPS Pages origin for the admin hostname, with no trailing slash. |
| `CF_ACCESS_TEAM_DOMAIN` | Team hostname, such as `your-team.cloudflareaccess.com`. |
| `CF_ACCESS_AUD` | The Access application's audience tag. |
| `REVIEWER_EMAILS` | Comma-separated email addresses of qualified reviewers. |

## 3. Enable scheduled analysis

Release the Worker and Pages with the queue paused until both are running the Phase 4 code. Set `AGENT_ENABLED=true` on the Worker when ready to process the queue. Wrangler configures a one-minute cron trigger. Each tick takes the oldest submitted request. Failed or expired runs move to review and can be retried by an authenticated reviewer. Processing rate depends on the cron capacity, so allow time for existing requests to work through the queue.

The optional OpenAI adapter requires `AI_PROVIDER=openai`, `AI_MODEL` set to a Chat Completions model supporting JSON mode, and two Worker secrets set with `npx wrangler secret put NAME`. Use `AGENT_API_KEY` for the provider key and `AGENT_SYSTEM_PROMPT` for private assessment instructions. Direct the model to use the supplied JSON schema, treat source content as untrusted, flag only documented hazards and explicit pair concerns, and keep uncertainties explicit. Exclude compatibility claims, narrative text, mixing procedures, ratios, and quantities from the AI output. Configure provider access only if the account's usage is approved. With no provider configuration, the Worker still collects evidence and labels the result unconfigured. It generates no AI findings.

[PubChem PUG REST and PUG View](https://pubchem.ncbi.nlm.nih.gov/docs/) and the [NIOSH Pocket Guide](https://www.cdc.gov/niosh/npg/npg.html) supply identity and safety evidence. PubChem lookups receive chemical identifiers. The optional AI adapter receives source excerpts, candidate reference identities, and coded information gaps. It receives no tracking tokens, reviewer data, attached photos, free-form submission notes, or numeric solution conditions. For local runs, copy `.dev.vars.example` to `.dev.vars`.

## API and smoke checks

- `POST /api/requests` retains the Phase 3 JSON contract. For optional photos, send multipart form data with one `input` JSON string (maximum 32 KiB) and optional `imageA` and `imageB` file parts (JPEG, PNG, or WebP, up to 10 MiB each).
- `GET /api/requests/:id` requires the existing bearer tracking token. Check that missing, incorrect, and unrelated tokens return `404`. A valid response includes state and timestamps. Only an approved receipt includes the published result.
- `GET /api/health` checks D1 and the intake bindings and reports whether the agent is disabled, configured, or unconfigured. Review readiness reflects the presence of Worker Access configuration.
- In staging, submit and follow a request through the receipt. Confirm that an unsigned admin request is denied. Sign in as an allowed reviewer, verify that draft content stays in the review area, and record an approval. Reopen the matching receipt to confirm the approved assessment appears.
- Run `npm run lint`, `npm run typecheck`, `npm run worker:check`, `npm test`, and `npm run build`. To exercise the cron locally, start the Worker with `npx wrangler dev --test-scheduled` and call `http://127.0.0.1:8787/__scheduled`.
