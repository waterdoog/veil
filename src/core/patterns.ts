import type { Entity, EntityType } from "./types";

/**
 * Deterministic detectors that run before and after the on-device model.
 * They catch the identifiers that have a fixed shape (emails, phone numbers, postcodes,
 * reference numbers), so the model's job is the hard part: names, places, context.
 */
const PATTERNS: { type: EntityType; re: RegExp }[] = [
  { type: "CONTACT", re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi },
  // UK mobiles and landlines, with or without +44 and spaces/dashes.
  { type: "CONTACT", re: /(?:\+44\s?\(?0?\)?\s?|\b0)(?:\d[\s-]?){9,10}\b/g },
  { type: "CONTACT", re: /\bhttps?:\/\/[^\s)]+/gi },
  // US phone numbers: (415) 555-0132, 415-555-0132, +1 415 555 0132.
  { type: "CONTACT", re: /(?:\+1[\s.-]?)?(?:\(\d{3}\)\s?|\b\d{3}[\s.-])\d{3}[\s.-]\d{4}\b/g },
  // US Social Security numbers and ZIP+4.
  { type: "ID", re: /\b\d{3}-\d{2}-\d{4}\b/g },
  { type: "LOCATION", re: /\b\d{5}-\d{4}\b/g },
  // Street addresses, e.g. "14 Ashbourne Terrace", "42 Alder Grove".
  {
    type: "LOCATION",
    re: /\b\d{1,4}[a-z]?\s+(?:[A-Z][a-z'’]+\s+){1,3}(?:Street|St|Road|Rd|Terrace|Close|Lane|Avenue|Ave|Grove|Way|Drive|Place|Crescent|Court|Gardens|Row|Walk|Mews|Hill|Square|Park|View|Rise|Boulevard|Blvd|Parkway|Pkwy|Highway|Hwy)\b/g,
  },
  // UK postcodes, e.g. "LS6 2QT", "M1 1AE".
  { type: "LOCATION", re: /\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/g },
  // NHS-style numbers (3-3-4) and other long reference numbers.
  { type: "ID", re: /\b\d{3}[\s-]\d{3}[\s-]\d{4}\b/g },
  { type: "ID", re: /\b(?=[A-Z0-9-]*\d)[A-Z]{1,4}-?\d{5,}\b/g },
  { type: "ID", re: /\b\d{6,}\b/g },
  // National Insurance numbers.
  { type: "ID", re: /\b[A-CEGHJ-PR-TW-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/g },
  // Specific dates: "12th of March 1989", "14 November 2022", "January 2023", "12/03/2024".
  {
    type: "DATE",
    re: /\b(?:\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December)(?:,?\s+\d{4})?|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?|(?:January|February|March|April|June|July|August|September|October|November|December)\s+\d{4})\b/g,
  },
  { type: "DATE", re: /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g },
  // Named institutions: capitalised phrases ending in an institution word, "University of X".
  {
    type: "ORG",
    re: /\b(?:(?:[A-Z][\w'’.-]*|&|of|and|for)\s+){0,5}?[A-Z][\w'’.-]*\s+(?:Clinic|Union|University|Group|Trust|Hospital|Infirmary|Surgery|Practice|School|College|Council|Ltd|Limited|Foundation|Society|Association|Partnership)\b|\bUniversity of [A-Z][a-z]+(?:\s[A-Z][a-z]+)?/g,
  },
  // Titled names are people whether or not the model noticed: "Mrs. Gable", "Dr Kerr", "Prof. Mensah".
  { type: "PERSON", re: /\b(?:Dr|Mrs|Mr|Ms|Miss|Prof|Nurse|Sister|Father|Rev)\.?\s[A-Z][a-z'’-]+(?:\s[A-Z][a-z'’-]+)?\b/g },
  // "52 years old", "a 19-year-old".
  { type: "QUASI", re: /\b\d{2}[- ]years?[- ]old\b/gi },
  // Stated ages ("I'm 27", "aged sixty-two") — a quasi-identifier.
  {
    type: "QUASI",
    re: /\b(?:I'm|I am|I’m|aged|age of|turned|turning)\s+(?:\d{2}|(?:twenty|thirty|forty|fifty|sixty|seventy|eighty)(?:-(?:one|two|three|four|five|six|seven|eight|nine))?)(?:[- ]years?[- ]old)?\b/gi,
  },
  // Money amounts.
  { type: "FINANCIAL", re: /[£$€]\s?\d[\d,]*(?:\.\d{2})?(?:\s?(?:k|K|grand|a (?:month|week|year)))?/g },
];

export function findPatterns(text: string): Entity[] {
  const out: Entity[] = [];
  const seen = new Set<string>();
  for (const { type, re } of PATTERNS) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      let t = m[0].trim().replace(/[.,;:]+$/, "");
      if (type === "ORG") t = t.replace(/^(?:(?:The|the|A|An|At|at|And|and|To|to|In|in|From|from|With|with)\s+)+/, "");
      if (type === "ORG" && /^(?:Part-Time|Full-Time|Local|General|Private|Public|Primary|Secondary|Big|Small)\s/i.test(t)) continue;
      // Word ages ("sixty-two") are distinctive on their own; a bare "27" is not, so keep "I'm 27" as the span.
      if (type === "QUASI" && !/\d$/.test(t)) t = t.replace(/^(?:I'm|I am|I’m|aged|age of|turned|turning)\s+/i, "");
      if (t.length < 3) continue;
      const key = type + "|" + t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ text: t, type, source: "pattern" });
    }
  }
  return out;
}

const NOT_SURNAME = new Set(["I", "The", "And", "But", "So", "Then", "Yeah", "Um", "Oh", "Well", "Like", "Just", "From", "At", "In", "On", "My", "Our", "Said", "Says", "Was", "Is", "Who", "Has", "Had", "Would", "Could", "Did", "Does", "Not", "No", "Yes", "Okay", "OK", "Right"]);

/**
 * If the model found a first name, also catch "First Surname" in the raw text — small models often
 * return just the first name. Returns extra PERSON entities to merge (same token via first-name linking).
 */
export function extendNames(text: string, firstNames: string[], fullNames: string[] = []): Entity[] {
  const out: Entity[] = [];
  const seen = new Set<string>();
  // "Sanjay Patel" known -> also catch "Dr Patel", "Mrs. Patel" anywhere in the interview.
  for (const full of fullNames) {
    const last = full.trim().split(/\s+/).pop() ?? "";
    if (!/^[A-Z][a-z'’-]{2,}$/.test(last)) continue;
    const re = new RegExp(`\\b(?:Dr|Mr|Mrs|Ms|Miss|Prof|Nurse)\\.?\\s+${last}\\b`, "g");
    for (const m of text.matchAll(re)) {
      if (seen.has(m[0])) continue;
      seen.add(m[0]);
      out.push({ text: m[0], type: "PERSON", source: "pattern" });
    }
  }
  // "Mr. Foley" known -> "Foley" alone and "Padraig Foley" are the same person.
  for (const titled of fullNames.filter((n) => /^(?:Dr|Mr|Mrs|Ms|Miss|Prof|Nurse)\.?\s/.test(n))) {
    const sur = titled.trim().split(/\s+/).pop() ?? "";
    if (!/^[A-Z][a-z'’-]{2,}$/.test(sur)) continue;
    for (const m of text.matchAll(new RegExp(`\\b([A-Z][a-z'’-]{2,})\\s+${sur}\\b`, "g"))) {
      if (NOT_SURNAME.has(m[1]) || /^(Dr|Mr|Mrs|Ms|Miss|Prof|Nurse)$/.test(m[1]) || seen.has(m[0])) continue;
      seen.add(m[0]);
      out.push({ text: m[0], type: "PERSON", source: "pattern" });
    }
    if (!seen.has(sur) && new RegExp(`\\b${sur}\\b`).test(text)) {
      seen.add(sur);
      out.push({ text: sur, type: "PERSON", source: "pattern" });
    }
  }
  // "Chloe Bramwell" known -> people are also called just "Chloe" or "Bramwell" later on.
  // (Real Gemini Nano runs showed bare first names were the most common miss.)
  for (const full of fullNames) {
    const parts = full.trim().split(/\s+/).filter((w) => !/^(Dr|Mr|Mrs|Ms|Miss|Prof|Nurse)\.?$/.test(w));
    if (parts.length < 2) continue;
    for (const w of [parts[0], parts[parts.length - 1]]) {
      if (!/^[A-Z][a-z'’-]{2,}$/.test(w) || NOT_SURNAME.has(w) || seen.has(w)) continue;
      if (new RegExp(`\\b${w}\\b`).test(text)) {
        seen.add(w);
        out.push({ text: w, type: "PERSON", source: "pattern" });
      }
    }
  }
  for (const f of firstNames) {
    if (!/^[A-Z][a-z'’-]+$/.test(f)) continue;
    const re = new RegExp(`\\b${f}\\s+((?:[A-Z][a-z'’-]+-)?[A-Z][a-z'’-]{2,})\\b`, "g");
    for (const m of text.matchAll(re)) {
      if (NOT_SURNAME.has(m[1])) continue;
      const full = `${f} ${m[1]}`;
      if (seen.has(full)) continue;
      seen.add(full);
      out.push({ text: full, type: "PERSON", source: "pattern" });
    }
  }
  return out;
}

const INSTITUTION_TAIL =
  /\s+(?:General Hospital|University Hospital|Hospital|Infirmary|Medical Practice|Medical Centre|Health Centre|Surgery|Clinic|Primary School|Secondary School|Academy|School|College|Ltd|Limited|plc|Group|Trust|Council)$/;

/**
 * "St Jude's General Hospital" known -> the same place is often just "St Jude's" later on.
 * Returns the stem as an ORG entity when it also appears on its own in the text.
 */
export function extendOrgs(text: string, orgNames: string[]): Entity[] {
  const out: Entity[] = [];
  const seen = new Set<string>();
  for (const o of orgNames) {
    const stem = o.trim().replace(INSTITUTION_TAIL, "");
    if (stem === o.trim() || stem.length < 4 || !/^[A-Z]/.test(stem) || seen.has(stem)) continue;
    const esc = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, "u").test(text.replace(o, ""))) {
      seen.add(stem);
      out.push({ text: stem, type: "ORG", source: "pattern" });
    }
  }
  return out;
}

/**
 * "Buckeye Valley Medical Center" known -> "BVMC" later is the same place.
 * Builds the initials of each known multi-word organisation and returns those that appear as words.
 */
export function extendAcronyms(text: string, orgNames: string[]): Entity[] {
  const out: Entity[] = [];
  const seen = new Set<string>();
  for (const o of orgNames) {
    const words = o.split(/[\s&]+/).filter((w) => /^[A-Z]/.test(w));
    if (words.length < 2) continue;
    const acr = words.map((w) => w[0]).join("");
    if (acr.length < 2 || seen.has(acr)) continue;
    if (new RegExp(`\\b${acr}\\b`).test(text)) {
      seen.add(acr);
      out.push({ text: acr, type: "ORG", source: "pattern" });
    }
  }
  return out;
}
