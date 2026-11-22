import { activeEntries, isGeneric, norm } from "./codebook";
import { findPatterns } from "./patterns";
import type { CodebookEntry, Policy } from "./types";

export interface GuardFinding {
  text: string;
  reason: "codebook" | "pattern";
}

export interface GuardResult {
  ok: boolean;
  findings: GuardFinding[];
  bytes: number;
}

/**
 * The airlock. Runs on every payload right before it is handed to a cloud model.
 * It does not trust the redaction step: it re-scans the outgoing text for
 *  1) any real value in the study codebook that the policy says must be replaced, and
 *  2) any fixed-shape identifier (email, phone, postcode, reference number) — even one no
 *     detector reported, unless the reviewer explicitly switched that exact string off.
 * If anything matches, the request is blocked. Fail closed.
 */
export function guardPayload(payload: string, codebook: CodebookEntry[], policy: Policy, interviewId?: string): GuardResult {
  const findings: GuardFinding[] = [];
  const allowed = new Set(codebook.filter((e) => !e.enabled).map((e) => norm(e.real)));
  const hay = payload.toLowerCase();
  for (const e of activeEntries(codebook, policy, interviewId)) {
    const real = norm(e.real);
    if (real.length < 3 || !hay.includes(real)) continue;
    // Single-word names are matched case-sensitively ("Mark" vs the verb "mark"); full names are not.
    const isName = e.type === "PERSON" && !real.includes(" ");
    const body = (isName ? e.real.trim() : real).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, isName ? "u" : "iu");
    if (re.test(payload)) findings.push({ text: e.real, reason: "codebook" });
  }
  for (const p of findPatterns(payload)) {
    if (allowed.has(norm(p.text))) continue;
    // Only fixed-shape identifiers are re-checked here. Amounts are often research data, and the fuzzy
    // detectors (institution names, ages) would block ordinary capitalised phrases like a title.
    if (p.type === "FINANCIAL" || p.type === "ORG" || p.type === "QUASI") continue;
    findings.push({ text: p.text, reason: "pattern" });
  }
  return { ok: findings.length === 0, findings, bytes: new TextEncoder().encode(payload).length };
}

/** Guard a multi-interview payload section by section, so each interview's people are checked in their own scope. */
export function guardSections(
  sections: { interviewId: string; text: string }[],
  codebook: CodebookEntry[],
  policy: Policy,
): GuardResult {
  const all = sections.map((s) => guardPayload(s.text, codebook, policy, s.interviewId));
  const seen = new Set<string>();
  const findings = all.flatMap((r) => r.findings).filter((f) => !seen.has(f.text) && (seen.add(f.text), true));
  return { ok: findings.length === 0, findings, bytes: all.reduce((a, r) => a + r.bytes, 0) };
}

export type Purpose =
  | "pseudonymise"
  | "second-pass"
  | "read-image"
  | "analyse-interview"
  | "synthesise-study"
  | "quick-memo"
  | "airlock-test";

export interface LedgerEntry {
  id: string;
  at: number;
  purpose: Purpose;
  /** Inference mode requested from Firebase AI Logic. */
  mode: "only_on_device" | "only_in_cloud" | "prefer_on_device";
  /** What actually ran, from response.inferenceSource. */
  source?: "on_device" | "in_cloud" | "unknown";
  status: "running" | "ok" | "blocked" | "error";
  bytesIn: number;
  payloadPreview: string;
  guard?: GuardResult;
  ms?: number;
  error?: string;
  /** Interview the call was about (absent for study-level calls). */
  interviewId?: string;
  /** SHA-256 of the full payload handed to the model, for the audit report. */
  sha256?: string;
  /** Replayed from a recorded run (not executed in this browser). */
  recorded?: boolean;
}

export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const LEAD = new Set(["The", "A", "An", "And", "But", "So", "Then", "When", "If", "My", "Our", "Your", "We", "He", "She", "They", "It", "This", "That", "These", "Those", "In", "On", "At", "For", "From", "To", "With", "After", "Before", "Yeah", "Yes", "No", "Well", "Um", "Oh", "Okay", "OK", "Dear", "I", "I'm", "I’m", "Like", "Just", "Because", "Also", "Of", "By", "As", "Or", "Not", "All", "Every", "Some", "Any", "One", "Two", "Three", "First", "Last", "Next", "Section", "Article", "Part", "Date", "Name", "Address", "Re", "Now", "Thought", "Specifically", "Come", "Actually", "Honestly", "Obviously", "Anyway", "Still", "Even", "Maybe", "Sometimes", "I'd", "I've", "I'll", "I’d", "I’ve", "I’ll"]);
const HEADING_WORDS = new Set(["Department", "Ward", "Clinic", "Unit", "Team", "Office", "Court", "Government", "Convention", "Protocol", "Act", "Article", "Section", "Statement", "Summary", "Details", "Report", "Plan", "Review", "Meeting", "Hearing", "Outcome", "Background", "History", "Medication", "Medications", "Diagnosis", "Investigations", "Follow", "Discharge", "Admission"]);

/**
 * A second, independent net that doesn't depend on the model: name-like phrases still in the outgoing text
 * (two or more capitalised words mid-text, e.g. "Keith Holloway", "Northgate Home") that no detector flagged
 * and the reviewer didn't keep. Shown as "worth a look" warnings; never sends anything and never blocks.
 */
export function nameLike(payload: string, codebook: CodebookEntry[] = []): string[] {
  const kept = new Set(codebook.filter((e) => !e.enabled).map((e) => norm(e.real)));
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /(?<![\p{L}\p{N}\[_])(?:[A-Z][a-z'’-]+|[A-Z]['’][A-Z][a-z]+)(?:[ \t]+(?:[A-Z][a-z'’-]+|[A-Z]['’][A-Z][a-z]+|&)){1,3}(?![\p{L}\p{N}])/gu;
  for (const m of payload.matchAll(re)) {
    // Field labels ("Hospital Number:", "Job Title:") are form structure, not identifiers.
    if (/^[ \t]*(?:\/[^:\n]{0,40}|\([^)\n]{0,60}\))?[ \t]*:/.test(payload.slice(m.index! + m[0].length))) continue;
    let words = m[0].split(/[ \t]+/);
    while (words.length && (LEAD.has(words[0]) || words[0] === "&")) words = words.slice(1);
    while (words.length && (words[words.length - 1] === "&" || LEAD.has(words[words.length - 1]))) words = words.slice(0, -1);
    if (words.length < 2) continue;
    if (words.every((w) => HEADING_WORDS.has(w) || isGeneric(w))) continue;
    const text = words.join(" ");
    const n = norm(text);
    if (isGeneric(text) || kept.has(n) || seen.has(n)) continue;
    seen.add(n);
    out.push(text);
  }
  return out;
}
