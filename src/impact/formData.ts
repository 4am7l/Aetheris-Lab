export function field(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export function optional(form: FormData, name: string) {
  return field(form, name) || undefined;
}

export function numeric(form: FormData, name: string) {
  const value = field(form, name);
  return value ? Number(value) : undefined;
}
