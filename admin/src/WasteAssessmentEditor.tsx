import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import TextField from "@mui/material/TextField";
import { wasteClassificationLabels, wasteNarrativeLabels } from "../../src/chemistryLabels";
import { scientificReferences, type AdminRequestDetail } from "../../src/review";
import { scientificTextLimit } from "../../src/scientificReport";
import { useLanguage } from "../../src/text";
import {
  supportedWasteSelection, undeterminedWaste, wasteHazardCharacteristics, wasteNarrativeFields,
  wasteSegregationCategories, type WasteClassification,
} from "../../src/wasteAssessment";
import { ReviewerSources } from "./ReviewerSources";
import { useAdminText } from "./text";
import type { WasteReviewDraft } from "./wasteText";

export function WasteAssessmentEditor({ request, value, onChange }: {
  request: AdminRequestDetail;
  value: WasteReviewDraft;
  onChange: (value: WasteReviewDraft) => void;
}) {
  const t = useAdminText();
  const language = useLanguage();
  const references = scientificReferences(request.evidence, request.report?.calculation);
  const supported = supportedWasteSelection(value.classifications, value.referenceIds, request.report?.wasteAssessment);

  function update(changes: Partial<WasteReviewDraft>) {
    onChange({ ...value, ...changes, attestation: false });
  }

  function toggle(classification: WasteClassification, checked: boolean) {
    const next = checked ? [...value.classifications.filter((item) => item !== undeterminedWaste), classification]
      : value.classifications.filter((item) => item !== classification);
    update({ classifications: classification === undeterminedWaste || !next.length ? [undeterminedWaste] : next });
  }

  function choice(classification: WasteClassification) {
    return <FormControlLabel key={classification} label={wasteClassificationLabels[classification][language]}
      control={<Checkbox checked={value.classifications.includes(classification)}
        onChange={(_, checked) => toggle(classification, checked)} />} />;
  }

  return <fieldset className="request-fields admin-form">
    <legend>{t("chemicalWasteAssessment")}</legend>
    <p className="muted">{t("wasteReviewText")}</p>
    {choice(undeterminedWaste)}
    {([["wasteSegregation", wasteSegregationCategories], ["wasteHazardCharacteristics", wasteHazardCharacteristics]] as const)
      .map(([label, choices]) => <fieldset key={label} className="request-fields admin-choices">
        <legend>{t(label)}</legend>
        {choices.map(choice)}
      </fieldset>)}
    {wasteNarrativeFields.map((field) => <div className="admin-grid" key={field}>
      {(["en", "ar"] as const).map((locale) => <TextField key={locale} required fullWidth multiline
        label={`${t(wasteNarrativeLabels[field])} · ${locale === "en" ? "English" : "العربية"}`} value={value[field][locale]}
        slotProps={{ htmlInput: { maxLength: scientificTextLimit, lang: locale, dir: locale === "en" ? "ltr" : "rtl" } }}
        onChange={(event) => update({ [field]: { ...value[field], [locale]: event.target.value } })} />)}
    </div>)}
    {references.size > 0 && <details>
      <summary>{t("evidenceSelection")} · {value.referenceIds.length}</summary>
      <div className="admin-choices">{[...references].map(([id, { solution, title }]) => {
        const checked = value.referenceIds.includes(id);
        return <FormControlLabel key={id} label={<bdi>{solution ? solution + " · " : ""}{title}</bdi>}
          control={<Checkbox checked={checked} disabled={!checked && value.referenceIds.length >= 20}
            onChange={(_, selected) => update({ referenceIds: selected ? [...value.referenceIds, id]
              : value.referenceIds.filter((item) => item !== id) })} />} />;
      })}</div>
    </details>}
    {!supported && <p className="muted">{t("wasteMixtureEvidenceRequired")}</p>}
    <ReviewerSources mixture sources={value.mixtureSources} onChange={(mixtureSources) => update({ mixtureSources })} />
    <FormControlLabel label={t("wasteAttestation")}
      control={<Checkbox checked={value.attestation} onChange={(_, attestation) => onChange({ ...value, attestation })} />} />
  </fieldset>;
}
