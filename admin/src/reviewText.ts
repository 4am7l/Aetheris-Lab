import type { PublicRequestStatus, PublicResult } from "./review";
import type { AdminTextKey } from "./i18n";

export const statusLabel: Record<PublicRequestStatus, AdminTextKey> = {
  Submitted: "submitted",
  Analyzing: "analyzingStatus",
  "Pending Review": "pendingReviewStatus",
  Approved: "approvedStatus",
  Rejected: "rejectedStatus",
  "Needs More Information": "needsMoreStatus",
};

export const resultLabel: Record<PublicResult["classification"], AdminTextKey> = {
  "Compatible under documented conditions": "compatibleResult",
  Incompatible: "incompatibleResult",
  "Conditional or context-dependent": "conditionalResult",
  "Insufficient information": "insufficientResult",
};
