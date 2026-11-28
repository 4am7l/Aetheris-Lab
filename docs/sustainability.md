# Sustainability and chemical intelligence

## Included workflows

| Workflow | Entry point |
| --- | --- |
| Existing anonymous assessment and scientific approval | Public **Analysis**, saved receipt, and admin request review |
| Assessment impact statistics and PDF | **Assessment impact** on an approved receipt or in an administrator’s assessment detail |
| Personal totals, historical trends and assessment breakdowns | Public **Personal Impact** uses the tracking credentials of receipts saved in the browser |
| Platform statistics, historical trends, PDF and CSV | Admin **Sustainability**. Filter by assessment date, chemical or existing affiliation. |
| Universities, departments, laboratories and invitations | **Institutional structure** |
| Chemical reference and versioned purchase, disposal, carbon and density records | **Prices and carbon factors** |
| Chemical explorer, comparison, compatibility matrix, 2D and 3D models | **Chemical Library → Open Chemical Explorer** or the workspace explorer |
| Storage compatibility and institution-approved emergency contacts | **Laboratory Workspace** |
| Inventory, stock movements and private SDS review | **Laboratory Workspace** and admin **Sustainability** |
| Periodic table and scientific calculators | Public **Science Tools**. The calculators are also available in the workspace. |

The public assessment uses the existing Worker, public and admin Pages integrations, D1, private R2, and qualified scientific approval. The dashboards calculate statistics from current approval and eligible historical ledger records on read. PubChem lookups use the existing bounded, authoritative source client.

## Supplied documents and reference data

The five-page Arabic chemical guide is the source for all 25 baseline reference records. Migration `0007` stores the source document name, SHA-256, section, page and row. The recorded SHA-256 is `bd4c08929dad1c6ca584e67a2ffa22f809336b4f58e0feab4e775d91e56f76ce`. The English names and searchable categories are descriptive mappings. The supplied concentration descriptions, hazard summaries, physical descriptions and waste categories are provisional reference material. Fields that the guide leaves unspecified remain null.

The 25 combined cost rates and 25 emissions factors retain their supplied values, including trailing zeroes, the printed unit labels and the original rows. Migration `0011` anchors the records to the guide's SHA-256 and protects the original formulations and rates from replacement and supersession. The costs use JOD per liter. The guide's methodology labels the emissions figures kg CO₂e per liter. All 50 version rows retain their unverified status. No independent pricing split, supplier, product SDS, price date, factor boundary, publication date or factor geography was supplied.

An approved assessment evaluates each submitted input against the fixed guide wherever the CAS is known. A matching formula, stated aqueous solvent, guide molarity and measured liquid volume support automatic use. Earlier qualified guide-match decisions remain readable. Ambiguous formulations, contradictory inputs and unavailable liquid volumes leave the guide estimates unavailable. A combined-reference estimate equals documented liters multiplied by the source rate. It describes the assessed material and stays outside savings totals. The assessment and its PDF display the original decimal strings, printed units and provenance.

New public, institutional and laboratory formulations and rate versions continue through the independent catalog management workflow. Create separate records for additional chemicals or grades and leave the original 25 guide rows intact.

Page 5 cites the following background references. The source material provides no underlying per-record calculations or direct factor citations.

1. U.S. EPA, 2020, Hazardous Waste Management System, 40 CFR Part 261.
2. U.S. EPA, 2023, Supply Chain Greenhouse Gas Emission Factors for U.S. Industries and Commodities, EPA/600/R-23/001, as cited in the guide.
3. IPCC, 2019 Refinement to the 2006 IPCC Guidelines, Volume 5, Waste.
4. ACS, 2017, Safety in Academic Chemistry Laboratories, 8th edition.
5. OSHA, 2012, Hazard Communication Standard, 29 CFR 1910.1200.

The two-page backend specification has SHA-256 `f7c74762541bb9011af024e3f00e352f9ebc5eb73b7bce21951cda9d001eecaf`. Its conversion example informs liter normalization. The pasted user request governs cost accounting, scenario boundaries, the treatment of confirmed outcomes, and the review gate. Confirmed segregation belongs to the segregation metric. A proposed mixture's physical final volume requires measurement or its own validated method. The attached disposal directions, mixing permissions, illustrated avoided incident costs and gas calculations have no role in the Worker or accounting engine.

## Accounting and evidence

Every stored model output includes the formula version, submitted quantities, baseline and intervention lines, applicability assumptions, source and version references, and results. A historical snapshot keeps its selected rates after a new version is added.

- **Financial.** Savings use baseline expense minus intervention expense. Platform and personal totals use historical JOD comparisons. Procurement and replacement are alternative views of the same expense. The net uses a complete, non-overlapping procurement, disposal, handling, treatment and recovery breakdown. Added intervention costs can produce a negative result. A documented zero differs from an unavailable comparison.
- **Environment.** Compare baseline and intervention for manufacturing, transport, treatment and disposal using an applicable stage-specific factor. A verified rate records its geography, lifecycle boundary, methodology, uncertainty, source and publication date. Boundaries must match within each stage. A total requires coverage of all stages, including a documented zero where appropriate. Mass and volume are different dimensions. Use a verified, formulation-specific density when converting a mass quantity to a volume-based rate, or use a mass-based rate. For verified waste prevention, a documented baseline and actual waste quantity must be supported by preservation or return of material. Segregation, recovery and disposal use independent activity metrics.
- **Eligibility.** A current human approval gates each comparison. The dashboards use one eligible hypothetical snapshot and at most one current verified or corrected outcome per assessment, in separate totals. Cancelled and rejected outcomes are excluded. A verified comparison needs recorded outcome evidence and an unambiguous ledger claim. The dashboard excludes shared evidence that could represent the same outcome across separate scopes. Historical snapshots remain intact. A safety warning is an assessment finding. The existing scientific approval has no structured baseline or realized outcome, so new approvals with only scientific findings show savings as unavailable.
- **Coverage.** Unavailable values are null and have explicit coverage counts. Volume assessed is the sum of the input volumes that were actually supplied. Grouping and date filters use the submitted assessment date. Latest verified quantities come from the action record. Avoided CO₂e is a model estimate even when its activity data is verified. Charts use the latest 120 occupied time periods in the selected grouping. All matching records contribute to totals. CSV exports cover up to 1,000 matching records and support narrower filters for larger reports.

## Authorization and operations

Public receipts retain their existing per-request bearer credential. The Personal Impact dashboard sends saved tracking proofs in the body of a same-origin read request. The Worker checks each proof against D1 and returns statistics only for matching requests. No profile, manual linking or affiliation is needed. The individual receipt and platform overview use separate receipt and administrator authorization. Invitations and optional affiliation remain part of the laboratory workspace.

Institution administrators manage their own scoped structure and records. The platform administrator sets up universities. The reviewer role is assigned only after the institution confirms qualification. Review, inventory, SDS management and report access use server-side tenant and laboratory constraints. Existing admin Pages session, proxy origin and CSRF checks protect the platform routes. The existing platform password account records its shared reviewer identity. Scoped memberships have distinct actor IDs. The existing rate-limit binding uses separate request budgets for receipt tracking and groups of impact features. Existing permanent deletion revokes the receipt and cascades the operation's impact history and affiliation. The stock history retains the minimum reference needed to reconcile its prior posted movements.

The SDS scanner reads the text layer on up to 40 pages in a dedicated PDF.js worker. Reviewers compare editable, page-numbered excerpts with the private original. An image-only or unrecognized document can be retained with manually verified excerpts. The existing private R2 bucket serves original SDS files as protected downloads. Inventory stock movements are atomic, idempotent and tied to the current verified event and selected exact formulation when an outcome is posted. A stock keeper records a documented adjustment if a later correction changes a previously posted stock quantity.

The application starts with no verified institutional rates, no institution-approved emergency contacts and no authorizations from the supplied compatibility tables. An applicable reviewed pair citation is necessary for a conditional or incompatible matrix result. All matrix outcomes require qualified review. Molecular models use PubChem coordinates when a discrete structure is applicable. The periodic table uses the PubChem 118-element dataset and distinguishes reference isotope masses from standard atomic weights. Publisher evidence and scope apply to external property lookups.

## Local checks

Use Node.js 26 and the repository lockfile.

```sh
npm ci
npm run lint
npm run typecheck
npm run worker:check
npm test
npm run build
npx wrangler d1 migrations apply DB --local
npx wrangler deploy --dry-run
```

The automated suite exercises the 25 imported prices and factors, calculation applicability, historical ledger behavior, receipt-scoped and administrator statistics, status changes and deletion, duplicate evidence, protected exports, inventory and SDS. The agent tests use mocked providers.

The browser regression test exercises the catalogue, calculators, approved receipts, automatic personal statistics, Arabic RTL, both themes, PDF downloads, and an SDS extraction and private R2 round trip. Create a disposable local D1 store, start the Worker and Vite in their own terminals, then run the test.

```sh
npx playwright install chromium
npx wrangler d1 migrations apply DB --local --persist-to .wrangler/impact-verification
npx wrangler dev --local --port 8787 --persist-to .wrangler/impact-verification --var AGENT_ENABLED:false
npm run dev -- --port 5173 --strictPort
npm run test:impact-browser
```

The test writes fixtures to that disposable local store and captures outputs in `.wrangler/impact-browser-results`. It requires an unused local test instance on those ports.

## Cloudflare rollout after release approval

1. Identify the existing public Pages, admin Pages and Worker versions for rollback. Record a D1 Time Travel bookmark. Use the existing release configuration in [Cloudflare setup](cloudflare.md).
2. Apply pending D1 migrations through `0012_impact_statistics.sql` in an isolated staging configuration with a separate Worker, D1 database and private R2 bucket. Migration `0012` adds an index for evidence comparisons and leaves existing rows intact. Run `npx wrangler d1 migrations apply DB --remote --config wrangler.staging.toml`. Set `AGENT_ENABLED=false` for staging checks of this release.
3. Release the staged Worker and both staged Pages builds. Exercise approved receipts, a cross-tenant rejection, bilingual PDF and CSV output, and private R2 access. Use only disposable fixtures.
4. Follow the production sequence in the [release audit and runbook](pre-release-audit.md). It specifies deployment against the existing D1, Worker and Pages projects.
5. Check an old approved receipt and both sign-in flows. Have the institution complete independent validation before activating any price, factor, scientific pair evidence or emergency procedure.

Cloudflare references for [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/), [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/), and [Pages branch controls](https://developers.cloudflare.com/pages/configuration/branch-build-controls/).

## Rollback after release approval

1. Roll back public and admin Pages to their last known good deployments. A brief version mismatch can make the new routes unavailable, so roll back the Pages interfaces together.
2. Roll the Worker back to the recorded compatible Worker version. Check the Workers secret and session guidance before selecting a version if the password or proxy secret changed. Check the old assessment receipt and admin routes.
3. Retain the additive D1 schema and private SDS objects during application rollback. Select the pre-sustainability application versions if the integrity checks need to be taken offline. A rollout to an earlier sustainability build can allow writes with the prior ledger rules. Restoring D1 to an earlier bookmark overwrites later data. Reserve a restore for an approved data recovery decision after preserving the new records and reconciling D1 and R2 references.

Cloudflare references for [Worker rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/), [Pages rollbacks](https://developers.cloudflare.com/pages/configuration/rollbacks/), and [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/).

## Operating limits

- No exchange-rate conversion is defined. The model treats each currency independently and reports missing categories explicitly.
- The guide supplies combined estimates and provisional environmental factors. The receipt shows their source, application and limits. Verified savings use independent applicable records.
- PDF reports use browser-rendered glyphs for bilingual typography. Report text is rendered onto pages as a high-resolution image. CSV provides machine-readable scoped operation data.
- PubChem may return multiple candidates, partial properties or a missing conformer. The explorer exposes gaps and the source, and offers an unavailable state when necessary. Validated pair evidence and emergency procedures are institution-managed.
- SDS extraction is limited to recognized headings in a text layer. It requires review of the original pages. An inventory correction may require a separate, authorized stock adjustment.
