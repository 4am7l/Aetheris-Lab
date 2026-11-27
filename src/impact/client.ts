import { trackingTokenSchema } from "../domain";
import { words, type LabLanguage } from "./locale";
export { words, type LabLanguage } from "./locale";

export class ImpactError extends Error {
  constructor(public readonly status: number, public readonly code: string) { super(code); }
}
export type LabApi = <T>(path: string, data?: unknown, signal?: AbortSignal) => Promise<T>;
export function labApi(base: string, credential?: { token: string } | { csrf: string }): LabApi {
  return async <T>(path: string, data?: unknown, signal?: AbortSignal) => {
    const headers = new Headers();
    if (credential && "token" in credential) headers.set("Authorization", "Bearer " + credential.token);
    if (credential && "csrf" in credential && data !== undefined) headers.set("X-CSRF-Token", credential.csrf);
    const multipart = data instanceof FormData;
    if (!multipart && data !== undefined) headers.set("Content-Type", "application/json");
    const response = await fetch(base + path, {
      method: data === undefined ? "GET" : "POST", headers, cache: "no-store", credentials: "same-origin", redirect: "error",
      body: data === undefined ? undefined : multipart ? data : JSON.stringify(data),
      signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]),
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => null) as { error?: string } | null;
      throw new ImpactError(response.status, detail?.error ?? "UNAVAILABLE");
    }
    const type = response.headers.get("Content-Type")?.split(";")[0].toLowerCase();
    if (type === "text/csv" || type === "application/pdf") return response.blob() as Promise<T>;
    if (type !== "application/json") throw new ImpactError(503, "UNAVAILABLE");
    return response.json() as Promise<T>;
  };
}

export function download(blob: Blob, name: string) {
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

const temporary = new Map<string, string>();
export function getCredential(kind: "profile" | "membership") {
  const active = temporary.get(kind);
  if (active) return active;
  try {
    const fromStorage = trackingTokenSchema.safeParse(localStorage.getItem("aetheris.impact." + kind));
    return fromStorage.success ? fromStorage.data : "";
  } catch { return ""; }
}
export function rememberCredential(kind: "profile" | "membership", credential: string) {
  if (credential) temporary.set(kind, credential);
  else temporary.delete(kind);
  try {
    if (credential) localStorage.setItem("aetheris.impact." + kind, credential);
    else localStorage.removeItem("aetheris.impact." + kind);
    return true;
  } catch { return false; }
}
export function message(error: unknown, lang: LabLanguage) {
  const text: Record<string, [string, string]> = {
    NOT_FOUND: ["No accessible record was found.", "لم يُعثر على سجل متاح."],
    UNAUTHORIZED: ["Your access credential is required or has expired.", "يلزم رمز الوصول أو انتهت صلاحيته."],
    FORBIDDEN: ["You do not have access to this action or record.", "ليس لديك صلاحية لهذا الإجراء أو السجل."],
    INVALID_REQUEST: ["Check the required fields and units.", "تحقق من الحقول والوحدات المطلوبة."],
    INVALID_FILTER: ["Check the dates and filter values.", "تحقق من التواريخ وقيم التصفية."],
    RATE_LIMITED: ["Request limit reached. Try again in a minute.", "تم بلوغ حد الطلبات. أعد المحاولة بعد دقيقة."],
    STALE_IMPACT: ["The record changed. Refresh and submit again.", "تغير السجل. حدّث الصفحة ثم أعد الإرسال."],
    NO_ELIGIBLE_ACTION: ["This decision cannot include financial or carbon credit.", "هذا القرار غير مؤهل لتسجيل وفورات مالية أو كربونية."],
    WASTE_PREVENTION_EVIDENCE_REQUIRED: ["Record a verified preservation or return to substantiate waste prevention.", "وثّق حفظ المواد أو إعادتها لإثبات منع الهدر."],
    WASTE_PREVENTION_EXCEEDS_PRESERVATION: ["Avoided waste exceeds the recorded preserved quantity.", "تجاوز الهدر المتجنب الكمية المحفوظة المسجلة."],
    VERIFIED_IDENTITY_REQUIRED: ["Create a verified formulation record first.", "أنشئ أولاً سجلاً موثقاً للتركيبة."],
    FORMULATION_REQUIRED: ["Verification needs a CAS number, formulation, solvent and concentration or purity.", "يتطلب التحقق رقم CAS والتركيبة والمذيب والتركيز أو النقاوة."],
    AFFILIATION_UNAVAILABLE: ["This receipt is already linked or impact reporting has started.", "هذا الإيصال مرتبط أو بدأ تسجيل الأثر له."],
    LAB_MEMBERSHIP_REQUIRED: ["Use credentials issued for the laboratory.", "استخدم رمز وصول صادراً عن المختبر."],
    LAB_AFFILIATION_REQUIRED: ["Link this assessment to the laboratory before recording institutional impact.", "اربط هذا التقييم بالمختبر قبل تسجيل الأثر المؤسسي."],
    MOVEMENT_CONFLICT: ["The stock level, event version, or previous movement conflicts with this entry.", "تتعارض الكمية أو نسخة الحدث أو حركة سابقة مع هذا الإدخال."],
    EXPORT_LIMIT: ["Narrow the date range or filters to export up to 1,000 records.", "ضيّق نطاق التاريخ أو التصفية لتصدير ما يصل إلى ١٠٠٠ سجل."],
    DISCRETE_MODEL_UNAVAILABLE: ["PubChem did not supply a supported structure in this dimension.", "لا يوفر PubChem بنية مدعومة بهذا البعد."],
  };
  const key = error instanceof ImpactError ? error.code : "";
  if (text[key]) return words(lang, ...text[key]);
  return words(lang, "This request could not be completed. Try again.", "تعذر إكمال الطلب. أعد المحاولة.");
}
