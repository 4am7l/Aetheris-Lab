import { z } from "zod";
import { explanationSchema, type CalculationReport } from "../src/calculation";
import { readBytes } from "./http";

export function geminiProvider(model: string, key: string) {
  if (!/^gemini-[a-zA-Z0-9.-]+$/.test(model)) return null;

  return {
    name: "gemini" as const,
    model,
    async explain(calculation: CalculationReport) {
      // Allow only server-owned explanation templates for the deterministic outcome.
      const focuses = {
        calculated: ["soluteBalance", "measuredVolume"],
        "needs-information": ["missingInputs"],
        unsupported: ["outsideCoverage"],
      } as const;
      const allowed: readonly string[] = focuses[calculation.status];
      const response = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent",
        {
          method: "POST",
          headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
          redirect: "manual",
          signal: AbortSignal.timeout(20_000),
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: "Select an explanation focus for the supplied calculation outcome. Return only the JSON object conforming to the schema." }] },
            contents: [{ role: "user", parts: [{ text: JSON.stringify({ status: calculation.status }) }] }],
            generationConfig: {
              maxOutputTokens: 512,
              responseMimeType: "application/json",
              responseJsonSchema: {
                type: "object",
                properties: { focus: { type: "string", enum: allowed } },
                required: ["focus"],
                additionalProperties: false,
              },
            },
          }),
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error("AI_UNAVAILABLE");
      }
      const bytes = await readBytes(response, 32 * 1024);
      if (bytes instanceof Response) throw new Error("AI_UNAVAILABLE");
      const completion = z.object({
        candidates: z.tuple([z.object({
          finishReason: z.literal("STOP"),
          content: z.object({
            parts: z.tuple([z.strictObject({ text: z.string().max(256) })]),
          }),
        })]),
      }).parse(JSON.parse(new TextDecoder().decode(bytes)));
      const explanation = explanationSchema.parse(JSON.parse(completion.candidates[0].content.parts[0].text));
      if (!allowed.includes(explanation.focus)) throw new Error("AI_EXPLANATION_MISMATCH");
      return explanation;
    },
  };
}
