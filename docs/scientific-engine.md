# Phase 5 scientific chemistry engine

The initial release evaluates a single analytical mass balance for a documented aqueous methanol dilution. Submissions outside that scope can still enter the existing evidence and review workflow. A computed concentration is conditional on the submitted formulation and measurements.

## Application and data flow

| Existing component | Phase 5 behavior |
| --- | --- |
| Public Pages form and proxy | Two solution cards, optional notes and private photos, and a bearer-token receipt. An optional declaration supplies the dilution assumptions and a measured final solution volume in L or mL. Omitting it preserves the original intake contract. |
| Worker intake and storage | The Worker validates the request before writing the original submission to `public_requests.input_json`. A separate table stores the tracking token hash. Photographs stay in private R2 under the existing rules. |
| Scheduled agent | Claims the next submitted request with a run ID and lease. It dispatches to a deterministic model and separately retrieves PubChem and NIOSH evidence. One lease-fenced D1 batch persists the draft, source evidence, and terminal run state. Existing triggers move completed, failed, and unconfigured runs to Pending Review. |
| D1 review data | The result, canonical operands, model version, and method references live in the optional `calculation` field of `public_assessment_drafts.report_json`. The validated Gemini focus, when present, is stored separately in the same draft. Existing drafts remain readable. This phase requires no migration or historical backfill. |
| Admin Pages and publication | The authenticated review workspace shows the calculation and sources. A qualified human reviewer checks the physical sample, conditions, and evidence before submitting an attested decision for the current run. Only the reviewer-authored assessment for an approved current run reaches the matching receipt-token holder. Quantitative drafts and Gemini outputs are private, including after a review decision. |
| Reviewer identity | The existing password, proxy, session and CSRF checks enforce reviewer access. The current shared reviewer credential must be held by a qualified chemist, and the review form records their attestation. The app uses a shared audit identity and has no individual credential verification. |

## Model interface and normalization

The Worker dispatches a validated calculation declaration through the model registry in `worker/chemistry/index.ts`. Each model owns its input eligibility, deterministic calculation, result limitations, and references. The dispatcher returns a tagged coverage decision.

- **Calculated** carries the model ID and version, normalized inputs, supported outputs, and references.
- **Needs information** lists missing inputs for the selected model.
- **Unsupported** lists out-of-scope fields and any missing inputs. A submission without a recognized declaration receives a coverage decision without inferred intent.

The normalizer uses a small versioned identity allowlist. It checks every supplied name, formula, and CAS against the applicable canonical PubChem CID, with a recognized name or CAS required. Formula is corroborating evidence. Identity resolution proves what the submitted identifiers describe. The reviewer verifies what the physical sample contains. The normalizer converts mL to L, g to kg, and °C to K, preserves concentration basis, and resolves recognized water solvent labels. It preserves explicit unknowns. Mass is distinct from volume, and mass concentration and percentages retain their submitted basis. Converting between these bases requires validated properties such as molar mass, density, or a defined mixture composition.

### Implemented calculation

A must describe a homogeneous aqueous stock with methanol as the sole solute, a concentration greater than 0 and at most 3 mol/L, and a positive stock volume. B must be declared pure water with no submitted solute concentration. The form records the declaration that both liquids and the measured final solution are at 25 °C and that methanol stays in the liquid. The measured final volume must exceed the stock volume. Free-text conditions or solution notes send the calculation to review because they could describe additional components or competing conditions. The 3 mol/L cap and temperature gate are scope decisions for this release.

The model uses `C_final = C_stock × (V_stock / V_final)`. It takes the measured final solution volume directly, which avoids a volume-additivity assumption. The water quantity is not an operand. The result is a nominal total analytical concentration in mol/L. This is an inventory balance with submitted inputs. No equilibrium, gas partitioning, chemical compatibility, kinetics, hazards, or uncertainty interval is inferred. Measurement uncertainty is explicitly unavailable. The number of digits shown is a display choice. The report retains the computed value for reproduction.

### Reference retrieval and provenance

The shipped method references are curated and were checked against their source pages. Each carries the source title, URL, section or compound ID, and verification date. They are persisted with the model version in each successful draft. The existing Worker separately retrieves PubChem compound identities and safety annotations and CDC/NIOSH Pocket Guide records, using bounded requests to fixed origins. It persists each excerpt with an evidence ID, source, URL, retrieval time, solution side, and run. PubChem safety annotations can aggregate third-party entries. Reviewers should verify the primary reference for any mixture-specific claim. A source or provider outage cannot substitute any of its content for the calculation's inputs. [PubChem PUG REST](https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest), [CDC/NIOSH Pocket Guide](https://www.cdc.gov/niosh/npg/), [OpenStax molarity](https://openstax.org/books/chemistry-2e/pages/3-3-molarity)

## Candidate engines and model coverage

| Model or data source | Status and capability | Conditions before enabling quantitative findings |
| --- | --- | --- |
| TypeScript aqueous dilution balance | **Implemented.** Aqueous methanol stock and pure water at the declared conditions above. Reports nominal analytical concentration and unavailable measurement uncertainty. | OpenStax method and published answer, exact rational benchmark, versioned eligibility gates. [OpenStax §3.3](https://openstax.org/books/chemistry-2e/pages/3-3-molarity) |
| PubChem / RDKit | PubChem identity and evidence retrieval is active. RDKit is a candidate for structure parsing and canonicalization when an unambiguous structure is available. | Distinguish salts, protonation states, stereochemistry and formulated products. An identity or molecular descriptor alone provides no mixture model. [PubChem PUG REST](https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest), [RDKit documentation](https://www.rdkit.org/docs/GettingStartedInPython.html) |
| PHREEQC / IPhreeqc, USGS | **Out of scope.** Candidate for activity-corrected aqueous speciation, simple acid/base systems, mineral equilibrium and selected salinity ranges using an appropriate ion-association, Pitzer or SIT database. | Pin the binary and database digest, review the database's applicable species, activity model and temperature/ionic-strength ranges, specify boundary conditions and candidate phases, and verify against independent reference systems and mass/charge balance. [USGS PHREEQC Version 3](https://www.usgs.gov/software/phreeqc-version-3) |
| NIST Chemistry WebBook SRD 69 | **Data candidate.** Compiled/evaluated pure-substance thermochemical and thermophysical data, with references and conditions varying by data series. | Select the actual record and units, capture the original citation and applicable ranges, and review redistribution terms. A separate model and validated mixture parameters are required for phase or activity predictions. [NIST Chemistry WebBook](https://webbook.nist.gov/chemistry/) |
| Cantera | **Out of scope.** Candidate for thermodynamics, equilibrium and kinetics within a defined phase and mechanism. | Pin the phase model, mechanism, and solver versions and verify the specific composition and operating domain against independent references. Generic solution submissions cannot be mapped onto an arbitrary mechanism. [Cantera Python tutorial](https://cantera.org/stable/userguide/python-tutorial.html) |
| Other aqueous reactions, nonaqueous or multiphase mixtures, unknown commercial formulations | **Unsupported.** Evidence collection and human review remain available. | Require exact formulation, applicable parameters, a model with explicit validity boundaries, and independent benchmarks before enabling output. |

For future models, add a declaration variant and a separately versioned adapter with its own output shape. Record database version/digest, parameter provenance, model validity limits, convergence diagnostics, and a reproducible benchmark manifest. Only report species and concentrations with a defined concentration basis, phases with an applicable phase model, and uncertainty with documented inputs and propagation. Unavailable parameters, nonconvergence, conservation failures, and invalid extrapolation should yield no quantitative result. Run native solvers in isolated services with pinned builds, bounded CPU and memory, deadlines, and a typed request/response contract. Keep the existing Worker as the policy and review boundary.

## Gemini integration

For a local or staging Worker, set `AGENT_ENABLED=true`, `AI_PROVIDER=gemini`, `AI_MODEL` to a Gemini model supporting structured output, and `AGENT_API_KEY` as a Worker secret. The adapter requests JSON with a restricted focus enum for the calculated, missing-input, or unsupported status. Local Zod validation rejects extra fields and the adapter verifies the selection is applicable. The renderer supplies fixed localized text from the accepted code. Gemini receives only the status, so submitted text, images, numbers, and citation excerpts stay outside this integration. A blocked, malformed, or unavailable response records an AI failure and leaves the deterministic draft available for review and retry. The legacy OpenAI adapter remains available for evidence flagging. [Gemini structured outputs](https://ai.google.dev/gemini-api/docs/structured-output), [GenerateContent API](https://ai.google.dev/api/generate-content)

## Reproduce the benchmarks

Run `npm ci` and `npx vitest run src/chemistry.test.ts src/worker-requests.test.ts src/public-requests-ui.test.tsx`. The tests use local SQLite and mocked outbound HTTP, with no credentials or production dependencies.

| Benchmark | Reference result | Comparison |
| --- | --- | --- |
| 25.0 mL stock at 2.04 mol/L, 500.0 mL final | **0.102 mol/L**, published exercise answer following Example 3.19. The fixture supplies the phase, 25 °C and pure-water declarations required by the application. | Absolute numerical error below `1e-14 mol/L`. This is test tolerance, with no implication for measurement uncertainty. [OpenStax §3.3](https://openstax.org/books/chemistry-2e/pages/3-3-molarity) |
| 0.080 L stock at 1.25 mol/L, 640 mL final | **0.15625 mol/L** from the exact rational inventory `(5/4 × 2/25)/(16/25) = 5/32`. | Exact binary-representable result. Independent reproduction with Python standard library below. |

```sh
python3 -c 'from fractions import Fraction as F; print(F("1.25") * F("0.080") / (F("640") / 1000))'
```

The tests also exercise unsupported conditions, missing inputs, conflicting identifiers, mixed units, invalid Gemini completions, private draft persistence, and the reviewer-only publication path. A live Gemini call requires a configured key and model.
