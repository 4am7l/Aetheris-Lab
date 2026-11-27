import { z } from "zod";
import { error, readJson } from "../http";

export async function body<T extends z.ZodType>(request: Request, schema: T, maxBytes = 48 * 1024): Promise<z.infer<T> | Response> {
  const input = await readJson(request, maxBytes);
  if (input instanceof Response) return input;
  const parsed = schema.safeParse(input);
  return parsed.success ? parsed.data : error("INVALID_REQUEST", 400);
}
export const shortText = z.string().trim().min(1).max(240);
export const longText = z.string().trim().min(1).max(2000);
export const decimal = z.number().min(0).max(1e9);
export function timestamp() { return new Date().toISOString(); }
