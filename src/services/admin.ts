import type { PublicRequestStatus } from "../domain";
import type { AdminRequestDetail, AdminRequestList } from "../review";

const root = "/api/admin/requests";

export class AdminError extends Error {
  constructor(public readonly status: number) {
    super("Review request failed");
  }
}

async function adminRequest<T>(path: string, signal?: AbortSignal, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    cache: "no-store",
    credentials: "same-origin",
    redirect: "error",
    signal: AbortSignal.any([AbortSignal.timeout(15_000), ...(signal ? [signal] : [])]),
    ...(body === undefined ? {} : {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  });
  if (!response.ok) throw new AdminError(response.status);
  return response.json() as Promise<T>;
}

export function adminList(status: PublicRequestStatus | "", after: string | null, signal: AbortSignal) {
  const query = new URLSearchParams();
  if (status) query.set("status", status);
  if (after) query.set("after", after);
  return adminRequest<AdminRequestList>(root + "?" + query.toString(), signal);
}

export function adminDetail(id: string, signal: AbortSignal) {
  return adminRequest<AdminRequestDetail>(root + "/" + id, signal);
}

export function adminAction(id: string, action: "decision" | "retry", body: unknown) {
  return adminRequest<{ status: PublicRequestStatus }>(root + "/" + id + "/" + action, undefined, body);
}

export function adminImage(id: string, imageId: string) {
  return root + "/" + id + "/images/" + imageId;
}
