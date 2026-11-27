import type { ReactNode } from "react";
import { Button, TextField } from "@mui/material";
import { useLanguage } from "../text";
import { words, message } from "./client";

export function LabInput({ name, en, ar, type = "text", required, value, multiline }: {
  name: string; en: string; ar: string; type?: string; required?: boolean; value?: string | number | null; multiline?: boolean;
}) {
  const lang = useLanguage();
  return <TextField name={name} label={words(lang, en, ar)} type={type} required={required} defaultValue={value ?? ""}
    fullWidth size="small" multiline={multiline} minRows={multiline ? 2 : undefined}
    slotProps={{ inputLabel: { shrink: type === "date" || undefined }, htmlInput: { step: type === "number" ? "any" : undefined } }} />;
}

export function LabSelect({ name, en, ar, options, value = "", required }: {
  name: string; en: string; ar: string; options: readonly (readonly [string, string])[]; value?: string; required?: boolean;
}) {
  const lang = useLanguage();
  return <TextField name={name} label={words(lang, en, ar)} select fullWidth size="small" defaultValue={value}
    required={required} slotProps={{ inputLabel: { shrink: true }, select: { native: true } }}>
    {(!required || !value) && <option value="">{words(lang, "None selected", "لم يُحدّد")}</option>}
    {options.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
  </TextField>;
}
export function FormError({ error }: { error: unknown }) {
  const lang = useLanguage();
  return error ? <p className="impact-error" role="alert">{message(error, lang)}</p> : null;
}
export function Submit({ busy, children }: { busy?: boolean; children?: ReactNode }) {
  const lang = useLanguage();
  return <div><Button type="submit" variant="contained" disabled={busy}>
    {busy ? words(lang, "Saving…", "جارٍ الحفظ…") : children ?? words(lang, "Save", "حفظ")}
  </Button></div>;
}
