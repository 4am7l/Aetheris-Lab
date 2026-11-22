# Administrator review

Open the dedicated admin Pages project at `https://aetheris-admin.pages.dev/` or its configured hostname. Enter the admin password and choose **Sign in**. The Worker verifies the password and creates a host-only reviewer session that expires eight hours after sign-in. It checks that session on every protected request. **Sign out** ends the current session.

1. Select a status filter and open a request. The detail page shows the original submission, private photos, current agent run, timestamped source evidence, and the audit history.
2. Verify the references and resolve uncertainties before deciding. Catalog matches identify reference records. The physical samples and their formulations still require verification. AI entries are source flags for expert review.
3. Choose **Approve & publish**, **Reject**, or **Request more information**. Enter private notes for the audit. For approval, write the public assessment, select retrieved citations or add verified references, and attest that the evidence supports the assessment. A compatible classification requires a reviewer-supplied reference for the exact formulation and conditions.
4. If an agent run failed, select **Retry analysis** to requeue it. An unconfigured run can be retried once a provider is configured. The previous run, its evidence, and status history remain recorded.

Approval publishes the reviewer-authored assessment and its selected references to the corresponding token holder. Rejection and requests for more information publish only status. Private notes, staff identities, submitted photos, evidence excerpts, and draft findings remain in the review area.

## Worker API

| Method and path | Behavior |
| --- | --- |
| `POST /api/admin/auth/login` | Verifies the JSON `password` field, sets the session cookie, and returns the session's CSRF token. |
| `GET /api/admin/session` | Validates the active reviewer session and returns its CSRF token. |
| `POST /api/admin/auth/logout` | Revokes the active session and clears its cookie. |
| `GET /api/admin/requests` | Lists requests with optional `status` and `after` filters. |
| `GET /api/admin/requests/:id` | Reads submitted data, current draft, evidence, review, and audit. |
| `GET /api/admin/requests/:id/images/:imageId` | Streams one authorized photo from private R2. |
| `POST /api/admin/requests/:id/retry` | Requeues the specified eligible agent run. |
| `POST /api/admin/requests/:id/decision` | Records the decision for the current run and updates status atomically. |

Sign-in requires the configured admin origin. Sign-out, retry, and decision requests also require the session's `X-CSRF-Token` header. The decision endpoint accepts an explicit current run ID. Concurrent or repeated decisions and actions on superseded runs are rejected. The review event and status history are append-only. New reviewer events use the shared `password:admin` identity. Existing audit entries keep their original identifiers. See [Cloudflare configuration](cloudflare.md) for setup and security limits.
