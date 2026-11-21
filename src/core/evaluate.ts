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
    let idx = rawLower.indexOf(needle);
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
      idx = rawLower.indexOf(needle, idx + 1);
    }
    total++;
    byType[t.type] ??= { total: 0, caught: 0 };
    byType[t.type].total++;
    if (ok) {
      caught++;
      byType[t.type].caught++;
    } else missed.push(t);
  }
  return { total, caught, missed, recall: total ? caught / total : 1, byType };
}
