export const ENTITY_TYPES = [
  "PERSON",
  "ORG",
  "LOCATION",
  "DATE",
  "CONTACT",
  "ID",
  "HEALTH",
  "FINANCIAL",
  "QUASI",
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

/** Where a detection came from. Only "nano" uses a model; the rest are deterministic or human. */
export type EntitySource = "nano" | "pattern" | "manual";

export interface Entity {
  text: string;
  type: EntityType;
  source: EntitySource;
}

export interface CodebookEntry {
  /** The original string as it appears in the raw transcript. Never leaves the device. */
  real: string;
  /** Replacement placed in text that is allowed to leave the device, e.g. "[PERSON_3]". */
  token: string;
  type: EntityType;
  source: EntitySource;
  /** Reviewer can switch a detection off (false positive) without deleting it. */
  enabled: boolean;
  /** Interview where this string was first seen. First-name linking only happens within one interview. */
  origin?: string;
}

export type PolicyName = "strict" | "standard";

export interface Policy {
  name: PolicyName;
  label: string;
  /** Entity types replaced automatically. */
  redact: EntityType[];
  /** Run a second on-device pass over the redacted text, looking for anything missed. */
  secondPass: boolean;
}

export const POLICIES: Record<PolicyName, Policy> = {
  strict: {
    name: "strict",
    label: "Strict — every identifier and quasi-identifier, plus a second on-device check",
    redact: ["PERSON", "ORG", "LOCATION", "DATE", "CONTACT", "ID", "FINANCIAL", "QUASI", "HEALTH"],
    secondPass: true,
  },
  standard: {
    name: "standard",
    label: "Standard — direct identifiers; keeps health details, which are the research data",
    redact: ["PERSON", "ORG", "LOCATION", "DATE", "CONTACT", "ID", "FINANCIAL", "QUASI"],
    secondPass: false,
  },
};

export interface Span {
  start: number;
  end: number;
  token: string;
  type: EntityType;
}
