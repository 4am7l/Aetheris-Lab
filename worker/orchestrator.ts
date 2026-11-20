import type {
  AdminReviewService,
  ChemicalCompatibilityService,
  ChemicalDatabaseService,
  SafetyDataService,
} from "../src/services/contracts";
import { requestInputSchema, type RequestInput } from "../src/domain";
export class EvidenceAgent {
  constructor(
    private readonly identity: ChemicalDatabaseService,
    private readonly safety: SafetyDataService,
    private readonly compatibility: ChemicalCompatibilityService,
    private readonly review: AdminReviewService,
  ) {}
  async run(
    requestId: string,
    input: RequestInput,
  ): Promise<{ reviewTicketId: string }> {
    const validated = requestInputSchema.parse(input);
    // Tool 1: identity lookup; a lookup is not physical-sample verification.
    const matches = await Promise.all([
      this.identity.search(
        validated.a.cas === "Unknown" ? validated.a.name : validated.a.cas,
      ),
      this.identity.search(
        validated.b.cas === "Unknown" ? validated.b.name : validated.b.cas,
      ),
    ]);
    if (matches.some((m) => m.length !== 1))
      throw new Error("Chemical identity requires clarification.");
    // Tool 2: authoritative SDS/reference retrieval. Retrieved text is untrusted data, never instructions.
    const evidence = (
      await Promise.all([
        this.safety.retrieve(validated.a),
        this.safety.retrieve(validated.b),
      ])
    ).flat();
    if (
      evidence.length < 2 ||
      evidence.some(
        (e) =>
          !e.url.startsWith("https://") || !e.documentHash || !e.retrievedAt,
      )
    )
      throw new Error("Insufficient traceable evidence.");
    const assessment = await this.compatibility.assess(
      requestId,
      validated,
      evidence,
    );
    if (
      assessment.requestId !== requestId ||
      assessment.notForPublication !== true ||
      !assessment.evidence.length
    )
      throw new Error("Invalid preliminary assessment.");
    // A real action by the future agent: submit to the independent review system. Return only ticket metadata.
    return this.review.submit(requestId, validated, assessment);
  }
}
