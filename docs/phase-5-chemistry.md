# Phase 5 scientific chemistry engine

## Existing application and trust boundaries

The public React app collects two sample descriptions, optional private images, and conditions. The Pages Function forwards submissions to the Worker, which validates them, persists the request in D1, and issues a token-protected receipt. The scheduled Worker claims one eligible request at a time. It retrieves PubChem and NIOSH records, and writes evidence and private draft JSON in a lease-fenced D1 batch. Admin Pages displays the current run. The authenticated, CSRF-protected review API records a decision for that run in a guarded write. A D1 trigger transitions the workflow, and token tracking reads only the approved result.

Phase 5 adds an optional structured sample declaration to the existing JSON input. Existing requests and drafts remain readable. The workflow uses the existing tables, lease, review decision, audit trail, and archive/delete paths. No D1 migration or data backfill is required. A legacy draft gains a calculation only through a new agent run.

## Calculation architecture

1. **Intake** stores the original two solution forms and, when supplied, the measured final volume and the submitter's closed water/NaCl-only declaration. Other submissions still enter expert review.
2. **Normalization** uses explicit, curated identity aliases with agreement across supplied identifiers. It normalizes water aliases and liquid state, stock concentration to mol/L, stock volume to L, and temperature to numeric °C. The NIST molar mass converts sodium chloride from g/L. Mass quantities and percent bases require density or additional formulation information, so the first model rejects those bases. PubChem lookup remains independently available to a reviewer, including ambiguous matches.
3. **Model selection** routes normalized input to a versioned model with an explicit applicability check. Results either carry a model/version, bounded outputs, and reference records, or a reason list with missing fields and out-of-scope conditions. Unsupported or incomplete requests carry no estimates.
4. **Evidence** collection retains the existing source URL, title, excerpt, side, and retrieval timestamp for live PubChem/NIOSH lookups. The model uses references retrieved and checked at design time. Every calculated result snapshots each reference's publisher, stable ID, URL, version or DOI, locator, and retrieval date. The reference fixture pins the independent solver and database content. Runtime calculation is independent of those sites' availability.
5. **Explanation** runs separately after the model records its decision. With Gemini selected, the Worker sends status and coded reasons, then requests a selection and ordering of allowed explanation topics using JSON Schema. A local strict schema and uniqueness check reject unexpected fields, unknown topics, malformed responses, and non-complete candidates. The UI maps accepted topic IDs to reviewed text. Gemini receives no user-entered prose, images, chemistry inputs or outputs, URLs, tokens, or reviewer details. A Gemini failure leaves the deterministic draft available for review and retry. The legacy OpenAI evidence-screening integration remains available under its existing configuration.
6. **Publication** requires an authenticated reviewer, qualification/evidence attestation, and explicit selection of the calculation. The Worker copies the validated result from the current private run. Approval requests cannot supply model output, and calculation references do not satisfy the separate requirement for a formulation-specific compatibility reference. Public token tracking exposes the approved snapshot only after that decision. The Gemini explanation and normalized stock ledger stay in the private draft.

`worker/chemistry/normalize.ts` is the intake adapter, `model.ts` defines the model contract, and `index.ts` routes to registered implementations. A new model adds its own applicability envelope, versioned result shape, provenance, and independent benchmark fixtures. If future applicability overlaps, define explicit precedence and tests before registering the model. For a native solver, use an isolated version-pinned service with typed request/response contracts, hard resource limits, and no arbitrary user-supplied engine commands. Record solver, dataset, model compatibility, diagnostics, and benchmark versions. Model convergence, mass/charge closure, and supported output fields are release gates for an equilibrium adapter.

## Model coverage matrix

| Submission or requested result | Phase 5 | Model, conditions, or evidence needed |
| --- | --- | --- |
| Two dilute aqueous NaCl stocks at 25 °C | Supported for Na⁺ and Cl⁻ amounts and concentrations in a single aqueous liquid | Versioned stoichiometric mass balance. Requires the conditions below. |
| Missing identity, stock concentration, volume, solvent, state, temperature, or measured final volume | Missing input | Reviewer sees the missing fields. |
| Conflicting identifiers, commercial formulations, other solutes, nonaqueous solvent, or free-text mixture conditions | Unsupported | Resolve composition and use a model validated for the specific system. |
| Aqueous acid/base or buffers, pH, ionic activity, and metal complexation | Unsupported | Candidate PHREEQC or Reaktoro adapter. Requires a compatible database, activity model, and qualified benchmark sets. |
| Concentrated electrolytes, precipitation, gas evolution, redox, or multiple phases | Unsupported | A validated system-specific activity/phase model plus complete composition and boundary conditions. |
| Kinetics, heat release, organic reaction prediction, and material compatibility | Unsupported | Qualified reaction/mechanism or formulation-specific evidence. |

### Candidate tools and sources

| Tool or database | Role and limits |
| --- | --- |
| [USGS PHREEQC and IPhreeqc](https://pubs.usgs.gov/publication/tm6A43) | Independent speciation benchmark for this release. PHREEQC provides aqueous model choices, gas/mineral equilibria, and mixing. A future adapter must validate the chosen database and model for its specific chemicals and conditions. |
| [USGS Pitzer database](https://water.usgs.gov/water-resources/software/PHREEQC/documentation/phreeqc3-html/phreeqc3-37.htm) | Parameters for aqueous electrolyte nonideality. The benchmark uses the version pinned in the fixture. A database listing alone cannot establish coverage. |
| [Reaktoro](https://reaktoro.org/v1/thermodynamic-databases.html) | Candidate multiphase equilibrium service with PHREEQC/SUPCRT/GEMS datasets. Species, phases, and valid temperature/pressure ranges depend on the selected dataset. |
| [Cantera](https://cantera.org/stable/reference/thermo/phase-thermo.html) | Candidate when a curated phase/mechanism exists, including documented Pitzer support. General kinetics requires a validated system-specific mechanism. |
| [PubChem PUG REST](https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest), [NIOSH Pocket Guide](https://www.cdc.gov/niosh/npg/) | Identity and hazard evidence. Retrieved records inform expert review and do not determine formulation thermodynamics. |
| [NIST Chemistry WebBook, SRD 69](https://webbook.nist.gov/cgi/cbook.cgi?ID=C7647145), [IUPAC Gold Book](https://goldbook.iupac.org/terms/view/A00295/pdf) | Reference molar mass, identity, and amount-concentration definition used by the initial workflow. |
| [IAPWS R11-24](https://iapws.org/technical-guidance/release/Ionization) | Candidate source for the temperature/density-dependent ionization constant of water if a validated acid/base adapter is added. |

## Sodium chloride workflow

Both inputs describe liquid NaCl stocks in water at **25 °C** and ambient pressure. An input can describe water by entering **0 mol/L** NaCl in the second stock and explicitly confirming there are no other solutes. Each nonzero stock and the final liquid must fall within **1 × 10⁻⁶ to 0.010 mol/L**. Each stock aliquot must be **1 mL to 10 L**. The measured final volume must be within **1%** of the sum of the two stock volumes as a consistency check. This check is a model admission criterion. The denominator is the measured final volume. Free-text conditions and stock notes route to manual review because they may describe undisclosed components or operating conditions.

The model assumes a single dilute water phase and treats dissolved NaCl as fully dissociated. Moles of each modeled ion equal `cA × VA + cB × VB`. Each modeled concentration is that amount divided by the measured final volume. The published estimate covers those two ions and the modeled liquid phase. The model omits solvent concentration, water self-ionization, activities, ion pairing, phase searches, hazards, kinetics, and compatibility. A quantitative uncertainty interval would require measurement uncertainties and a justified propagation model. The displayed precision is a formatting choice.

## Independent benchmark and application verification

The benchmark inputs are in [the reference fixture](../src/fixtures/nacl-reference.json). IPhreeqc simulates two stocks using its calculated densities and scales its solution amounts to their aliquot volumes. It mixes the stocks with halite initially absent and available to precipitate, then returns the individual aqueous ion amounts and halite saturation index. The verifier divides those amounts by the same submitted final volume so the concentration bases match. This checks the complete-dissociation approximation and the single aqueous phase in the named reference cases. It is a reference-solver comparison, without experimental validation or support for other formulations. The test tolerance checks agreement with the fixture and does not express measurement uncertainty.

To reproduce the reference results, use Python with [PhreeqPy 0.6.0](https://pypi.org/project/phreeqpy/0.6.0/), IPhreeqc 3.7.3-15968, and the pinned `pitzer.dat` file identified by URL and SHA-256 in the fixture. The script checks the library version and database hash before running.

```sh
python -m pip install phreeqpy==0.6.0
python scripts/verify-chemistry-reference.py /path/to/IPhreeqc-library /path/to/pitzer.dat
npm test
```

Vitest compares the Worker output with the checked-in PHREEQC results without a network or a native solver. Other tests exercise input gating, Gemini schema rejection, retention of the deterministic draft on provider failure, and authenticated publication with and without the calculation selected.

## Gemini configuration

Enable the scheduled agent with the existing `AGENT_ENABLED=true` setting. To choose Gemini, set `AI_PROVIDER=gemini`, choose an available `AI_MODEL` that supports structured outputs, and provide `AGENT_API_KEY` as a Worker secret. The server sends the key in a header and uses fixed system instructions. Without a configured AI provider, reviewers still receive calculation coverage and any supported deterministic result. The AI selector is optional. [Gemini structured outputs](https://ai.google.dev/gemini-api/docs/structured-output).
