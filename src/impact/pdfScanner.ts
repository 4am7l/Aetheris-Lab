/// <reference types="vite/client" />
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { extractSdsCandidates } from "./sds";

GlobalWorkerOptions.workerSrc = workerUrl;

export async function scanPdf(file: File) {
  if (file.size <= 0 || file.size > 5 * 1024 * 1024) throw new Error("PDF size is unsupported");
  const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()),
    enableXfa: false, disableFontFace: true, useWasm: false, stopAtErrors: true });
  try {
    const pdf = await task.promise;
    const pages: string[] = [];
    for (let i = 1; i <= Math.min(pdf.numPages, 40); i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.flatMap((item) => "str" in item ? [item.str] : []).join(" ").slice(0, 30_000));
      page.cleanup();
    }
    return { candidates: extractSdsCandidates(pages), pages: pdf.numPages, hasText: pages.some((text) => text.trim().length > 0) };
  } finally {
    await task.destroy();
  }
}
