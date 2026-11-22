# Administrator review

Open the dedicated admin Pages project at `https://aetheris-admin.pages.dev/` or its configured hostname. Choose **Sign in with GitHub** and use the account listed for you in the Worker allowlist. The Worker handles the GitHub callback, checks your numeric account ID, and creates a host-only reviewer session that expires eight hours after sign-in. The Worker checks that session and the allowlist on every protected request.

1. Select a status filter and open a request. The detail page shows the original submission, private photos, current agent run, timestamped source evidence, and the audit history.
2. Verify the references and resolve uncertainties before deciding. Catalog matches identify reference records. The physical samples and their formulations still require verification. AI entries are source flags for expert review.
3. Choose **Approve & publish**, **Reject**, or **Request more information**. Enter private notes for the audit. For approval, write the public assessment, select retrieved citations or add verified references, and attest that the evidence supports the assessment. A compatible classification requires a reviewer-supplied reference for the exact formulation and conditions.
4. If an agent run failed, select **Retry analysis** to requeue it. An unconfigured run can be retried once a provider is configured. The previous run, its evidence, and status history remain recorded.

Approval publishes the reviewer-authored assessment and its selected references to the corresponding token holder. Rejection and requests for more information publish only status. Private notes, staff identities, submitted photos, evidence excerpts, and draft findings remain in the review area.

## Worker API

| Method and path | Behavior |
| --- | --- |
| `GET /api/admin/auth/login` | Starts GitHub OAuth with single-use, browser-bound state and PKCE. |
| `GET /api/admin/auth/callback` | Exchanges the code, checks eligibility, and establishes the reviewer session. |
| `GET /api/admin/session` | Validates the active reviewer session. |
| `POST /api/admin/auth/logout` | Revokes the active session and clears its cookie. |
| `GET /api/admin/requests` | Lists requests with optional `status` and `after` filters. |
| `GET /api/admin/requests/:id` | Reads submitted data, current draft, evidence, review, and audit. |
| `GET /api/admin/requests/:id/images/:imageId` | Streams one authorized photo from private R2. |
| `POST /api/admin/requests/:id/retry` | Requeues the specified eligible agent run. |
| `POST /api/admin/requests/:id/decision` | Records the decision for the current run and updates status atomically. |

The decision endpoint accepts an explicit current run ID. Concurrent or repeated decisions and actions on superseded runs are rejected. The review event and status history are append-only. New reviewer events record `github:<numeric ID>`. Existing audit entries keep their original identifiers. See [Cloudflare configuration](cloudflare.md) for setup and security limits.
