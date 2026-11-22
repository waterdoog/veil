import { isGeneric, norm } from "./codebook";
import type { EntityType, Span } from "./types";

export interface GroundTruth {
  text: string;
  type: EntityType;
}

export interface EvalResult {
  total: number;
  caught: number;
  missed: GroundTruth[];
  recall: number;
  byType: Record<string, { total: number; caught: number }>;
  /** Replaced spans that overlap an answer-key identifier, out of all replaced spans. */
  precision: number;
  spans: number;
  falsePositives: string[];
}

/**
 * For the bundled fictional interviews we know every identifier (answer key).
 * An identifier counts as caught if every occurrence of it in the raw text is fully covered by redaction spans.
 */
export function evaluate(raw: string, spans: Span[], truth: GroundTruth[], types?: EntityType[]): EvalResult {
  const covered = new Uint8Array(raw.length);
  for (const s of spans) covered.fill(1, s.start, s.end);
  const rawLower = raw.toLowerCase();
  const seen = new Set<string>();
  const missed: GroundTruth[] = [];
  const byType: EvalResult["byType"] = {};
  let total = 0;
  let caught = 0;
  for (const t of truth) {
    if (types && !types.includes(t.type)) continue;
    const key = norm(t.text);
    if (!key || seen.has(key) || isGeneric(t.text)) continue;
    seen.add(key);
    // "St Jude's" redacted as "[ORG_1]'s" is fine: the possessive carries no identity.
    // Honorifics ("Dr. ") are not identifying on their own.
    const needle = t.text.replace(/[’']s$/i, "").replace(/^(?:dr|mr|mrs|ms|miss|prof)\.?\s+/i, "").toLowerCase();
    // Whole words only: "Vance" must not be checked inside "grievance".
    const isWord = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);
    const nextAt = (from: number) => {
      let i = rawLower.indexOf(needle, from);
      while (i >= 0 && (isWord(raw[i - 1]) || isWord(raw[i + needle.length]))) i = rawLower.indexOf(needle, i + 1);
      return i;
    };
    let idx = nextAt(0);
    if (idx < 0) continue;
    let ok = true;
    while (idx >= 0) {
      for (let i = idx; i < idx + needle.length; i++) {
        if (!covered[i] && /[\p{L}\p{N}]/u.test(raw[i])) {
          ok = false;
          break;
        }
      }
      if (!ok) break;
      idx = nextAt(idx + 1);
    }
    total++;
    byType[t.type] ??= { total: 0, caught: 0 };
    byType[t.type].total++;
    if (ok) {
      caught++;
      byType[t.type].caught++;
    } else missed.push(t);
  }
  // Precision: a replaced span is a true positive if it overlaps any occurrence of any answer-key identifier.
  const inTruth = new Uint8Array(raw.length);
  for (const t of truth) {
    const needle = t.text.toLowerCase();
    if (!needle) continue;
    for (let i = rawLower.indexOf(needle); i >= 0; i = rawLower.indexOf(needle, i + 1)) inTruth.fill(1, i, i + needle.length);
  }
  const fps: string[] = [];
  let tp = 0;
  for (const s of spans) {
    let hit = false;
    for (let i = s.start; i < s.end && !hit; i++) hit = inTruth[i] === 1;
    if (hit) tp++;
    else fps.push(raw.slice(s.start, s.end));
  }
  return {
    total,
    caught,
    missed,
    recall: total ? caught / total : 1,
    byType,
    precision: spans.length ? tp / spans.length : 1,
    spans: spans.length,
    falsePositives: [...new Set(fps)],
  };
}
