import { z } from "zod";

export const sdsSections = ["identification", "hazards", "composition", "storage", "physical", "incompatibilities", "disposal", "revision"] as const;
export const sdsCandidates = z.array(z.strictObject({
  section: z.enum(sdsSections), page: z.number().int().min(1).max(40),
  text: z.string().trim().min(1).max(1000),
})).max(32);
export type SdsCandidate = z.infer<typeof sdsCandidates>[number];

export function extractSdsCandidates(pages: string[]) {
  const headings = [
    ["identification", /(?:^|\s)(?:section\s*)?1\s*[.\-:]?\s*(?:identification|التعريف|تحديد الهوية)(?=\s|[:.]|$)/i],
    ["hazards", /(?:^|\s)(?:section\s*)?2\s*[.\-:]?\s*(?:hazards?|المخاطر)/i],
    ["composition", /(?:^|\s)(?:section\s*)?3\s*[.\-:]?\s*(?:composition|التركيب)/i],
    ["storage", /(?:^|\s)(?:section\s*)?7\s*[.\-:]?\s*(?:handling|storage|التخزين|المناولة)/i],
    ["physical", /(?:^|\s)(?:section\s*)?9\s*[.\-:]?\s*(?:physical|الخواص الفيزيائية)/i],
    ["incompatibilities", /(?:^|\s)(?:section\s*)?10\s*[.\-:]?\s*(?:stability|reactivity|الثبات|الاستقرار)/i],
    ["disposal", /(?:^|\s)(?:section\s*)?13\s*[.\-:]?\s*(?:disposal|التخلص)/i],
    ["revision", /(?:^|\s)(?:section\s*)?16\s*[.\-:]?\s*(?:other information|revision|معلومات أخرى)/i],
  ] as const;
  const anyHeading = /(?:^|\s)section\s+\d{1,2}\s*[:.-]?\s+/gi;
  return pages.slice(0, 40).flatMap((raw, index) => {
    const text = raw.normalize("NFKC").replace(/\s+/g, " ").slice(0, 30_000);
    const locations = headings.flatMap(([section, regex]) => {
      const match = regex.exec(text);
      return match ? [{ section, from: match.index, start: match.index + match[0].length }] : [];
    }).sort((a, b) => a.from - b.from);
    const allHeadings = [...text.matchAll(anyHeading)].map((match) => match.index);
    return locations.map(({ section, from, start }) => ({
      section, page: index + 1, text: text.slice(from, Math.min(start + 750,
        locations.find((next) => next.from > from)?.from ?? text.length,
        allHeadings.find((location) => location > start) ?? text.length)).trim(),
    }));
  }).slice(0, 32);
}
