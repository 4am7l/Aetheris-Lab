import { z } from "zod";
import { explanationTopics, type Calculation } from "../../src/chemistry";
import { readBytes } from "../http";

const part = z.strictObject({
  text: z.string(),
  thought: z.boolean().optional(),
  thoughtSignature: z.string().optional(),
});
const responseSchema = z.object({
  promptFeedback: z.object({ blockReason: z.never().optional() }).optional(),
  candidates: z.tuple([z.object({
    finishReason: z.literal("STOP"),
    content: z.object({ parts: z.array(part).min(1).max(8) }),
  })]),
});

export function geminiFor(model: string, key: string) {
  if (!/^gemini-[a-z0-9][a-z0-9.-]{0,119}$/.test(model)) return null;
  return {
    name: "gemini" as const,
    model,
    async explain(calculation: Calculation) {
      const [massBalance, modelScope, inputRequirements, measuredVolume] = explanationTopics;
      const allowed = calculation.status === "calculated"
        ? [massBalance, modelScope, measuredVolume] as const : [modelScope, inputRequirements] as const;
      const response = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent",
        {
          method: "POST",
          headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
          redirect: "manual",
          signal: AbortSignal.timeout(20_000),
          body: JSON.stringify({
            systemInstruction: { parts: [{ text:
              "Choose and order at least two supplied, prewritten explanation topics for a chemistry reviewer. "
              + "Use each chosen topic once. Return only the requested JSON structure." }] },
            contents: [{ role: "user", parts: [{ text: JSON.stringify({
              status: calculation.status,
              topics: Object.fromEntries(allowed.map((topic) => [topic, topicDescriptions[topic]])),
              issues: calculation.status === "calculated" ? [] : calculation.issues.map(({ kind, code }) => ({ kind, code })),
            }) }] }],
            generationConfig: {
              candidateCount: 1,
              maxOutputTokens: 1024,
              responseMimeType: "application/json",
              responseJsonSchema: {
                type: "object",
                additionalProperties: false,
                required: ["topics"],
                properties: {
                  topics: { type: "array", items: { type: "string", enum: allowed }, minItems: 2, maxItems: allowed.length },
                },
              },
            },
          }),
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error("GEMINI_UNAVAILABLE");
      }
      const bytes = await readBytes(response, 32 * 1024);
      if (bytes instanceof Response) throw new Error("GEMINI_UNAVAILABLE");
      const envelope = responseSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
      const [answer] = z.tuple([part]).parse(envelope.candidates[0].content.parts.filter((p) => !p.thought));
      const { topics } = z.strictObject({ topics: z.array(z.enum(allowed)).min(2).max(allowed.length) })
        .parse(JSON.parse(answer.text));
      if (new Set(topics).size !== topics.length) throw new Error("GEMINI_DUPLICATE_TOPICS");
      return topics;
    },
  };
}

const topicDescriptions: Record<typeof explanationTopics[number], string> = {
  massBalance: "Stock amounts and measured final volume determine modeled ion concentrations.",
  modelScope: "The coverage limits and uncertainty of the model determine how findings may be used.",
  inputRequirements: "Review the recorded missing inputs or unsupported conditions before relying on a model.",
  measuredVolume: "The measured final volume determines the calculation basis.",
};
