import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import { useState } from "react";
import { scientificReferences, type AdminRequestDetail } from "../../src/review";
import { scientificLabels } from "../../src/scientificLabels";
import {
  scientificTextLimit, scientificTopics, type ScientificSectionInput, type ScientificTopic,
} from "../../src/scientificReport";
import { useLanguage } from "../../src/text";
import { prepareScientificSections } from "./scientificText";
import { useAdminText } from "./text";

export function ScientificSectionEditor({ request, sections, onChange }: {
  request: AdminRequestDetail;
  sections: ScientificSectionInput[];
  onChange: (sections: ScientificSectionInput[]) => void;
}) {
  const t = useAdminText();
  const language = useLanguage();
  const [topic, setTopic] = useState<ScientificTopic | "">("");
  const available = scientificTopics.filter((key) => !sections.some((section) => section.topic === key));
  const references = scientificReferences(request.evidence, request.report?.calculation);

  function update(key: ScientificTopic, changes: Partial<ScientificSectionInput>) {
    onChange(sections.map((section) => section.topic === key ? { ...section, ...changes } : section));
  }

  return <fieldset className="request-fields admin-form">
    <legend>{t("reviewedScientificReport")}</legend>
    <p className="muted">{t("reviewScientificSections")}</p>
    {request.report?.scientificReport && !sections.length && <div>
      <Button type="button" variant="outlined" onClick={() => onChange(prepareScientificSections(request))}>
        {t("copyScientificSections")}
      </Button>
    </div>}
    {sections.map((section) => {
      const label = scientificLabels[section.topic][language];
      return <fieldset className="request-fields admin-evidence admin-form" key={section.topic}>
        <legend>{label}</legend>
        <TextField required fullWidth multiline label={label + " · English"} value={section.en}
          slotProps={{ htmlInput: { maxLength: scientificTextLimit, lang: "en", dir: "ltr" } }}
          onChange={(event) => update(section.topic, { en: event.target.value })} />
        <TextField required fullWidth multiline label={label + " · العربية"} value={section.ar}
          slotProps={{ htmlInput: { maxLength: scientificTextLimit, lang: "ar", dir: "rtl" } }}
          onChange={(event) => update(section.topic, { ar: event.target.value })} />
        {references.size > 0 && <details>
          <summary>{t("evidenceSelection")} · {section.referenceIds.length}</summary>
          <div className="admin-choices">{[...references].map(([id, { solution, title }]) => (
            <FormControlLabel key={id} label={<bdi>{solution ? solution + " · " : ""}{title}</bdi>}
              control={<Checkbox checked={section.referenceIds.includes(id)}
                disabled={!section.referenceIds.includes(id) && section.referenceIds.length >= 20}
                onChange={(_event, checked) => update(section.topic, { referenceIds: checked
                  ? [...section.referenceIds, id] : section.referenceIds.filter((reference) => reference !== id) })} />} />
          ))}</div>
        </details>}
        <div><Button type="button" onClick={() => onChange(sections.filter(({ topic }) => topic !== section.topic))}>
          {t("remove")}
        </Button></div>
      </fieldset>;
    })}
    {available.length > 0 && <div className="admin-toolbar">
      <TextField select fullWidth label={t("scientificSectionType")} value={available.includes(topic as ScientificTopic) ? topic : ""}
        onChange={(event) => setTopic(event.target.value as ScientificTopic | "")}>
        <MenuItem value="">{t("chooseScientificSection")}</MenuItem>
        {available.map((key) => <MenuItem key={key} value={key}>{scientificLabels[key][language]}</MenuItem>)}
      </TextField>
      <Button type="button" variant="outlined" disabled={!topic || !available.includes(topic)}
        onClick={() => {
          if (topic && available.includes(topic)) onChange([...sections, { topic, en: "", ar: "", referenceIds: [] }]);
          setTopic("");
        }}>
        {t("addScientificSection")}
      </Button>
    </div>}
  </fieldset>;
}
