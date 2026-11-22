import { activeEntries, norm } from "./codebook";
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
