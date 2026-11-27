import { words, type LabLanguage } from "./locale";
import { currencyPrecision } from "./model";
import type { FixedGuideEstimate } from "./contracts";

export function fixedGuideStatus(lang: LabLanguage, status: FixedGuideEstimate["status"]) {
  const labels = {
    applied: ["Reference applied", "طُبِّق المرجع"],
    "needs-review": ["Formulation match requires review", "تطابق التركيبة يتطلب مراجعة"],
    "not-applicable": ["Formulation not applicable", "التركيبة لا تنطبق"],
    "volume-unavailable": ["Measured liquid volume unavailable", "حجم السائل المقاس غير متاح"],
  } as const;
  const [en, ar] = labels[status];
  return words(lang, en, ar);
}

const terms: Record<string, [string, string]> = {
  estimated: ["Estimated", "تقديري"], "action-reported": ["Action reported", "تم الإبلاغ عن الإجراء"],
  "pending-verification": ["Pending verification", "بانتظار التحقق"], verified: ["Verified", "موثّق"],
  rejected: ["Rejected", "مرفوض"], corrected: ["Corrected", "مصحّح"], cancelled: ["Cancelled", "ملغى"],
  preserved: ["Preserved for reuse", "محفوظ لإعادة الاستخدام"], returned: ["Returned to inventory", "أُعيد إلى المخزون"],
  recovery: ["Authorized recovery", "استرجاع معتمد"], segregation: ["Correct waste segregation", "فرز النفايات الصحيح"],
  disposal: ["Authorized disposal", "تخلص معتمد"], abandoned: ["Proposed incompatible mixing abandoned", "العدول عن الخلط غير المتوافق"],
  "no-action": ["No action taken", "لم يُتخذ إجراء"], other: ["Other documented action", "إجراء موثق آخر"],
  purchase: ["Purchase", "الشراء"], replacement: ["Replacement", "الاستبدال"],
  handling: ["Handling", "المناولة"], treatment: ["Treatment", "المعالجة"],
  manufacturing: ["Manufacturing", "التصنيع"], transportation: ["Transportation", "النقل"],
  personal: ["Personal expense", "نفقات شخصية"], institution: ["Institutional expense", "نفقات المؤسسة"], unassigned: ["Unassigned", "غير محدد"],
  measureDisposal: ["Disposal", "التخلص"], measureRecovery: ["Recovery", "الاسترجاع"],
  unverified: ["Unverified", "غير موثّق"], combined: ["Combined reference", "مرجع مجمّع"],
  "institution-admin": ["Institution administrator", "مسؤول المؤسسة"], reviewer: ["Qualified reviewer", "مراجع مؤهل"],
  "lab-manager": ["Laboratory manager", "مسؤول المختبر"], viewer: ["Viewer", "مطّلع"],
  submitted: ["Submitted", "مقدّم"], incompatible: ["Documented incompatibility", "عدم توافق موثّق"],
  conditional: ["Conditional compatibility", "توافق مشروط"], insufficient: ["Insufficient evidence", "أدلة غير كافية"],
  identification: ["Identification and product", "الهوية والمنتج"], hazards: ["Hazard classifications", "تصنيفات الأخطار"],
  composition: ["Composition and CAS", "التركيب ورقم CAS"], storage: ["Storage warnings", "تحذيرات التخزين"],
  physical: ["Physical properties", "الخواص الفيزيائية"], incompatibilities: ["Documented incompatibilities", "حالات عدم التوافق الموثّقة"],
  revision: ["Revision", "المراجعة"],
};
export function labLabel(lang: LabLanguage, item: string) {
  const term = terms[item];
  return term ? words(lang, ...term) : item;
}
export function numberLabel(lang: LabLanguage, number: number | null | undefined, unit?: string) {
  if (number === null || number === undefined) return words(lang, "Not available", "غير متاح");
  const digits = unit && /^[A-Z]{3}$/.test(unit) ? currencyPrecision(unit) : null;
  const format = digits === null ? { maximumSignificantDigits: 7 } : {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  };
  return new Intl.NumberFormat(lang, format).format(number) + (unit ? " " + unit : "");
}
