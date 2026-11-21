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

/** Six entirely fictional interviews (generated for testing) with an answer key of every identifier. */
export function sampleInterviews(): Interview[] {
  return Object.values(files)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((f) => ({
      id: f.id,
      title: f.title,
      raw: f.transcript,
      truth: f.identifiers,
      status: "raw" as const,
    }));
}

export function sampleStudy(policy: PolicyName): Study {
  return {
    id: uid(),
    name: "Working with Long COVID (fictional sample)",
    policy,
    codebook: [],
    interviews: sampleInterviews(),
  };
}

export function allAnswerKeys() {
  return Object.values(files).flatMap((f) => f.identifiers);
}
