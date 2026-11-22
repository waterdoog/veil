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

/** Beyond interviews: a court judgment (real, public, TAB), an HR file and a discharge summary (both fictional). */
const scenarios = import.meta.glob<SampleFile>("../sample-data/scenarios/*.json", { eager: true, import: "default" });

export function scenariosStudy(policy: PolicyName): Study {
  const order = ["s-legal", "s-hr", "s-clin"];
  const ivs = toInterviews(scenarios).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  return { id: uid(), name: "Beyond interviews: court judgment, HR file, discharge summary", policy, codebook: [], interviews: ivs };
}

const evalSets: Record<string, Record<string, SampleFile>> = {
  "tab-dev": import.meta.glob<SampleFile>("../sample-data/tab-dev/*.json", { eager: true, import: "default" }),
  "tab-test2": import.meta.glob<SampleFile>("../sample-data/tab-test2/*.json", { eager: true, import: "default" }),
  // Unseen HR + clinical documents, generated after the scenario fixes, to check they generalise.
  "scenarios-unseen": import.meta.glob<SampleFile>("../sample-data/scenarios-unseen/*.json", { eager: true, import: "default" }),
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

/** One page of the first sample interview — for watching live on-device pseudonymisation finish in seconds. */
export function quickStudy(policy: PolicyName): Study {
  const p01 = Object.values(files).find((f) => f.id === "p01")!;
  const cut = p01.transcript.indexOf("\n[00:01:58]");
  const raw = cut > 0 ? p01.transcript.slice(0, cut) : p01.transcript.slice(0, 1600);
  return {
    id: uid(),
    name: "Quick live test — one page of a fictional interview",
    policy,
    codebook: [],
    interviews: [{ id: "q01", title: "Primary school teacher — first page", raw, truth: p01.identifiers.filter((i) => raw.includes(i.text)), status: "raw" }],
  };
}
