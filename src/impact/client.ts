import { trackingTokenSchema } from "../domain";
import { words, type LabLanguage } from "./locale";
export { words, type LabLanguage } from "./locale";

export class ImpactError extends Error {
  constructor(public readonly status: number, public readonly code: string) { super(code); }
}
export type LabApi = <T>(path: string, data?: unknown, signal?: AbortSignal) => Promise<T>;
export type PendingWrite = { fingerprint: string; key: string } | null;
export function keyedWrite(input: Record<string, unknown>, pending: { current: PendingWrite }, operation = "") {
  const fingerprint = JSON.stringify([operation, input]);
  if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, key: crypto.randomUUID() };
  return { ...input, key: pending.current.key };
}

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
    REVIEW_PRESERVATION_FROM_ACTIONS: ["Record preserved quantities as verified actions.", "سجّل الكميات المحفوظة كإجراءات موثّقة."],
    VERIFIED_IDENTITY_REQUIRED: ["Create a verified formulation record first.", "أنشئ أولاً سجلاً موثقاً للتركيبة."],
    PAIR_FORMULATION_REQUIRED: ["A conditional finding requires verified formulations for both materials.", "تتطلب النتيجة المشروطة تركيبتين موثّقتين للمادتين."],
    FIXED_GUIDE_REFERENCE: ["The original guide rate is fixed. Create a separate reference version.", "سعر الدليل الأصلي ثابت. أنشئ مرجعاً مستقلاً."],
    GUIDE_MATCH_UNAVAILABLE: ["This assessment does not support a match to the original guide row.", "بيانات التقييم لا تدعم المطابقة مع سجل الدليل الأصلي."],
    FORMULATION_REQUIRED: ["Verification needs a CAS number, formulation, solvent and concentration or purity.", "يتطلب التحقق رقم CAS والتركيبة والمذيب والتركيز أو النقاوة."],
    AFFILIATION_UNAVAILABLE: ["This receipt is already linked or impact reporting has started.", "هذا الإيصال مرتبط أو بدأ تسجيل الأثر له."],
    LAB_MEMBERSHIP_REQUIRED: ["Use credentials issued for the laboratory.", "استخدم رمز وصول صادراً عن المختبر."],
    LAB_AFFILIATION_REQUIRED: ["Link this assessment to the laboratory before recording institutional impact.", "اربط هذا التقييم بالمختبر قبل تسجيل الأثر المؤسسي."],
    MOVEMENT_CONFLICT: ["The stock level, event version, or previous movement conflicts with this entry.", "تتعارض الكمية أو نسخة الحدث أو حركة سابقة مع هذا الإدخال."],
    VERIFIED_ACTIVITY_REQUIRED: ["Select a current, reviewed action for this container’s formulation.", "اختر إجراءً حالياً مراجعاً لتركيبة هذه العبوة."],
    RECONCILIATION_PENDING: ["Check the stock balance before retrying this correction.", "تحقق من رصيد المخزون قبل إعادة محاولة هذا التصحيح."],
    ACTION_EVIDENCE_REQUIRED: ["Enter the unique record identifier for the documented action.", "أدخل معرّف السجل الفريد للإجراء الموثّق."],
    DUPLICATE_IMPACT_EVIDENCE: ["This evidence has already been claimed by another operation.", "سبق استخدام هذا الدليل في عملية أخرى."],
    INVALID_ACTION_DATE: ["The action date must be between submission and today.", "يجب أن يكون تاريخ الإجراء بين تاريخ الإرسال واليوم."],
    ACTIVITY_FORMULATION_REQUIRED: ["Select the assessed input and its verified formulation.", "اختر المدخل المقيّم وتركيبته الموثّقة."],
    ACTIVITY_FORMULATION_MISMATCH: ["The formulation does not match the selected assessed input.", "لا تطابق التركيبة المدخل المقيّم المحدد."],
    ACTIVITY_QUANTITY_UNSUPPORTED: ["Use a measured quantity and unit supported by the assessed inputs.", "استخدم كمية مقاسة ووحدة تدعمها المدخلات المقيّمة."],
    ACTIVITY_QUANTITY_OVERLAP: ["The combined material outcomes exceed the measured input.", "يتجاوز مجموع نتائج المواد كمية المدخل المقاسة."],
    SCENARIO_EVIDENCE_UNAVAILABLE: ["One or more categories lack a usable comparison or applicable verified reference.", "يفتقر بند واحد أو أكثر إلى مقارنة صالحة أو مرجع موثّق قابل للتطبيق."],
    SCENARIO_FORMULATION_OR_QUANTITY: ["The reference or its units do not match a measured input.", "لا يطابق المرجع أو وحداته مدخلاً مقاساً."],
    SCENARIO_QUANTITY_UNSUPPORTED: ["The scenario quantities exceed or cannot be compared with the measured inputs.", "تتجاوز كميات السيناريو المدخلات المقاسة أو يتعذر مقارنتها بها."],
    SCENARIO_ACTION_MISMATCH: ["The verified actions do not support this category of savings.", "لا تدعم الإجراءات الموثّقة هذا البند من الوفورات."],
    SCENARIO_ACTION_QUANTITY: ["The claimed change exceeds the quantity supported by the action.", "يتجاوز التغير المطالب به الكمية التي يدعمها الإجراء."],
    SCENARIO_WASTE_UNITS: ["Compare waste using two mass measurements or two volume measurements.", "قارن النفايات باستخدام قياسين للكتلة أو قياسين للحجم."],
    INVALID_PDF: ["Choose a valid PDF up to 5 MB.", "اختر ملف PDF صالحاً بحجم يصل إلى ٥ ميغابايت."],
    UPLOAD_CONFLICT: ["This document could not be added to the laboratory.", "تعذرت إضافة هذه الوثيقة إلى المختبر."],
    INDEPENDENT_REVIEW_REQUIRED: ["A different qualified reviewer must review this document.", "يجب أن يراجع هذه الوثيقة مراجع مؤهل آخر."],
    EXPORT_LIMIT: ["Narrow the date range or filters to export up to 1,000 records.", "ضيّق نطاق التاريخ أو التصفية لتصدير ما يصل إلى ١٠٠٠ سجل."],
    DISCRETE_MODEL_UNAVAILABLE: ["PubChem did not supply a supported structure in this dimension.", "لا يوفر PubChem بنية مدعومة بهذا البعد."],
  };
  const key = error instanceof ImpactError ? error.code : "";
  if (text[key]) return words(lang, ...text[key]);
  return words(lang, "This request could not be completed. Try again.", "تعذر إكمال الطلب. أعد المحاولة.");
}
