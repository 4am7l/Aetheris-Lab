export type LabLanguage = "en" | "ar";
export function words(language: LabLanguage, en: string, ar: string) {
  return language === "ar" ? ar : en;
}
