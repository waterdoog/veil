import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import type { TextItem, TextMarkedContent } from "pdfjs-dist/types/src/display/api";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

function isTextItem(item: TextItem | TextMarkedContent): item is TextItem {
  return "str" in item;
}

export async function pdfToText(data: ArrayBuffer): Promise<string> {
  // Copy buffer to prevent detachment issues if caller reuses it
  const loadingTask = getDocument({ data: new Uint8Array(data.slice(0)) });
  const pdf = await loadingTask.promise;

  try {
    const pages: string[] = [];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      const textItems = content.items.filter(isTextItem);

      const lines: { y: number; closed: boolean; items: TextItem[] }[] = [];

      for (const item of textItems) {
        if (!item.str && !item.hasEOL) continue;

        const y = Number(item.transform[5]);
        let line = lines.find((l) => !l.closed && Math.abs(l.y - y) <= 2);

        if (!line) {
          line = { y, closed: false, items: [] };
          lines.push(line);
        }

        if (item.str) {
          line.items.push(item);
        }

        if (item.hasEOL) {
          line.closed = true;
        }
      }

      lines.sort((a, b) => b.y - a.y);

      const pageLines = lines
        .map((line) => {
          line.items.sort(
            (a, b) => Number(a.transform[4]) - Number(b.transform[4])
          );

          let text = "";
          for (const item of line.items) {
            if (!item.str) continue;
            if (text.length === 0) {
              text = item.str;
            } else if (/\s$/.test(text) || /^\s/.test(item.str)) {
              text += item.str;
            } else {
              text += " " + item.str;
            }
          }
          return text.replace(/[^\S\n]+$/g, "");
        })
        .filter((line) => line.length > 0);

      if (pageLines.length > 0) {
        pages.push(pageLines.join("\n"));
      }
      page.cleanup();
    }

    const fullText = pages
      .join("\n\n")
      .split("\n")
      .map((line) => line.replace(/[^\S\n]+$/g, ""))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    if (fullText.replace(/\s+/g, "").length < 20) {
      throw new Error(
        "This PDF has no text layer (scanned?). Try a photo of the page instead."
      );
    }

    return fullText;
  } finally {
    await pdf.destroy();
  }
}
