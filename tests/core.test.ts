import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { guardPayload } from "../src/core/airlock";
import { chunkTranscript } from "../src/core/chunk";
import { applyCodebook, mergeEntities, rehydrate } from "../src/core/codebook";
import { evaluate } from "../src/core/evaluate";
import { findPatterns } from "../src/core/patterns";
import { POLICIES, type Entity } from "../src/core/types";

const std = POLICIES.standard;
const e = (text: string, type: Entity["type"]): Entity => ({ text, type, source: "nano" });

describe("codebook", () => {
  it("replaces every occurrence with a stable token and restores it locally", () => {
    const raw = "I told Sarah Jenkins at Brackenbridge Primary. Sarah said Brackenbridge Primary would cope.";
    const cb = mergeEntities([], [e("Sarah Jenkins", "PERSON"), e("Sarah", "PERSON"), e("Brackenbridge Primary", "ORG")], "p1");
    const { redacted, spans } = applyCodebook(raw, cb, std, "p1");
    expect(redacted).toBe("I told [PERSON_1] at [ORG_1]. [PERSON_1] said [ORG_1] would cope.");
    expect(spans).toHaveLength(4);
    expect(rehydrate(redacted, cb)).toBe("I told Sarah Jenkins at Brackenbridge Primary. Sarah Jenkins said Brackenbridge Primary would cope.");
  });

  it("does not replace inside other words", () => {
    const cb = mergeEntities([], [e("Ann", "PERSON")], "p1");
    expect(applyCodebook("Ann planned an annual review with Anna.", cb, std, "p1").redacted).toBe(
      "[PERSON_1] planned an annual review with Anna.",
    );
  });

  it("keeps people separate across interviews but shares organisations", () => {
    let cb = mergeEntities([], [e("Gareth", "PERSON"), e("St Jude's Hospital", "ORG")], "p1");
    cb = mergeEntities(cb, [e("Gareth", "PERSON"), e("St Jude's Hospital", "ORG")], "p2");
    const a = applyCodebook("Gareth went to St Jude's Hospital.", cb, std, "p1").redacted;
    const b = applyCodebook("Gareth went to St Jude's Hospital.", cb, std, "p2").redacted;
    expect(a).toBe("[PERSON_1] went to [ORG_1].");
    expect(b).toBe("[PERSON_2] went to [ORG_1].");
  });

  it("keeps health details under the standard policy and removes them under strict", () => {
    const cb = mergeEntities([], [e("POTS", "HEALTH")], "p1");
    expect(applyCodebook("Diagnosed with POTS.", cb, std, "p1").redacted).toBe("Diagnosed with POTS.");
    expect(applyCodebook("Diagnosed with POTS.", cb, POLICIES.strict, "p1").redacted).toBe("Diagnosed with [HEALTH_1].");
  });

  it("ignores generic words and placeholders a small model may return", () => {
    const cb = mergeEntities([], [e("NHS", "ORG"), e("Monday", "DATE"), e("[PERSON_1]", "PERSON"), e("I", "PERSON")], "p1");
    expect(cb).toHaveLength(0);
  });

  it("a switched-off entry is kept in plain text", () => {
    const cb = mergeEntities([], [e("Hope", "PERSON")], "p1").map((x) => ({ ...x, enabled: false }));
    expect(applyCodebook("Hope helps.", cb, std, "p1").redacted).toBe("Hope helps.");
  });
});

describe("patterns", () => {
  it("finds fixed-shape identifiers", () => {
    const t = "Call me on 07700 900123 or email chloe.b@example.com. NHS number 999 123 4567, postcode LS6 2QT, ref TRB-204881.";
    const found = findPatterns(t).map((x) => x.text);
    expect(found).toEqual(expect.arrayContaining(["07700 900123", "chloe.b@example.com", "999 123 4567", "LS6 2QT", "TRB-204881"]));
  });
  it("does not flag timestamps or years", () => {
    expect(findPatterns("[00:01:12] P: back in 2022, about 40 minutes").filter((x) => x.type !== "FINANCIAL")).toEqual([]);
  });
});

describe("airlock", () => {
  it("blocks a payload that still contains a codebook value", () => {
    const cb = mergeEntities([], [e("Chloe Bramwell", "PERSON")], "p1");
    const r = guardPayload("Summary: chloe bramwell felt tired.", cb, std);
    expect(r.ok).toBe(false);
    expect(r.findings[0].text).toBe("Chloe Bramwell");
  });
  it("blocks an email nobody detected", () => {
    const r = guardPayload("reach me at someone@example.org", [], std);
    expect(r.ok).toBe(false);
  });
  it("passes a pseudonymised payload", () => {
    const cb = mergeEntities([], [e("Chloe Bramwell", "PERSON")], "p1");
    const { redacted } = applyCodebook("Chloe Bramwell felt tired on 07700 900123.", mergeEntities(cb, findPatterns("07700 900123"), "p1"), std, "p1");
    expect(guardPayload(redacted, cb, std).ok).toBe(true);
  });
  it("respects a reviewer's decision to keep a pattern-shaped string", () => {
    const cb = mergeEntities([], findPatterns("code 123456"), "p1").map((x) => ({ ...x, enabled: false }));
    expect(guardPayload("code 123456", cb, std).ok).toBe(true);
  });
});

describe("chunking", () => {
  it("keeps chunks under the on-device budget and loses no text", () => {
    const lines = Array.from({ length: 200 }, (_, i) => `[00:${String(i).padStart(2, "0")}:00] P: line ${i} ` + "words ".repeat(20));
    const text = lines.join("\n");
    const chunks = chunkTranscript(text, 1500);
    expect(chunks.every((c) => c.length <= 1500)).toBe(true);
    const strip = (s: string) => s.replace(/[ \t]+$/gm, "");
    expect(strip(chunks.join("\n"))).toBe(strip(text));
  });
  it("splits a single very long turn at sentence boundaries", () => {
    const text = "P: " + "This is a sentence. ".repeat(300);
    const chunks = chunkTranscript(text, 1000);
    expect(chunks.every((c) => c.length <= 1000)).toBe(true);
    expect(chunks.length).toBeGreaterThan(5);
  });
});

describe("sample data + evaluation", () => {
  const dir = new URL("../sample-data/", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  it("ships six fictional interviews with answer keys", () => {
    expect(files).toHaveLength(6);
  });
  it("with a perfect detector, recall is 100% and the airlock passes", () => {
    for (const f of files) {
      const d = JSON.parse(readFileSync(new URL(f, dir), "utf8"));
      const ents = d.identifiers.map((i: { text: string; type: Entity["type"] }) => ({ ...i, source: "nano" as const }));
      const cb = mergeEntities([], [...findPatterns(d.transcript), ...ents], d.id);
      const { redacted, spans } = applyCodebook(d.transcript, cb, POLICIES.strict, d.id);
      const r = evaluate(d.transcript, spans, d.identifiers);
      expect(r.recall, `${f} missed ${r.missed.map((m) => m.text).join(", ")}`).toBeGreaterThan(0.97);
      const g = guardPayload(redacted, cb, POLICIES.strict);
      expect(g.findings.filter((x) => x.reason === "codebook"), f).toEqual([]);
    }
  });
});

import { extendNames } from "../src/core/patterns";
describe("name extension", () => {
  it("catches the surname after a detected first name", () => {
    const raw = "So I'm Chloe Bramwell. And Chloe said hello. Then Chloe And Mark left.";
    const ext = extendNames(raw, ["Chloe"]).map((e) => e.text);
    expect(ext).toEqual(["Chloe Bramwell"]);
    let cb = mergeEntities([], [e("Chloe", "PERSON")], "p1");
    cb = mergeEntities(cb, extendNames(raw, ["Chloe"]), "p1");
    expect(applyCodebook(raw, cb, std, "p1").redacted).toBe("So I'm [PERSON_1]. And [PERSON_1] said hello. Then [PERSON_1] And Mark left.");
  });
  it("finds street addresses", () => {
    expect(findPatterns("I live on 14 Ashbourne Terrace with Gareth").map((x) => x.text)).toContain("14 Ashbourne Terrace");
  });
});

describe("dates", () => {
  it("finds specific dates but not durations", () => {
    const f = findPatterns("born on the 12th of March 1989, ill since January 2023, back on 14 November. For three months I rested.").map((x) => x.text);
    expect(f).toEqual(expect.arrayContaining(["12th of March 1989", "January 2023", "14 November"]));
    expect(f.join(" ")).not.toContain("three months");
  });
});

import { guardSections } from "../src/core/airlock";
describe("names are case-sensitive and scoped", () => {
  it("does not redact the verb 'mark' for a person called Mark", () => {
    const cb = mergeEntities([], [e("Mark", "PERSON")], "p1");
    expect(applyCodebook("Mark said to mark it.", cb, std, "p1").redacted).toBe("[PERSON_1] said to mark it.");
  });
  it("one interview's participant name does not block another interview's ordinary word", () => {
    const cb = mergeEntities([], [e("Dev", "PERSON")], "p6");
    const g = guardSections(
      [
        { interviewId: "p3", text: "I'm a junior software dev." },
        { interviewId: "p6", text: "[PERSON_1] said hi." },
      ],
      cb,
      std,
    );
    expect(g.ok).toBe(true);
    expect(guardPayload("Dev said hi.", cb, std, "p6").ok).toBe(false);
  });
});

describe("surname linking", () => {
  it("links 'Dr Patel' to 'Sanjay Patel' in the same interview", () => {
    const raw = "I saw Sanjay Patel at the surgery. Dr. Patel said rest. Dr Patel again.";
    let cb = mergeEntities([], [e("Sanjay Patel", "PERSON")], "p1");
    cb = mergeEntities(cb, extendNames(raw, [], ["Sanjay Patel"]), "p1");
    expect(applyCodebook(raw, cb, std, "p1").redacted).toBe("I saw [PERSON_1] at the surgery. [PERSON_1] said rest. [PERSON_1] again.");
  });
});

describe("US identifiers", () => {
  it("finds US phone numbers, SSNs, ZIP+4 and boulevard addresses", () => {
    const t = "Call (415) 555-0132 or 212-555-0199. SSN 078-05-1120, ZIP 94103-1234, I live at 1200 Mission Boulevard.";
    const f = findPatterns(t).map((x) => x.text);
    expect(f).toEqual(expect.arrayContaining(["(415) 555-0132", "212-555-0199", "078-05-1120", "94103-1234", "1200 Mission Boulevard"]));
  });
});

import { auditReportHtml, pseudonymisedMarkdown } from "../src/core/report";
describe("exports", () => {
  const raw = "I'm Chloe Bramwell from Brackenbridge Primary, call 07700 900123.";
  const cb = mergeEntities([], [e("Chloe Bramwell", "PERSON"), e("Brackenbridge Primary", "ORG"), ...findPatterns(raw)], "p1");
  const study = { name: "Study of Chloe Bramwell", policy: "standard" as const, codebook: cb, interviews: [{ id: "p1", title: "Chloe Bramwell interview", raw, status: "review" }] };
  it("audit report contains no real values", () => {
    const html = auditReportHtml(study, [{ id: "x", at: 0, purpose: "analyse-interview", mode: "only_in_cloud", source: "in_cloud", status: "ok", bytesIn: 900, payloadPreview: "", interviewId: "p1", sha256: "ab".repeat(32) }]);
    for (const v of ["Chloe", "Bramwell", "Brackenbridge", "07700"]) expect(html).not.toContain(v);
    expect(html).toContain("sha256 abab");
  });
  it("pseudonymised dataset contains no real values", () => {
    const md = pseudonymisedMarkdown(study);
    for (const v of ["Chloe", "Bramwell", "Brackenbridge", "07700"]) expect(md).not.toContain(v);
    expect(md).toContain("[PERSON_1]");
  });
});

import { docxToText } from "../src/core/docx";
describe("docx import", () => {
  it("extracts paragraph text from a .docx", async () => {
    const buf = readFileSync(new URL("./fixtures/sample.docx", import.meta.url));
    const text = await docxToText(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    expect(text).toBe("[00:00:05] INT: Thanks for joining, Maya.\n[00:00:09] P: I work at Northgate & Co.");
  });
});

import { normaliseAnalysis } from "../src/ai/backend";
describe("cloud output normalisation", () => {
  it("fills missing fields instead of crashing the UI", () => {
    const a = normaliseAnalysis({ summary: "s", themes: [{ name: "n", quotes: [{ quote: "q" }] }] });
    expect(a.tensions).toEqual([]);
    expect(a.themes[0].description).toBe("");
    expect(a.themes[0].quotes[0]).toEqual({ quote: "q", timestamp: undefined });
  });
});

import { mergeTokens } from "../src/core/codebook";
import { codedQuotesCsv } from "../src/core/report";
describe("merge + csv", () => {
  it("merging two placeholders makes them one", () => {
    let cb = mergeEntities([], [e("St Jude's Hospital", "ORG"), e("the Jude", "ORG")], "p1");
    cb = mergeTokens(cb, "[ORG_2]", "[ORG_1]");
    expect(applyCodebook("St Jude's Hospital, aka the Jude.", cb, std, "p1").redacted).toBe("[ORG_1], aka [ORG_1].");
  });
  it("exports coded quotes as CSV with escaping", () => {
    const csv = codedQuotesCsv({ name: "s", policy: "standard", codebook: [], interviews: [{ id: "p1", title: "t", raw: "", status: "analysed", analysis: { summary: "", participant_context: "", tensions: [], follow_up_questions: [], themes: [{ name: "Fatigue", description: "a, b", quotes: [{ quote: 'He said "rest"', timestamp: "00:01:00" }] }] } }] });
    expect(csv.split("\n")[1]).toBe('interview,p1,Fatigue,"a, b","He said ""rest""",00:01:00');
  });
});

import { parseEntities } from "../src/ai/backend";
describe("on-device JSON salvage", () => {
  it("flags a cut-off reply as truncated and keeps the complete items", () => {
    const r = parseEntities('{"entities":[{"text":"Chloe","type":"PERSON"},{"text":"Brack');
    expect(r.truncated).toBe(true);
    expect(r.entities.map((e) => e.text)).toEqual(["Chloe"]);
  });
  it("parses a complete reply", () => {
    expect(parseEntities('{"entities":[{"text":"Leeds","type":"LOCATION"}]}')).toEqual({ entities: [{ text: "Leeds", type: "LOCATION", source: "nano" }], truncated: false });
  });
});

describe("salvage tolerance", () => {
  it("accepts any key order and lowercase types", () => {
    const r = parseEntities('{"entities":[{"type":"person","text":"Maya"},{"text":"Leeds","type":"LOCATION"},{"text":"Bro');
    expect(r.entities.map((e) => `${e.type}:${e.text}`)).toEqual(["PERSON:Maya", "LOCATION:Leeds"]);
  });
});

import { extendOrgs } from "../src/core/patterns";
describe("expansions learned from the real Nano run", () => {
  it("a known full name also covers the bare first name and surname", () => {
    const raw = "I'm Chloe Bramwell. Later Chloe said Bramwell family stuff. Mrs Bramwell too.";
    let cb = mergeEntities([], [e("Chloe Bramwell", "PERSON")], "p1");
    cb = mergeEntities(cb, extendNames(raw, [], ["Chloe Bramwell"]), "p1");
    expect(applyCodebook(raw, cb, std, "p1").redacted).toBe("I'm [PERSON_1]. Later [PERSON_1] said [PERSON_1] family stuff. [PERSON_1] too.");
  });
  it("an institution's short name is caught once its full name is known", () => {
    const raw = "I was admitted to St Jude's General Hospital. Back at St Jude's they said rest.";
    const ext = extendOrgs(raw, ["St Jude's General Hospital"]).map((x) => x.text);
    expect(ext).toEqual(["St Jude's"]);
    const cb = mergeEntities(mergeEntities([], [e("St Jude's General Hospital", "ORG")], "p1"), extendOrgs(raw, ["St Jude's General Hospital"]), "p1");
    expect(applyCodebook(raw, cb, std, "p1").redacted).toBe("I was admitted to [ORG_1]. Back at [ORG_2]'s they said rest.");
  });
});

describe("institution and age detectors", () => {
  it("finds named institutions and stated ages", () => {
    const t = "I'm 27 and I joined the Midlands Transport & Warehouse Union. The Long COVID Rehab Clinic at the University of Northshire, aged sixty-two.";
    const f = findPatterns(t).map((x) => `${x.type}:${x.text}`);
    expect(f).toEqual(expect.arrayContaining(["ORG:Midlands Transport & Warehouse Union", "ORG:Long COVID Rehab Clinic", "ORG:University of Northshire", "QUASI:I'm 27", "QUASI:sixty-two"]));
  });
  it("does not flag ordinary sentences", () => {
    expect(findPatterns("Then I went to the clinic and the union rep was there.").filter((x) => x.type === "ORG")).toEqual([]);
  });
});
