import {
  createdReceiptSchema,
  publicInputSchema,
  publicReceiptSchema,
  publicRequestIdSchema,
  publicRequestMaxBytes,
  publicRequestPath,
  type RequestInput,
} from "../domain";
import { getTrackingToken, saveReceipt } from "./receipts";

type Failure =
  | "validation"
  | "rejected"
  | "rateLimited"
  | "unconfirmed"
  | "unavailable"
  | "missing";

export class RequestError extends Error {
  constructor(
    public readonly code: Failure,
    public readonly retryAt = 0,
  ) {
    super(code);
  }
}

function retryTime(header: string | null) {
  const now = Date.now();
  if (header && /^\d+$/.test(header)) return now + Number(header) * 1000;
  const date = header ? Date.parse(header) : NaN;
  return Number.isFinite(date) ? Math.max(now, date) : now + 60_000;
}

async function request(
  path: string,
  options: RequestInit,
  expectedStatus: 200 | 201,
) {
  const posting = expectedStatus === 201;
  const timeout = AbortSignal.timeout(15_000);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout;
  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal,
    });
  } catch {
    throw new RequestError(posting ? "unconfirmed" : "unavailable");
  }

  if (response.status === 429) {
    throw new RequestError(
      "rateLimited",
      retryTime(response.headers.get("Retry-After")),
    );
  }
  if (response.status === expectedStatus) return response;
  if (!posting && response.status === 404) throw new RequestError("missing");
  if (posting && [400, 413, 415].includes(response.status)) {
    throw new RequestError("validation");
  }
  if (posting && [401, 403, 404, 405].includes(response.status)) {
    throw new RequestError("rejected");
  }
  throw new RequestError(posting ? "unconfirmed" : "unavailable");
}

async function readJson(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}

export async function submitRequest(input: RequestInput) {
  const parsed = publicInputSchema.safeParse(input);
  if (!parsed.success) throw new RequestError("validation");
  const body = JSON.stringify(parsed.data);
  if (new TextEncoder().encode(body).length > publicRequestMaxBytes) {
    throw new RequestError("validation");
  }

  const response = await request(
    publicRequestPath,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    },
    201,
  );
  const receipt = createdReceiptSchema.safeParse(await readJson(response));
  if (!receipt.success) throw new RequestError("unconfirmed");

  saveReceipt(receipt.data);
  return receipt.data.id;
}

export async function trackRequest(id: string, signal?: AbortSignal) {
  const token =
    publicRequestIdSchema.safeParse(id).success && getTrackingToken(id);
  if (!token) throw new RequestError("missing");
  const response = await request(
    publicRequestPath + "/" + id,
    {
      headers: { Authorization: "Bearer " + token },
      signal,
    },
    200,
  );
  const receipt = publicReceiptSchema.safeParse(await readJson(response));
  if (!receipt.success || receipt.data.id !== id)
    throw new RequestError("unavailable");
  return receipt.data;
}
