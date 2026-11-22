import type { CodebookEntry, Entity, EntityType, Policy, Span } from "./types";

/** Normalise a detected string for de-duplication: trim, collapse spaces, drop trailing possessive. */
export function norm(s: string): string {
  return s
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[’']s$/i, "")
    .replace(/^[("'“‘]+|[)"'”’.,;:!?]+$/g, "")
    .toLowerCase();
}

const MIN_LEN = 2;
const TITLES = new Set(["dr", "mr", "mrs", "ms", "miss", "prof", "nurse"]);
/** Common words a small model sometimes returns as "entities". Never treat these as identifiers. */
const STOP = new Set([
  "i", "me", "my", "we", "us", "you", "he", "she", "they", "him", "her", "them", "it",
  "int", "p", "the", "a", "an", "and", "or", "mum", "dad", "doctor", "gp", "nhs", "covid",
  "long covid", "work", "home", "today", "yesterday", "monday", "tuesday", "wednesday",
  "thursday", "friday", "saturday", "sunday", "morning", "evening", "uk", "england", "dwp", "acas",
  "jobcentre", "universal credit", "a&e",
  // Benefit names describe a situation shared by millions; they are research data, not identifiers.
  "statutory sick pay", "ssp", "pip", "personal independence payment", "carer's allowance", "carers allowance",
  "esa", "employment and support allowance", "housing benefit", "child benefit", "medicaid", "medicare", "snap",
]);

/** True for words that are too generic to be identifiers on their own ("NHS", "Monday", "mum"). */
export function isGeneric(text: string): boolean {
  return STOP.has(norm(text));
}

export function isUsable(e: Entity): boolean {
  const n = norm(e.text);
  if (n.length < MIN_LEN) return false;
  if (STOP.has(n)) return false;
  if (/^\[[A-Z]+_\d+\]$/.test(e.text.trim())) return false; // already a token
  return true;
}

/**
 * Merge new detections into the study codebook. Tokens are stable across the whole study, so the
 * same clinic is [ORG_4] in every interview and in the cloud's cross-interview synthesis.
 * A bare first name is linked to a full name from the same interview ("Sarah" -> same token as
 * "Sarah Jenkins"), but not across interviews: two participants' different Gareths stay different.
 */
export function mergeEntities(codebook: CodebookEntry[], entities: Entity[], origin?: string): CodebookEntry[] {
  const out = codebook.map((e) => ({ ...e }));
  // People are scoped to one interview (two participants' "Gareth" are different people);
  // organisations, places etc. are shared across the study so cross-case analysis lines up.
  const key = (type: EntityType, n: string, o?: string) => (type === "PERSON" ? `${o ?? ""}|${n}` : n);
  const byNorm = new Map(out.map((e) => [key(e.type, norm(e.real), e.origin), e]));
  const counters = new Map<EntityType, number>();
  for (const e of out) {
    const n = Number(e.token.match(/_(\d+)\]$/)?.[1] ?? 0);
    counters.set(e.type, Math.max(counters.get(e.type) ?? 0, n));
  }
  const next = (t: EntityType) => {
    const n = (counters.get(t) ?? 0) + 1;
    counters.set(t, n);
    return `[${t}_${n}]`;
  };

  for (const raw of entities) {
    if (!isUsable(raw)) continue;
    const real = raw.text.trim().replace(/\s+/g, " ").replace(/[’']s$/i, "");
    const n = norm(real);
    const k = key(raw.type, n, origin);
    if (byNorm.has(k) || (raw.type !== "PERSON" && out.some((e) => e.type === "PERSON" && e.origin === origin && norm(e.real) === n))) continue;
    let token: string | undefined;
    if (raw.type === "PERSON") {
      const titled = (x: string[]) => x.length === 2 && TITLES.has(x[0].replace(/\.$/, ""));
      const parts = n.split(" ");
      for (const e of out) {
        if (e.type !== "PERSON" || e.origin !== origin) continue;
        const ep = norm(e.real).split(" ");
        // "sarah" ~ "sarah jenkins", or "sarah jenkins" ~ "sarah" (first name seen first)
        const firstLink = (parts.length === 1 && ep[0] === parts[0]) || (ep.length === 1 && parts[0] === ep[0]);
        // "dr patel" ~ "sanjay patel" (same surname, one side has a title)
        const lastLink =
          (titled(parts) && !titled(ep) && ep.length > 1 && ep[ep.length - 1] === parts[1]) ||
          (titled(ep) && !titled(parts) && parts.length > 1 && parts[parts.length - 1] === ep[1]);
        if (firstLink || lastLink) {
          token = e.token;
          break;
        }
      }
    }
    const entry: CodebookEntry = {
      real,
      token: token ?? next(raw.type),
      type: raw.type,
      source: raw.source,
      enabled: true,
      origin,
    };
    out.push(entry);
    byNorm.set(k, entry);
  }
  return out;
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Build one regex for all active entries, longest first so "Sarah Jenkins" wins over "Sarah". */
function buildMatcher(entries: CodebookEntry[]): RegExp | null {
  const reals = [...new Set(entries.map((e) => e.real))].sort((a, b) => b.length - a.length);
  if (!reals.length) return null;
  const body = reals.map((r) => escapeRe(r).replace(/\\? /g, "\\s+")).join("|");
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${body})(?![\\p{L}\\p{N}])`, "giu");
}

/** Entries that must be replaced under the policy. With `interviewId`, people from other interviews are left out. */
export function activeEntries(codebook: CodebookEntry[], policy: Policy, interviewId?: string): CodebookEntry[] {
  return codebook.filter(
    (e) =>
      e.enabled &&
      (policy.redact.includes(e.type) || e.source === "manual") &&
      (interviewId === undefined || e.type !== "PERSON" || e.origin === interviewId),
  );
}

/** Replace every active codebook string with its token. Returns the cloud-safe text and the spans (raw offsets). */
export function applyCodebook(
  text: string,
  codebook: CodebookEntry[],
  policy: Policy,
  interviewId?: string,
): { redacted: string; spans: Span[] } {
  const active = activeEntries(codebook, policy, interviewId);
  const re = buildMatcher(active);
  if (!re) return { redacted: text, spans: [] };
  const lookup = new Map(active.map((e) => [norm(e.real), e]));
  const spans: Span[] = [];
  let redacted = "";
  let last = 0;
  for (const m of text.matchAll(re)) {
    const e = lookup.get(norm(m[0]));
    if (!e) continue;
    // Names are case-sensitive: "Mark" the colleague, not "mark" the verb; "Dev" the person, not "dev".
    if (e.type === "PERSON" && m[0][0] !== e.real[0]) continue;
    const start = m.index!;
    spans.push({ start, end: start + m[0].length, token: e.token, type: e.type });
    redacted += text.slice(last, start) + e.token;
    last = start + m[0].length;
  }
  redacted += text.slice(last);
  return { redacted, spans };
}

/**
 * Put real values back into model output, on this device only.
 * A token can map to several real strings ("Sarah", "Sarah Jenkins"); the longest is shown.
 */
export function rehydrate(text: string, codebook: CodebookEntry[]): string {
  const best = new Map<string, string>();
  for (const e of codebook) {
    const cur = best.get(e.token);
    if (!cur || e.real.length > cur.length) best.set(e.token, e.real);
  }
  return text.replace(/\[[A-Z]+_\d+\]/g, (t) => best.get(t) ?? t);
}

export function realFor(token: string, codebook: CodebookEntry[]): string | undefined {
  let out: string | undefined;
  for (const e of codebook) if (e.token === token && (!out || e.real.length > out.length)) out = e.real;
  return out;
}

/**
 * Merge one placeholder into another ("St Jude's" and "the hospital" are the same place).
 * Every entry with `from` becomes `to`, taking the target's type so colours and policy stay consistent.
 */
export function mergeTokens(codebook: CodebookEntry[], from: string, to: string): CodebookEntry[] {
  const target = codebook.find((e) => e.token === to);
  if (!target || from === to) return codebook;
  return codebook.map((e) => (e.token === from ? { ...e, token: to, type: target.type } : e));
}
