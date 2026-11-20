# Aetheris Admin integration contract (version 1)

This protocol is preparation for a separate application. No operational review endpoint exists in this release. All `/api/admin/*` routes return 503 until authentication and persistence are implemented. Never use browser storage, a query parameter, an environment flag, or a client-provided `status` as approval authority.

## Future server endpoints

| Method/path                              | Required behavior                                                                                                                                         |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST `/api/requests`                     | Authenticated owner, strict `RequestInput` schema, bounded body, idempotency key; server generates UUID/timestamp/status; reject approval/reviewer fields |
| GET `/api/requests`                      | Authenticated owner-scoped pagination; metadata only                                                                                                      |
| GET `/api/requests/:id`                  | Owner check; no preliminary assessment; expose final result only after durable verified-review lookup                                                     |
| POST `/api/images`                       | Authenticated bounded upload; sniff/validate bytes and dimensions; re-encode and strip metadata; private R2 key and owner/request binding                 |
| POST Admin service `/v1/review-requests` | Worker service credentials; idempotency `requestId:assessmentVersion`; bounded request and authoritative source metadata                                  |
| POST `/api/admin/reviews`                | Authenticated reviewer service, verified Access JWT, application permission, signed body, replay protection, immutable transactional decision             |
| POST `/api/requests/:id/information`     | Owner-only append; re-run assessment with new version; invalidate earlier approvals                                                                       |

No GET endpoint may return internal preliminary content. Never implement `PATCH status=Approved` for users.

## Outbound review submission

```ts
{
  schemaVersion: 1,
  requestId: string,
  assessmentVersion: number,
  submittedAt: string, // server ISO-8601
  userInput: { a: Solution, b: Solution, conditions: string },
  imageReferences: Array<{ id: string; access: "authenticated-server-only" }>,
  identificationResults: Identification[], // confirmed identities recorded separately from candidates
  preliminaryAssessment: PreliminaryAssessment, // notForPublication: true
  sourceReferences: Evidence[], // URL, retrievedAt, documentHash, bounded excerpt
  missingInformation: string[]
}
```

Chemical names/notes, label text, and source documents are untrusted input, never tool/system instructions. No public image URLs. Admin fetches images through an authenticated short-lived server channel.

## Inbound review

Use `AdminReviewDecision` from `src/services/contracts.ts`: `eventId`, request and assessment version, reviewer identity, decision, reviewedAt, reason, and optional approved result. Bind reviewer identity to verified claims, never the JSON field alone. Approval requires `finalResultSchema`: one of four permitted classifications, documented conditions, evidence sources, limitations, hazards/incompatibilities, storage/container notes (explicitly not assessed when unsupported), reviewer identity and timestamp. Provider output is not a review decision.

Recommended signing envelope: `X-Aetheris-Timestamp` and `X-Aetheris-Signature` = HMAC-SHA256 over timestamp + newline + exact body bytes. Reject timestamps outside a five-minute skew, compare signatures in constant time, require trusted service authentication AND verified Cloudflare Access JWT issuer/audience/expiry/keys. Rotate secrets. Enforce a unique eventId (durable replay prevention). HTTPS only. JWT header presence alone is never proof of authentication.

In one D1 transaction: check current state/version and reviewer role; insert immutable review; append server actor event; update request status. Handle duplicate event IDs idempotently only if the original payload hash matches; conflicting duplicates return 409. Reject stale assessment versions and out-of-order reviews. Do not log raw sensitive documents or tokens.

## Lifecycle

Draft → Submitted → Identifying Chemicals → Analyzing → Awaiting Administrator Review.

Identity or evidence gaps → Additional Information Required or Unable to Determine. Service errors → Failed. Reviewer decision → Approved, Rejected, Additional Information Required or Unable to Determine. Additional information starts a fresh assessment version. Only an approved decision for the current version may unlock a final result; revocation locks it again.

Rejected indicates review rejection, **not** scientific incompatibility. A review stating insufficient information is permitted, but requires explicit approval and limitations like every other published classification. A client must never infer a scientific classification from the status.

`publishableResult` is a server-side predicate, not an authentication mechanism. Its context must come from an authenticated server-owned database query. Test fixtures demonstrating approval are isolated in tests and never shipped as catalog/request data. The UI currently has no approved-result route or local override.
