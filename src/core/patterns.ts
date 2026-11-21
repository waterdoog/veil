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
  // Street addresses, e.g. "14 Ashbourne Terrace", "42 Alder Grove".
  {
    type: "LOCATION",
    re: /\b\d{1,4}[a-z]?\s+(?:[A-Z][a-z'’]+\s+){1,3}(?:Street|St|Road|Rd|Terrace|Close|Lane|Avenue|Ave|Grove|Way|Drive|Place|Crescent|Court|Gardens|Row|Walk|Mews|Hill|Square|Park|View|Rise)\b/g,
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
  // Money amounts.
  { type: "FINANCIAL", re: /£\s?\d[\d,]*(?:\.\d{2})?(?:\s?(?:k|K|grand|a (?:month|week|year)))?/g },
];

export function findPatterns(text: string): Entity[] {
  const out: Entity[] = [];
  const seen = new Set<string>();
  for (const { type, re } of PATTERNS) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const t = m[0].trim().replace(/[.,;:]+$/, "");
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
