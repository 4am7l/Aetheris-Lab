import { localizedLabel } from "../../src/chemistryLabels";
import type { TextKey } from "../../src/i18n";
import { scientificReferences, type AdminRequestDetail } from "../../src/review";
import { undeterminedWaste, type WasteGapCode, type WasteReviewInput } from "../../src/wasteAssessment";

export type WasteReviewDraft = Omit<WasteReviewInput, "attestation"> & { attestation: boolean };

const justification = {
  aqueousMethanol: {
    en: "The matched methanol and water records and the supported dilution balance describe an aqueous formulation under the declared assumptions. This supports a provisional aqueous segregation category.",
    ar: "تصف سجلات الميثانول والماء المطابقة وحساب التخفيف المدعوم تركيبةً مائية في ظل الافتراضات المعلنة. ويدعم ذلك اقتراح فئة النفايات المائية لأغراض الفرز.",
  },
  aqueousSodiumChloride: {
    en: "The matched reference records and the validated dilute sodium chloride balance describe dissolved inorganic salt in water under the declared assumptions. The model supports provisional segregation categories for this composition.",
    ar: "تصف السجلات المرجعية المطابقة وحساب ميزان كلوريد الصوديوم المخفف المتحقَّق منه ملحاً غير عضوي مذاباً في الماء وفق الافتراضات المعلنة. ويدعم النموذج اقتراح فئات فرز لهذه التركيبة.",
  },
  insufficient: {
    en: "The available evidence leaves the waste classification undetermined for the proposed mixture. The reviewer must establish its formulation and relevant properties before assigning a classification.",
    ar: "لا تكفي الأدلة المتاحة لتحديد تصنيف نفايات الخليط المقترح. يجب على المراجع التحقق من تركيبته وخصائصه ذات الصلة قبل إسناد أي تصنيف.",
  },
};

const limitations = {
  en: "Segregation categories describe the proposed composition for sorting purposes. Hazard characteristics require mixture-specific evidence and applicable criteria. The submitted purity, pH and classifications require verification. The models cover material balances under stated assumptions. They leave resulting pH, reactions and mixture hazards undetermined.",
  ar: "تصف فئات الفرز التركيبة المقترحة لأغراض الفرز. وتتطلب خصائص الخطورة أدلة خاصة بالخليط ومعايير منطبقة. تتطلب النقاوة والأس الهيدروجيني والتصنيفات المقدّمة التحقق. تغطي النماذج موازين المادة وفق الافتراضات المعلنة. وتظل قيمة الأس الهيدروجيني الناتج والتفاعلات ومخاطر الخليط غير محدّدة.",
};

const missingLabels: Record<WasteGapCode, TextKey | { en: string; ar: string }> = {
  identity: { en: "Confirmed identity and formulation", ar: "الهوية والتركيبة المؤكدتان" },
  concentration: "concentration",
  solvent: "solvent",
  state: "state",
  temperature: "temperature",
  quantity: "quantity",
  conditions: { en: "Conditions for the proposed mixture", ar: "ظروف الخليط المقترح" },
  purity: "purity",
  ph: { en: "Pre-mixing pH where applicable", ar: "الأس الهيدروجيني قبل الخلط عند انطباقه" },
  finalVolume: "dilutionFinalVolume",
  mixtureEvidence: { en: "Evidence for the resulting composition under the stated conditions", ar: "أدلة على التركيبة الناتجة في الظروف المذكورة" },
  mixtureHazards: { en: "Mixture-specific hazard data and applicable waste criteria", ar: "بيانات خطورة خاصة بالخليط ومعايير النفايات المنطبقة" },
};

export function prepareWasteReview(request: AdminRequestDetail): WasteReviewDraft {
  const draft = request.report?.wasteAssessment;
  const references = scientificReferences(request.evidence, request.report?.calculation);
  const classifications = draft?.classifications ?? [undeterminedWaste];
  const basis = classifications.includes(undeterminedWaste) ? "insufficient" : draft?.basis ?? "insufficient";
  const missing: NonNullable<typeof draft>["missing"] = draft?.missing ?? [{ code: "mixtureEvidence" }, { code: "mixtureHazards" }];
  const missingText = (language: "en" | "ar") => missing.map(({ code, solution }) => {
    const label = missingLabels[code];
    return [solution && `${localizedLabel("solution", language)} ${solution}`,
      typeof label === "string" ? localizedLabel(label, language) : label[language]].filter(Boolean).join(" · ");
  }).join("\n");
  const hazardIds = new Set(draft?.hazardReferenceIds ?? []);
  const constituentSources = request.evidence.filter(({ id }) => hazardIds.has(id))
    .map(({ solution, kind, title, excerpt }) => `${solution} · ${(kind === "hazard" ? excerpt : title).slice(0, 95)}`);
  const hazards = {
    en: ["The proposed mixture’s hazard characteristics remain undetermined. Review retrieved records for constituent-level concerns.", ...constituentSources].join("\n"),
    ar: ["تظل خصائص خطورة الخليط المقترح غير محدّدة. راجع السجلات المسترجعة للتحقق من المخاطر المرتبطة بالمكوّنات.", ...constituentSources].join("\n"),
  };
  return {
    classifications, justification: justification[basis], hazards, limitations,
    missingInformation: { en: missingText("en"), ar: missingText("ar") },
    referenceIds: [...new Set([...(draft?.referenceIds ?? []), ...(draft?.hazardReferenceIds ?? [])])]
      .filter((id) => references.has(id)),
    mixtureSources: [], attestation: false,
  };
}
