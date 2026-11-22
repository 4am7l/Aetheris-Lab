# Aetheris Lab

A React + TypeScript scientific workspace for documenting two solutions and preparing chemical compatibility questions for independent expert review. The frontend submits requests to the Cloudflare Worker and displays token-protected progress and expert-approved assessments.

## Run locally

Requirements: Node 22.12+ (Node 26 used for validation) and npm.
The Worker tests use Node's built-in SQLite module. On Node 22.12, enable it with `NODE_OPTIONS=--experimental-sqlite` or run the checks with Node 26, as CI does.

```sh
npm ci
npx wrangler d1 migrations apply DB --local
npm run worker:dev
```

Start Vite in a second terminal.

```sh
npm run dev
```

Open the URL printed by Vite (normally http://127.0.0.1:5173). Camera access requires localhost or HTTPS and browser permission. The app runs without Cloudflare credentials. The user-supplied Samsung font is served locally from `public/fonts/samsung.ttf` and preloaded for all interface text, including Material UI dialogs and controls. Material Symbols remains a separate icon font; self-host it for a fully offline release.

```sh
npm run build
npm run lint
npm run typecheck
npm run worker:check
npm test
```

## Implemented

- Responsive Home, Chemical Analysis, Chemical Library/details, My Requests/details, About and not-found routes.
- Material UI library components and a restrained Google-inspired shell: rounded navigation, pill buttons, outlined forms, dialogs, filter chips and a neutral palette with one blue accent. User-supplied Samsung typography for English and Arabic, Motion transitions, reduced-motion support, accessible modal focus handling, keyboard focus and touch targets.
- Direct one-click light/dark toggle with a persistent preference and system detection until the first explicit selection; English default, Arabic dictionary with RTL layout and English fallback for untranslated content. Arabic localization is a starting point and needs full professional translation before public release.
- Independent solution forms with CAS checksum, concentration/unit, state, solvent, temperature, quantity, composition notes and explicit Unknown fields. Catalog selection does not assume the physical state or concentration of a solution.
- Camera preview, capture, retake, stream cleanup, denial/error handling, upload fallback, image preview/removal, JPEG/PNG/WebP and 10 MB validation. Camera images are resized to a maximum width of 2000 px. Images stay in the form unless the requester chooses to attach them for review. Attached photos are stored in private R2.
- Four actual NIOSH substance records checked 2026-11-20; indexed name, alias, ASCII formula/subscript normalization, CAS and category search. No invented records, GHS claims, or solution-specific conclusions.
- Browser-local drafts with JSON download. Older preview records remain readable as archived local data.
- Public intake and token-protected tracking through a same-origin Pages Function, with rate limiting and D1 storage in the Worker. The browser stores a private, removable tracking token for each receipt. See [Cloudflare setup and API contract](docs/cloudflare.md).
- Scheduled PubChem and NIOSH evidence collection, optional AI screening, and a protected expert review dashboard.
- Final results come from server-side reviewer approval. Local drafts remain separate from the publication workflow.

## Project map

| Path                              | Purpose                                                            |
| --------------------------------- | ------------------------------------------------------------------ |
| `src/App.tsx`, `src/pages/`       | Shell, routing and lazy-loaded structured pages                    |
| `src/components/SolutionCard.tsx` | Independent forms, library chooser, camera and uploads             |
| `src/styles.css`                  | Responsive theme tokens and components; Tailwind import            |
| `src/domain.ts`                   | Zod schemas and scientific input validation                        |
| `src/i18n.ts`                     | English/Arabic UI dictionaries                                     |
| `src/data/chemicals.ts`           | Small source-linked catalog                                        |
| `src/services/contracts.ts`       | Provider and Admin integration interfaces                          |
| `src/services/local.ts`           | Local drafts and chemical catalog services                         |
| `src/services/publicRequests.ts`  | Public intake and receipt client                                   |
| `functions/api/`                  | Pages gateway for public and protected admin routes                 |
| `worker/index.ts`                 | Intake, token tracking, review API, and scheduled agent             |
| `worker/orchestrator.ts`          | Scheduled evidence collection and private agent runs                |
| `worker/publication.ts`           | Deny-by-default final-result publication predicate                 |
| `migrations/0001_initial.sql`     | Requests, private assessments, reviews, images, append-only events |
| `migrations/0002_public_request_tracking.sql` | Public receipts and SHA-256 tracking-token digests |
| `migrations/0003_public_assessment_workflow.sql` | Public workflow, private evidence, reviews, and audit |
| `docs/admin-review.md`            | Secure review protocol and publication requirements                |
| `docs/cloudflare.md`              | Cloudflare setup and deployment instructions                       |

## Assessment and review

Submitted requests move through **Analyzing** and **Pending Review** before a qualified reviewer records a decision. The agent checks PubChem and NIOSH sources and can use an optional AI provider to flag evidence for private review. Reviewers write the final assessment, select citations, and approve publication. Only the matching tracking token can access an approved result.

See [Cloudflare configuration](docs/cloudflare.md) for migration, Access and provider setup, and the [administrator guide](docs/admin-review.md) for review actions and audit behavior.
