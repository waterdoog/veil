import { applyCodebook } from "./codebook";
import type { ReportStudy } from "./report";
import { POLICIES } from "./types";

/**
 * REFI-QDA Project export (.qdpx) — the exchange format NVivo, ATLAS.ti, MAXQDA and QDA Miner import.
 * Pseudonymised transcripts become text sources; every quote the cloud coded becomes a coded selection.
 * Contains no real names: the codebook key stays out of it.
 * Spec: QDA-XML 1.0 (urn:QDA-XML:project:1.0), https://www.qdasoftware.org
 */
export interface QdpxResult {
  bytes: Uint8Array;
  xml: string;
  coded: number;
  unplaced: number;
}

const xmlEsc = (s: string) =>
  s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Code-point offset (what REFI-QDA positions count) for a UTF-16 index. */
const cp = (text: string, i: number) => Array.from(text.slice(0, i)).length;

const fold = (c: string) => (/\s/.test(c) ? " " : /[“”"]/.test(c) ? '"' : /[‘’']/.test(c) ? "'" : /[–—]/.test(c) ? "-" : c.toLowerCase());

/** Where does a (possibly lightly edited) quote sit in the text? Tolerates whitespace, curly quotes, case and "..." elisions. */
export function locateQuote(text: string, quote: string): [number, number] | null {
  const exact = text.indexOf(quote);
  if (exact >= 0) return [exact, exact + quote.length];
  // Normalised copy of the text with a map back to original indices.
  let norm = "";
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = fold(text[i]);
    if (c === " " && norm.endsWith(" ")) continue;
    norm += c;
    map.push(i);
  }
  const parts = quote
    .replace(/^[\s"'“”‘’]+|[\s"'“”‘’]+$/g, "")
    .split(/\s*(?:\.\.\.|…|\[\.\.\.\])\s*/)
    .map((p) => Array.from(p).map(fold).join("").replace(/ +/g, " ").trim())
    .filter((p) => p.length >= 4);
  if (!parts.length) return null;
  let from = 0;
  let start = -1;
  let end = -1;
  for (const p of parts) {
    const at = norm.indexOf(p, from);
    if (at < 0) return null;
    if (start < 0) start = at;
    end = at + p.length;
    from = end;
  }
  return [map[start], map[end - 1] + 1];
}

export function studyToQdpx(
  study: ReportStudy,
  opts: { now?: Date; guid?: () => string } = {},
): QdpxResult {
  const guid = opts.guid ?? (() => crypto.randomUUID());
  const now = (opts.now ?? new Date()).toISOString().replace(/\.\d{3}Z$/, "Z");
  const policy = POLICIES[study.policy];
  const user = guid();
  const ivs = study.interviews.filter((iv) => iv.status !== "raw" && iv.status !== "pseudonymising" && (!iv.deviceMissing || iv.attested));
  const texts = new Map(ivs.map((iv) => [iv.id, applyCodebook(iv.raw, study.codebook, policy, iv.id).redacted]));

  // Codes: one per interview theme name; cross-interview themes grouped under a parent.
  const codes = new Map<string, { guid: string; name: string; description: string }>();
  const codeFor = (name: string, description: string) => {
    const k = name.trim().toLowerCase();
    if (!codes.has(k)) codes.set(k, { guid: guid(), name: name.trim(), description });
    return codes.get(k)!.guid;
  };
  const synthCodes: { guid: string; name: string; description: string }[] = [];
  const selections = new Map<string, string[]>();
  let coded = 0;
  let unplaced = 0;
  const select = (ivId: string, quote: string, codeGuid: string) => {
    const text = texts.get(ivId);
    const at = text ? locateQuote(text, quote) : null;
    if (!text || !at) {
      unplaced++;
      return;
    }
    coded++;
    const name = quote.length > 60 ? quote.slice(0, 57) + "..." : quote;
    (selections.get(ivId) ?? selections.set(ivId, []).get(ivId)!).push(
      `      <PlainTextSelection guid="${guid()}" name="${xmlEsc(name)}" startPosition="${cp(text, at[0])}" endPosition="${cp(text, at[1])}" creatingUser="${user}" creationDateTime="${now}">\n` +
        `        <Coding guid="${guid()}" creatingUser="${user}" creationDateTime="${now}"><CodeRef targetGUID="${codeGuid}"/></Coding>\n` +
        `      </PlainTextSelection>`,
    );
  };
  for (const iv of ivs) for (const t of iv.analysis?.themes ?? []) {
    const g = codeFor(t.name, t.description);
    for (const q of t.quotes) select(iv.id, q.quote, g);
  }
  for (const t of study.synthesis?.themes ?? []) {
    const c = { guid: guid(), name: t.name.trim(), description: t.description };
    synthCodes.push(c);
    for (const q of t.quotes) select(q.interview, q.quote, c.guid);
  }

  const code = (c: { guid: string; name: string; description: string }, pad: string) =>
    `${pad}<Code guid="${c.guid}" name="${xmlEsc(c.name)}" isCodable="true"><Description>${xmlEsc(c.description)}</Description></Code>`;
  const files: { name: string; data: Uint8Array }[] = [];
  const enc = new TextEncoder();
  const sources = ivs.map((iv) => {
    const g = guid();
    files.push({ name: `sources/${g}.txt`, data: enc.encode(texts.get(iv.id)!) });
    const title = applyCodebook(iv.title, study.codebook, policy, iv.id).redacted;
    const desc = iv.analysis?.summary ? `\n      <Description>${xmlEsc(iv.analysis.summary)}</Description>` : "";
    const sels = selections.get(iv.id) ?? [];
    return (
      `    <TextSource guid="${g}" name="${xmlEsc(`${iv.id} — ${title}`)}" plainTextPath="internal://${g}.txt" creatingUser="${user}" creationDateTime="${now}">` +
      desc +
      (sels.length ? "\n" + sels.join("\n") : "") +
      `\n    </TextSource>`
    );
  });
  const projectName = applyCodebook(study.name, study.codebook, policy).redacted;
  const xml = [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<Project name="${xmlEsc(projectName)}" origin="Veil (pseudonymised; no real names)" creatingUserGUID="${user}" creationDateTime="${now}" xmlns="urn:QDA-XML:project:1.0">`,
    `  <Users><User guid="${user}" name="Veil"/></Users>`,
    `  <CodeBook>`,
    `    <Codes>`,
    ...[...codes.values()].map((c) => code(c, "      ")),
    ...(synthCodes.length
      ? [
          `      <Code guid="${guid()}" name="Cross-interview themes" isCodable="false">`,
          ...synthCodes.map((c) => code(c, "        ")),
          `      </Code>`,
        ]
      : []),
    `    </Codes>`,
    `  </CodeBook>`,
    ...(sources.length ? [`  <Sources>`, ...sources, `  </Sources>`] : []),
    `  <Description>Pseudonymised with Veil (policy: ${xmlEsc(policy.name)}). Placeholders like [PERSON_1] replace identifiers; the key is kept separately.</Description>`,
    `</Project>`,
    ``,
  ].join("\n");
  files.unshift({ name: "project.qde", data: enc.encode(xml) });
  return { bytes: zipStore(files), xml, coded, unplaced };
}

// ---- minimal ZIP writer (stored, no compression) -------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored
    local.setUint32(14, crc, true);
    local.setUint32(18, f.data.length, true);
    local.setUint32(22, f.data.length, true);
    local.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(local.buffer), name, f.data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, f.data.length, true);
    cd.setUint32(24, f.data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let p = 0;
  for (const c of all) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}
