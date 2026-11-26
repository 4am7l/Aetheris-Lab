import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import { useAdminText } from "./text";

type Source = { title: string; url: string };

export function ReviewerSources({ sources, onChange, mixture = false }: {
  sources: Source[];
  onChange: (sources: Source[]) => void;
  mixture?: boolean;
}) {
  const t = useAdminText();
  function update(index: number, field: keyof Source, value: string) {
    onChange(sources.map((source, position) => position === index ? { ...source, [field]: value } : source));
  }
  return <>
    {sources.map((source, index) => (
      <fieldset key={index} className="request-fields admin-form">
        <legend>{t(mixture ? "wasteMixtureSources" : "externalReference")}</legend>
        <TextField required fullWidth label={t("sourceTitle")} value={source.title}
          slotProps={{ htmlInput: { maxLength: 250 } }} onChange={(event) => update(index, "title", event.target.value)} />
        <TextField required fullWidth type="url" label={t("sourceUrl")} value={source.url}
          slotProps={{ htmlInput: { maxLength: 1500 } }} onChange={(event) => update(index, "url", event.target.value)} />
        <Button type="button" onClick={() => onChange(sources.filter((_, position) => position !== index))}>
          {t("remove")}
        </Button>
      </fieldset>
    ))}
    {sources.length < 5 && <div>
      <Button type="button" variant="outlined" onClick={() => onChange([...sources, { title: "", url: "" }])}>
        {t(mixture ? "wasteAddReference" : "addReference")}
      </Button>
    </div>}
  </>;
}
