import type { Interview, Study } from "./model";
import { uid } from "./model";
import type { PolicyName } from "./core/types";
import type { GroundTruth } from "./core/evaluate";

interface SampleFile {
  id: string;
  title: string;
  transcript: string;
  identifiers: GroundTruth[];
}

const files = import.meta.glob<SampleFile>("../sample-data/*.json", { eager: true, import: "default" });
/** Four more fictional interviews (US/UK/Ireland, non-health topics) that were never used to tune Veil. */
const holdout = import.meta.glob<SampleFile>("../sample-data/holdout/*.json", { eager: true, import: "default" });
/** Eight short European Court of Human Rights judgments from the public Text Anonymization Benchmark (MIT). */
const tab = import.meta.glob<SampleFile>("../sample-data/tab/*.json", { eager: true, import: "default" });

function toInterviews(set: Record<string, SampleFile>): Interview[] {
  return Object.values(set)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((f) => ({
      id: f.id,
      title: f.title,
      raw: f.transcript,
      truth: f.identifiers,
      status: "raw" as const,
    }));
}

/** Six entirely fictional interviews (generated for testing) with an answer key of every identifier. */
export function sampleInterviews(): Interview[] {
  return toInterviews(files);
}

export function holdoutStudy(policy: PolicyName): Study {
  return {
    id: uid(),
    name: "Held-out evaluation set (fictional, never used for tuning)",
    policy,
    codebook: [],
    interviews: toInterviews(holdout),
  };
}

export function sampleStudy(policy: PolicyName): Study {
  return {
    id: uid(),
    name: "Working with Long COVID (fictional sample)",
    researchQuestions:
      "1. How do people with Long COVID decide whether and how to disclose it at work?\n2. Which workplace adjustments help, and which fail?\n3. How does the condition change their sense of work identity and financial security?",
    policy,
    codebook: [],
    interviews: sampleInterviews(),
  };
}

export function tabStudy(policy: PolicyName): Study {
  return {
    id: uid(),
    name: "Public benchmark: TAB (8 ECHR judgments, real public court texts)",
    policy,
    codebook: [],
    interviews: toInterviews(tab),
  };
}

const evalSets: Record<string, Record<string, SampleFile>> = {
  "tab-dev": import.meta.glob<SampleFile>("../sample-data/tab-dev/*.json", { eager: true, import: "default" }),
  "tab-test2": import.meta.glob<SampleFile>("../sample-data/tab-test2/*.json", { eager: true, import: "default" }),
};

/** Evaluation-only sets, opened with ?load=<name> (not shown in the UI). */
export function evalStudy(name: string, policy: PolicyName): Study | null {
  const set = evalSets[name];
  if (!set) return null;
  return { id: uid(), name: `Evaluation set: ${name}`, policy, codebook: [], interviews: toInterviews(set) };
}

export function allAnswerKeys() {
  return [...Object.values(files), ...Object.values(holdout)].flatMap((f) => f.identifiers);
}
