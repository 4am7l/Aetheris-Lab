import { wasteClassificationLabels, wasteNarrativeLabels } from "../chemistryLabels";
import { useLanguage, useText } from "../text";
import { Notice } from "../ui";
import {
  undeterminedWaste, wasteHazardCharacteristics, wasteNarrativeFields, wasteSegregationCategories, type ReviewedWasteAssessment,
} from "../wasteAssessment";

export function WasteAssessmentSection({ assessment }: { assessment: ReviewedWasteAssessment }) {
  const language = useLanguage();
  const t = useText();
  const { classifications, sources } = assessment;
  return <section className="waste-assessment">
    <h3>{t("chemicalWasteAssessment")}</h3>
    <h4>{t("proposedWasteClassifications")}</h4>
    {classifications.includes(undeterminedWaste) && <p>{wasteClassificationLabels[undeterminedWaste][language]}</p>}
    {([["wasteSegregation", wasteSegregationCategories], ["wasteHazardCharacteristics", wasteHazardCharacteristics]] as const)
      .map(([label, values]) => {
        const included = values.filter((value) => classifications.includes(value));
        return included.length > 0 && <section key={label}>
          <h5>{t(label)}</h5>
          <ul>{included.map((value) => <li key={value}>{wasteClassificationLabels[value][language]}</li>)}</ul>
        </section>;
      })}
    {wasteNarrativeFields.map((field) => <section key={field}>
      <h4>{t(wasteNarrativeLabels[field])}</h4>
      <p className="preserve-lines" dir={language === "ar" ? "rtl" : "ltr"}>
        {assessment[field][language]}
      </p>
    </section>)}
    {sources.length > 0 && <section>
      <h4>{t("references")}</h4>
      <ul>{sources.map(({ title, url }) => <li key={url}>
        <a className="text-link" href={url} target="_blank" rel="noreferrer"><bdi>{title}</bdi></a>
      </li>)}</ul>
    </section>}
    <Notice kind="warning">{t("wasteScope")}</Notice>
  </section>;
}
