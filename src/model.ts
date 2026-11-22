import type { Analysis, Source, Synthesis } from "./ai/backend";
import type { GroundTruth } from "./core/evaluate";
import type { CodebookEntry, Entity, PolicyName } from "./core/types";

export type InterviewStatus = "raw" | "pseudonymising" | "review" | "queued" | "analysing" | "analysed" | "blocked";

export interface Interview {
  id: string;
  title: string;
  /** Identifiable text. Stays in IndexedDB on this device. */
  raw: string;
  /** Answer key, only for the bundled fictional sample interviews. */
  truth?: GroundTruth[];
  status: InterviewStatus;
  progress?: { done: number; total: number; stage: string };
  residual?: Entity[];
  analysis?: Analysis;
  analysisSource?: Source;
  memo?: string;
  memoSource?: Source;
  blockedBy?: string[];
  error?: string;
  deviceMissing?: boolean;
  /** Set when the researcher confirms a manual review (required for release when Nano was unavailable). */
  attested?: boolean;
}

/** May this interview's pseudonymised text be sent to a cloud model? */
export function releasable(iv: Interview): boolean {
  return iv.status !== "raw" && iv.status !== "pseudonymising" && (!iv.deviceMissing || iv.attested === true);
}

export interface Study {
  id: string;
  name: string;
  policy: PolicyName;
  codebook: CodebookEntry[];
  interviews: Interview[];
  /** What the study is asking. Steers cloud analysis; goes through the codebook + airlock like everything else. */
  researchQuestions?: string;
  synthesis?: Synthesis;
  synthesisSource?: Source;
  synthStatus?: "idle" | "running" | "done" | "blocked" | "error";
  synthError?: string;
  /** Set when the detections come from a recorded Gemini Nano run rather than this browser. */
  replay?: { capturedAt: string; browser: string };
}

export const uid = () => Math.random().toString(36).slice(2, 10);

export function emptyStudy(policy: PolicyName = "standard"): Study {
  return { id: uid(), name: "Untitled study", policy, codebook: [], interviews: [] };
}
