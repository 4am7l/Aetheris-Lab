# Aetheris Lab

A React + TypeScript scientific workspace for documenting two solutions and preparing chemical compatibility questions for independent expert review. **No AI services, real submissions, administrator approvals, or scientific verdicts are simulated.** An explicit demo animates lifecycle statuses only and stops at a review placeholder.

## Run locally

Requirements: Node 22.12+ (Node 26 used for validation) and npm.

```sh
npm ci
cp .env.example .env.local
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
- Camera preview, capture, retake, stream cleanup, denial/error handling, upload fallback, image preview/removal, JPEG/PNG/WebP and 10 MB validation. Camera images are resized to a maximum width of 2000 px. Images are never uploaded or persisted; they last only during the analysis page session.
- Four actual NIOSH substance records checked 2026-11-20; indexed name, alias, ASCII formula/subscript normalization, CAS and category search. No invented records, GHS claims, or solution-specific conclusions.
- Validated browser-local drafts and demo workflow records, timestamps, audit-style history, JSON download, storage-error handling. Demo can exercise a service failure. It never contacts a reviewer or produces a scientific assessment.
- Strongly typed service contracts; future evidence orchestrator with identity lookup, safety retrieval and review submission; fail-closed Worker skeleton, D1 migration, private R2 binding preparation.
- Real Analyze Compatibility is intentionally disabled. Local request schema explicitly excludes Approved. Local data can never unlock a final result.

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
| `src/services/local.ts`           | Local-only repository and explicit demo provider                   |
| `worker/index.ts`                 | Nonoperational API routes returning 503; health endpoint           |
| `worker/orchestrator.ts`          | Dependency-injected, server-only future agent pipeline             |
| `worker/publication.ts`           | Deny-by-default final-result publication predicate                 |
| `migrations/0001_initial.sql`     | Requests, private assessments, reviews, images, append-only events |
| `docs/admin-review.md`            | Secure review protocol and publication requirements                |
| `docs/cloudflare.md`              | Cloudflare setup and deployment instructions                       |

## Integration status and remaining work

No real provider or authenticated server repository is implemented. The Worker deliberately returns **503** for request/image/result/review APIs, including requests containing forged review headers. Changing an environment variable cannot turn this preview into a trusted application.

Before enabling production submission: implement end-user authentication and owner-scoped D1 access, server-enforced lifecycle transitions and idempotency, identity and current SDS providers, an evidence-constrained AI provider, durable orchestration/queue retries, private image upload validation and R2 delivery, authenticated Aetheris Admin delivery/callbacks, signed review verification, replay protection, rate limits, limits on agent egress/tool use, retention/deletion policies and monitoring. Add the authenticated read API and wire `ApprovedResultPanel` only when those controls are operational. The current request route has only the locked results screen; the future result presentation component, final-result contract and server publication validation are prepared but cannot be activated by browser storage or a URL parameter.

The orchestrator is an architectural implementation with injected dependencies, not a running AI system. It never exposes preliminary content to the frontend. Before connecting it, constrain reference domains; parse documents as untrusted data; validate extracted fields independently; disallow instructions in label/SDS text from changing tool permissions, request identity, review state or system policies. Do not send secrets or personal data into prompts.

Local storage is not a trustworthy audit record or confidential storage. The D1 append-only event table is the future server audit trail. Human approval adds a control; it does not guarantee scientific correctness. Rejection means the assessment was rejected, not that the pair was proven incompatible.

## References

Initial data derives from the [NIOSH Pocket Guide: ethanol](https://www.cdc.gov/niosh/npg/npgd0262.html), [acetone](https://www.cdc.gov/niosh/npg/npgd0004.html), [sodium hydroxide](https://www.cdc.gov/niosh/npg/npgd0565.html), and [hydrogen peroxide](https://www.cdc.gov/niosh/npg/npgd0335.html). Summaries are limited reference excerpts/paraphrases, not a substitute for the current supplier SDS or laboratory procedures.

No deployment has been performed. See `docs/cloudflare.md` for exact setup steps.
