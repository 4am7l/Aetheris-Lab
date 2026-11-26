import { isSaltBalance } from "../../src/calculation";
import { localizedLabel, submittedPhLabel } from "../../src/chemistryLabels";
import { unknown } from "../../src/domain";
import { scientificReferences, type AdminRequestDetail } from "../../src/review";
import type { FindingCode, ScientificSectionInput, ScientificTopic } from "../../src/scientificReport";

const statements: Record<FindingCode, { en: string; ar: string }> = {
  identityRecords: {
    en: "The cited reference identities match the available submitted identifiers. Chemical identity in each physical sample still requires verification.",
    ar: "تتوافق هويات المواد في المراجع المشار إليها مع المعرّفات المتاحة في الطلب. ويظل التحقق من الهوية الكيميائية في كل عينة فعلية مطلوباً.",
  },
  identityUnresolved: {
    en: "At least one reference identity remains unresolved. Candidate records and unmatched hazards require independent verification.",
    ar: "تعذّر حسم هوية مرجعية واحدة على الأقل. يلزم التحقق المستقل من السجلات المرشحة والمخاطر التي لم تُربط بهوية مؤكدة.",
  },
  molecularDescriptors: {
    en: "The cited database records provide connectivity descriptors for the reference substances. Molecular interactions in the submitted formulation were undetermined.",
    ar: "تورد السجلات المرجعية أوصافاً لاتصالية الذرات في المواد المرجعية. ولم تُحدَّد التفاعلات الجزيئية في التركيبة المقدّمة.",
  },
  propertyRecords: {
    en: "The referenced physical properties describe individual substances under the source conditions. Properties of the submitted formulation remain undetermined.",
    ar: "تصف الخصائص الفيزيائية المرجعية المواد منفردةً في ظروف المصدر. وتظل خصائص التركيبة المقدّمة غير محدّدة.",
  },
  recordedConditions: {
    en: "The conditions below are declared by the submitter. Confirm the sample composition and operating conditions before reaching a formulation-specific conclusion.",
    ar: "الظروف أدناه واردة في الطلب. يجب التحقق من تركيب العيّنات وظروف التشغيل قبل اعتماد استنتاج خاص بالتركيبة.",
  },
  aqueousScope: {
    en: "The calculation assumes an aqueous, homogeneous liquid and conservation of the modeled solute. It uses the measured final volume and makes no quantitative solvent-effect prediction.",
    ar: "يفترض الحساب سائلاً مائياً متجانساً وحفظ كمية المذاب في النموذج. ويستخدم الحجم النهائي المقاس، دون تنبؤ كمي بتأثير المذيب.",
  },
  methanolBalance: {
    en: "The mass balance gives a nominal analytical concentration of retained methanol, conditional on the declared measurements.",
    ar: "يعطي حساب ميزان المادة تركيزاً تحليلياً اسمياً للميثانول المحتفَظ به، مشروطاً بصحة القياسات المصرّح بها.",
  },
  saltBalance: {
    en: "The stoichiometric balance uses the measured final volume. The nominal amount and molarity apply to each modeled ion.",
    ar: "يستخدم الميزان الستوكيومتري الحجم النهائي المقاس. وتنطبق كمية المادة والتركيز المولي الاسميان على كل أيون في النموذج.",
  },
  saltDissociation: {
    en: "The material balance assumes complete dissociation of dissolved sodium chloride, giving one sodium ion and one chloride ion per formula unit.",
    ar: "يفترض ميزان المادة تفكك كلوريد الصوديوم المذاب كلياً، بحيث تنتج كل وحدة صيغية أيون صوديوم واحداً وأيون كلوريد واحداً.",
  },
  substanceSolubility: {
    en: "The cited solubility data apply to the reference substances and source conditions. Saturation and precipitation in the submitted formulation remain undetermined.",
    ar: "تنطبق بيانات الذوبانية المشار إليها على المواد المرجعية وظروف المصدر. ويظل التشبّع والترسّب في التركيبة المقدّمة غير محدّدين.",
  },
  substanceReactivity: {
    en: "The cited reactivity records document substance-level concerns. Compatibility for the submitted pair under the stated conditions remains unverified.",
    ar: "توثّق مراجع التفاعلية مخاطر مرتبطة بالمواد منفردةً. ويظل توافق المادتين في ظروف الطلب غير متحقق منه.",
  },
  occupationalHazards: {
    en: "The cited records document exposure or toxicity hazards for identified reference substances. Mixture exposure and toxicity require formulation-specific evidence.",
    ar: "توثّق المراجع مخاطر التعرّض أو السُمّية للمواد المرجعية المحدّدة. ويتطلب تقييم تعرّض الخليط وسُمّيته أدلة خاصة بالتركيبة.",
  },
  substanceFire: {
    en: "The cited records document fire or explosion hazards for identified reference substances. The submitted formulation’s fire behavior remains undetermined.",
    ar: "توثّق المراجع مخاطر الحريق أو الانفجار للمواد المرجعية المحدّدة. ويظل سلوك التركيبة المقدّمة في الحريق غير محدّد.",
  },
  substanceEnvironmental: {
    en: "The cited records document environmental hazards for identified reference substances. Environmental fate and impacts of the submitted formulation remain undetermined.",
    ar: "توثّق المراجع مخاطر بيئية للمواد المرجعية المحدّدة. ويظل المصير البيئي للتركيبة المقدّمة وتأثيراتها غير محدّدين.",
  },
  missingInputs: {
    en: "The listed missing or unresolved inputs limit quantitative assessment and formulation-specific conclusions.",
    ar: "تحدّ المدخلات الناقصة أو غير المحسومة المبيّنة من التقييم الكمي والاستنتاجات الخاصة بالتركيبة.",
  },
  modelUnavailable: {
    en: "No quantitative result is available for the submitted conditions. Reaction products, equilibrium, pH, heat effects, kinetics and phase behavior are undetermined.",
    ar: "لا تتوفر نتيجة كمية لظروف الطلب. وتظل نواتج التفاعل والاتزان والأس الهيدروجيني والتأثيرات الحرارية والحركية وسلوك الأطوار غير محدّدة.",
  },
  measurementUncertainty: {
    en: "Measurement uncertainty was unavailable. The balance does not establish activities, pH, equilibrium, reaction rates, heat effects or phase stability.",
    ar: "لم تتوفر بيانات عدم يقين القياس. ولا يحدّد الميزان الأنشطة الكيميائية أو الأس الهيدروجيني أو الاتزان أو سرعات التفاعل أو التأثيرات الحرارية أو ثبات الأطوار.",
  },
  substanceScope: {
    en: "A source record for an individual substance cannot establish safety or compatibility for a formulation. Missing records or hazard statements leave uncertainty.",
    ar: "سجل المادة المنفردة لا يثبت سلامة التركيبة أو توافقها. ويترك غياب السجلات أو بيانات المخاطر قدراً من عدم اليقين.",
  },
  reviewRequired: {
    en: "Overall safety under the submitted conditions is indeterminate on the automated evidence. A qualified reviewer must establish the final assessment.",
    ar: "لا تكفي الأدلة المتاحة آلياً لحسم السلامة العامة في ظروف الطلب. ويتولى مُراجع مختص إعداد التقييم النهائي.",
  },
};

const isolate = (text: string) => "\u2066" + text + "\u2069";
const display = (value: number) => Number(value.toPrecision(6));

function scientificData(code: FindingCode, request: AdminRequestDetail, language: "en" | "ar"): string[] {
  const report = request.report;
  const calc = report?.calculation;
  if (code === "saltDissociation") return ["NaCl(aq) → Na⁺(aq) + Cl⁻(aq)"];
  if (code === "recordedConditions") {
    return ([["A", request.input.a], ["B", request.input.b]] as const).flatMap(([side, input]) => {
      const values = [
        input.temperature === unknown ? "" : input.temperature + " °C",
        input.concentration === unknown || input.unit === unknown ? "" : input.concentration + " " + input.unit,
        input.quantity === unknown || input.quantityUnit === unknown ? "" : input.quantity + " " + input.quantityUnit,
        input.ph === undefined ? "" : localizedLabel("preMixingPh", language) + " " + submittedPhLabel(input.ph, language),
      ].filter(Boolean);
      return values.length ? [side + " · " + values.join(" · ")] : [];
    });
  }
  if (code === "identityRecords" || code === "molecularDescriptors") {
    return (report?.identities ?? []).filter(({ state }) => state === "matched")
      .flatMap(({ solution, records }) => records.flatMap(({ name, formula, cid, molecularWeight, smiles }) =>
        code === "molecularDescriptors"
          ? smiles ? [solution + " · SMILES " + smiles] : []
          : [[solution, name, formula, "CID " + cid, molecularWeight && molecularWeight + " g/mol"].filter(Boolean).join(" · ")]));
  }
  if (calc?.status !== "calculated") return [];
  if (code === "saltBalance" && isSaltBalance(calc)) {
    const operands = calc.stocks.map(({ molPerL, volumeL }) => "(" + display(molPerL) + " mol/L × " + display(volumeL) + " L)");
    return [
      "n(Na⁺) = n(Cl⁻) = " + operands.join(" + ") + " = " + display(calc.amountMolPerIon) + " mol",
      "c(Na⁺) = c(Cl⁻) = n / " + display(calc.finalVolumeL) + " L = " + display(calc.molPerLPerIon) + " mol/L",
    ];
  }
  if (code === "methanolBalance" && !isSaltBalance(calc)) {
    const { stockMolPerL, stockVolumeL, finalVolumeL } = calc.inputs;
    return [
      "c(final) = c(stock) × V(stock) / V(final)",
      display(stockMolPerL) + " mol/L × " + display(stockVolumeL) + " L / " + display(finalVolumeL) +
        " L = " + display(calc.result.analyticalMolPerL) + " mol/L",
    ];
  }
  return [];
}

export function findingContent(code: FindingCode, request: AdminRequestDetail, language: "en" | "ar") {
  const rows = scientificData(code, request, language);
  return { ...statements[code], rows };
}

export function prepareScientificSections(request: AdminRequestDetail): ScientificSectionInput[] {
  const grouped = new Map<ScientificTopic, ScientificSectionInput>();
  const references = scientificReferences(request.evidence, request.report?.calculation);
  for (const { code, topic, referenceIds } of request.report?.scientificReport?.findings ?? []) {
    const english = findingContent(code, request, "en");
    const arabic = findingContent(code, request, "ar");
    const previous = grouped.get(topic);
    grouped.set(topic, {
      topic,
      en: [previous?.en, english.en, ...english.rows].filter(Boolean).join("\n"),
      ar: [previous?.ar, arabic.ar, ...arabic.rows.map(isolate)].filter(Boolean).join("\n"),
      referenceIds: [...new Set([...(previous?.referenceIds ?? []), ...referenceIds])].filter((id) => references.has(id)),
    });
  }
  return [...grouped.values()];
}
