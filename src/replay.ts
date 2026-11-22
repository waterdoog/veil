import type { LedgerEntry } from "./core/airlock";
import type { CodebookEntry } from "./core/types";
import type { Study } from "./model";
import { uid } from "./model";
import { sampleStudy, scenariosStudy } from "./sample";

interface RecordedRun {
  /** Which built-in study the detections belong to (older recordings: the sample study). */
  study?: "sample" | "scenarios";
  capturedAt: string;
  browser: string;
  policy: "standard" | "strict";
  codebook: CodebookEntry[];
  calls: { interviewId: string; purpose: LedgerEntry["purpose"]; ms?: number; bytesIn: number; source?: LedgerEntry["source"] }[];
}

const files = import.meta.glob<RecordedRun>("../sample-data/recorded/*.json", { eager: true, import: "default" });
const runs = Object.values(files);
const runFor = (kind: "sample" | "scenarios") => runs.find((r) => (r.study ?? "sample") === kind);

export const hasRecordedRun = Boolean(runFor("sample"));

/**
 * For judges whose browser can't run Gemini Nano: load the sample study with the detections that real
 * Gemini Nano produced on another machine (recorded, clearly labelled). Cloud analysis still runs live.
 */
export function recordedStudy(kind: "sample" | "scenarios" = "sample"): { study: Study; ledger: LedgerEntry[] } | null {
  const recorded = runFor(kind);
  if (!recorded) return null;
  const base = kind === "scenarios" ? scenariosStudy(recorded.policy) : sampleStudy(recorded.policy);
  const study: Study = {
    ...base,
    name: `${kind === "scenarios" ? "Beyond interviews" : "Working with Long COVID (fictional sample)"} — recorded Gemini Nano run`,
    codebook: recorded.codebook,
    interviews: base.interviews.map((i) => ({ ...i, status: "review" as const })),
    replay: { capturedAt: recorded.capturedAt, browser: recorded.browser },
  };
  const ledger: LedgerEntry[] = recorded.calls.map((c, n) => ({
    id: uid(),
    at: Date.parse(recorded.capturedAt) + n * 1000,
    purpose: c.purpose,
    mode: "only_on_device",
    source: c.source ?? "on_device",
    status: "ok",
    bytesIn: c.bytesIn,
    payloadPreview: "(recorded run — raw text stayed on the recording machine)",
    ms: c.ms,
    interviewId: c.interviewId,
    recorded: true,
  }));
  return { study, ledger: ledger.reverse() };
}
