/**
 * Minimal .docx text extraction with no dependencies: read the zip's central directory,
 * inflate word/document.xml with the platform's DecompressionStream, keep paragraph text.
 * Runs entirely in the browser — the file is never uploaded.
 */
export async function docxToText(data: ArrayBuffer): Promise<string> {
  const xml = await readZipEntry(new Uint8Array(data), "word/document.xml");
  return documentXmlToText(xml);
}

export function documentXmlToText(xml: string): string {
  const paras = xml.split(/<\/w:p>/);
  const out: string[] = [];
  for (const p of paras) {
    const text = [...p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>/g)]
      .map((m) => (m[1] !== undefined ? m[1] : m[0] === "<w:tab/>" ? "\t" : "\n"))
      .join("");
    out.push(decodeXml(text));
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function decodeXml(s: string) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

async function readZipEntry(buf: Uint8Array, name: string): Promise<string> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // End of central directory record: scan backwards for its signature.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a .docx (zip) file");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true);
    const elen = dv.getUint16(p + 30, true);
    const clen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const fname = dec.decode(buf.subarray(p + 46, p + 46 + nlen));
    if (fname === name) {
      const lnlen = dv.getUint16(local + 26, true);
      const lelen = dv.getUint16(local + 28, true);
      const start = local + 30 + lnlen + lelen;
      const body = buf.slice(start, start + csize);
      if (method === 0) return dec.decode(body);
      if (method !== 8) throw new Error("Unsupported compression in .docx");
      const stream = new Blob([body]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return await new Response(stream).text();
    }
    p += 46 + nlen + elen + clen;
  }
  throw new Error(`${name} not found — is this a Word document?`);
}
