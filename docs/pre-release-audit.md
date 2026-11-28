# Aetheris Lab PR #18 release audit

The review compared the sustainability branch with the pre-sustainability application on `main`. The release changes use the existing Worker, both Pages projects, D1 and private R2. **Recommendation: NO-GO for production until the release gates below are met.** A passing suite verifies the software’s behavior with the supplied evidence and synthetic fixtures. Qualified reviewers and finance staff must establish the validity of real evidence.

## Confirmed defects and fixes

| Severity | Finding | Fix |
| --- | --- | --- |
| High | Alternate procurement categories, overlapping cost bases and repeated documentary cost lines could inflate category savings. A reviewed event could carry a scenario with unsupported rates or claim the same action as a second operation. | Use one procurement category and one cost basis per category and phase, reject repeated cost references, reserve evidence identifiers by scope atomically, require applicable verified rates for supplied reviewed categories, and compute currency amounts in minor units. |
| High | Quantity claims could exceed the original assessment or be reused across terminal outcomes and equivalent references. A CAS match alone could attach a rate or stock movement to a different formulation. | Require comparable measured quantities, enforce per-input and aggregate limits, check declared CAS, formulation, units and reference state, and reserve each supporting action's quantity across rate lines. Segregation can overlap a terminal outcome and has its own metric. Preservation and return may both count for separate identified assessment inputs. |
| High | Stored carbon factors and density could be applied with overlapping stage boundaries or incompatible conditions. | Require a stage-exclusive attestation for new verified factors, invalidate duplicate boundaries across stages, and require a recorded state and temperature for a density conversion tied to an assessment. Unknown and unverified values remain unavailable. |
| High | Correcting or cancelling a verified event left linked inventory previously posted to the container. | Append a compensating movement transactionally or expose a pending reconciliation when the current stock cannot cover the adjustment. An authorized stock handler can retry the same adjustment after checking the physical balance. Retain the original movements and reuse the originating container for corrections to a posted link. |
| High | Related draft SDS titles and identifiers could be exposed through list and deduplication responses. Institutional administrators could read global invoice identifiers. | Apply the document’s read policy to list, detail, download and duplicate responses. Keep invoice identifiers available to the owning institution or platform administrators. |
| Medium | An unscoped cursor looked up an arbitrary assessment’s position. Broad dashboard queries repeated the authorized dataset scan for each summary. | Resolve cursors inside the caller’s filtered dataset, use direct date ranges and scope indexes, and materialize the authorized dataset once for the aggregate views. |
| Medium | PDF uploads accepted files based on their first five bytes, and anonymous credential creation shared a permissive limit. | Check the PDF header, trailer and cross-reference offset, bound body and file size, keep stored files private, forbid self-review, and apply a 5/minute per-ingress-location limit to credential creation, redemption and original SDS uploads. |
| Medium | Intake rules differed between the Arabic interface and the server. Platform reviewers could publish scoped pair evidence and then could not select that scope for reading. PubChem comparison reset on each search. | Share locale-aware intake validation, retain legacy input readers, let authorized users choose one evidence scope, require two verified formulations for conditional compatibility, and keep comparison selection across searches. |
| Medium | Dashboard and reports blurred scenario estimates, documented outcomes and older snapshots. CSV omitted mass and carbon results derived from verified activity. | Separate estimates from verified outcomes, show data coverage and review requirements, label both kinds of carbon output as estimates, and export unavailable values as blank cells. Warnings remain findings and a verified no-action outcome contributes zero confirmed actions. |

## Regression coverage

- Exact-formulation, unit and density checks cover molality versus molarity, wrong solvent, wrong physical state, missing dimensions, numeric limits, stage overlap and publication dates. Financial checks cover currency precision, duplicate records, historical snapshots and missing evidence.
- Lifecycle checks cover the atomic report-to-pending transition, same-key retry, competing reviewers and competing claims, clarification, rejection, withdrawal, verification, correction, cancellation, no-action outcomes and stock compensation.
- Authorization checks cover requests between universities, departments and labs, role restrictions, scoped IDs and cursors, profile and member revocation, invitation replay, affiliation, private invoices and private SDS files. PDF coverage includes an invalid envelope and a byte-identical private download.
- Migration checks cover populated `0006` receipts, tracking credentials, approval snapshots, admin sessions, archives, restoration, permanent deletion and queued private-image cleanup. Legacy impact snapshots remain readable and excluded from current totals until re-reviewed.
- Chromium exercises the 390 px interface, both languages and text directions, theme switching, catalogue, calculators, comparison, workspace navigation, a reported and reviewed action, PDF and CSV downloads, and PDF.js extraction and a private local R2 round trip.

## Remaining limits and release gates

- A qualified scientist must validate the applicability of real formulations, conditions, product-specific SDS and compatibility references. The catalogue and PubChem identity do not establish solubility or authorize mixing. The app preserves uncertainty, and any permitted arithmetic model applies only within its stated scope. The imported price and emissions rows remain provisional. [IUPAC pH definition](https://goldbook.iupac.org/terms/view/P04524)
- Finance and environment reviewers must verify actual invoices, applicable density measurements, stage boundaries and transaction IDs. Issuing different identifiers for the same real-world record still requires human reconciliation. Negative results can be legitimate. Net totals are unavailable where a required category lacks evidence. Carbon outputs are modeled differences under a defined baseline and boundary. [GHG Protocol project accounting](https://ghgprotocol.org/project-protocol)
- The PDF server check validates the file envelope. Browser extraction processes at most 40 pages of embedded text and cannot authoritatively interpret scans or the full document. Original PDFs remain attachment-only and must be checked by an independent qualified reviewer. Generated PDF pages use rasterized bilingual typography and CSV is the machine-readable export.
- Institution-issued bearer credentials remain in local browser storage for repeat use. Revoke membership when access ends. Cloudflare’s per-location rate limit is an abuse control. Authorization checks use the verified role and scope separately.
- Earlier impact snapshots flagged for re-review keep their original numbers for traceability. Review any stock posted from those snapshots during pilot onboarding and reconcile the physical balance with an approved event. A stock correction of the same linked action applies to its original container. Check the original physical placement and use a documented inventory adjustment for an independent container movement.
- Rehearse the release in an isolated account configuration with `AGENT_ENABLED=false` and no Gemini key. Use representative tenant volumes and PDFs near the configured size limit. Obtain domain-owner sign-off, review the documented rate and storage headroom, and confirm rollback versions before scheduling production.
- Migration `0011` protects the 25 original guide formulations, prices and factors and records reviewer decisions about matching the guide. Fixed figures apply on authorized approved receipts, including receipts with no affiliation. Their source strings and provenance appear in the catalog, receipt and operation PDF. Combined estimates and modeled emissions stay outside the verified ledger.

## Cloudflare Free plan

- Workers Free allows 100,000 requests/day, 10 ms CPU per request, 128 MB memory and 50 subrequests per request. D1 allows 50 queries per invocation on Free, 100 parameters per statement, 32 function arguments and 500 MB for a single free database. The calculation batches chunk rate lookups at 90 IDs and the aggregate queries bound their result sets. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) · [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
- D1 Free includes 5 million rows read and 100,000 rows written per day with 5 GB of storage across the account. A scoped dashboard still examines matching history, and chemical substring searches and all-time institutional or global dashboards can become costly. Measure D1 rows read and written per request and check Worker CPU at representative scale. CSV is limited to 1,000 matching rows per export. [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- Standard R2 includes 10 GB-month, 1 million Class A operations and 10 million Class B operations monthly. The existing bucket shares this allowance with assessment images. The 5 MiB SDS upload cap and per-location rate limit do not cap cumulative storage. Monitor storage and the costs of retry, upload and download traffic. [R2 pricing](https://developers.cloudflare.com/r2/pricing/)

## Production runbook after explicit release approval

1. Complete the release gates and use the approved revision in a clean checkout. In both existing Pages projects, pause automatic production branch builds and keep unapproved preview branches disabled. Record the current production deployment ID of each Pages project and the current Worker version. Keep the production R2 bucket private and retain the existing bindings, Worker variables, and credentials. [Pages configuration](cloudflare.md) · [Pages Git rollout controls](https://developers.cloudflare.com/pages/configuration/git-integration/)
2. From the repository root, check the existing Worker versions and D1 migration status, and record a current D1 Time Travel bookmark immediately before the release. The Cloudflare account must own `aetheris-lab-api`, `aetheris-lab-db`, `aetheris-lab-private-images`, `aetheris-lab` and `aetheris-admin`. [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/) · [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)

   ```sh
   npm ci
   npm run build
   npx wrangler deployments list --config wrangler.toml
   npx wrangler d1 migrations list aetheris-lab-db --remote --config wrangler.toml
   npx wrangler d1 time-travel info aetheris-lab-db --config wrangler.toml
   ```

3. Apply pending migrations in filename order and verify migrations through `0012_impact_statistics.sql` show as applied. Deploy the Worker first with the existing `DB`, `IMAGES`, `SUBMISSION_LIMIT` and `TRACKING_LIMIT` bindings and preserved secrets. Check health, a historical receipt and a guide-covered unaffiliated fixture in staging before deploying either UI.

   ```sh
   npx wrangler d1 migrations apply aetheris-lab-db --remote --config wrangler.toml
   npx wrangler d1 migrations list aetheris-lab-db --remote --config wrangler.toml
   npx wrangler deploy --config wrangler.toml --keep-vars
   curl -fsS https://aetheris-lab-api.4am7l.workers.dev/api/health
   ```

4. Upload the matching builds to the existing production Pages projects from their respective roots. Keep both `AETHERIS_API` service bindings directed to `aetheris-lab-api`. Retain `ADMIN_ORIGIN` and the encrypted `ADMIN_PROXY_SECRET` in admin Pages. Check the public app, admin sign-in and standard approved receipt, and inspect the expected denial for an invalid private credential. [Pages Wrangler deploy](https://developers.cloudflare.com/pages/get-started/direct-upload/)

   ```sh
   npx wrangler pages deploy dist --project-name aetheris-lab --branch main
   npx wrangler --cwd admin pages deploy dist --project-name aetheris-admin --branch main
   ```

## Rollback

1. In each existing Pages project, select the recorded production deployment and use **Rollback to this deployment**. Roll the Worker back to the recorded compatible pre-sustainability version, using the known current secret/session configuration. Verify an old receipt, admin authentication, archive and deletion behavior. [Pages rollback](https://developers.cloudflare.com/pages/configuration/rollbacks/) · [Worker rollback](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)

   ```sh
   npx wrangler rollback "$PRE_RELEASE_WORKER_VERSION" --config wrangler.toml
   ```

2. Keep the additive schema and existing R2 objects during application rollback. Migration `0012` adds an index and needs no data rollback. Rolling the Worker back to a pre-dashboard build restores that build’s manual impact routes.
3. Use D1 Time Travel only after a separate data-recovery decision. Pause writes, record a current bookmark, preserve or reconcile post-bookmark D1 changes and check R2 separately. Time Travel replaces the database in place and leaves R2 objects as they were at the time of rollback. [D1 Time Travel recovery](https://developers.cloudflare.com/d1/reference/time-travel/)

   ```sh
   npx wrangler d1 time-travel restore aetheris-lab-db --bookmark "$PRE_RELEASE_D1_BOOKMARK" --config wrangler.toml
   ```
