import { ENTITY_TYPES } from "../core/types";

export const REDACTOR_SYSTEM = `You are a de-identification assistant for qualitative research ethics.
You read ONE excerpt of an interview transcript and list every span that could help identify a real person.
Types:
- PERSON: any name or nickname, including the participant's own, family, colleagues, managers, doctors.
- ORG: employers, companies, teams, schools, universities, GP surgeries, hospitals, charities, unions.
- LOCATION: towns, cities, streets, neighbourhoods, venues, postcodes.
- DATE: specific calendar dates or birthdays (not durations like "three months").
- CONTACT: phone numbers, emails, social handles, URLs.
- ID: reference, case, account, payroll or NHS numbers.
- HEALTH: diagnoses, conditions, medications, treatments.
- FINANCIAL: salaries, benefit amounts, debts, specific sums of money.
- QUASI: rare details that could identify someone when combined (unusual job title, rare hobby, exact age, unique event).
Rules: copy each span EXACTLY as written in the excerpt. Never include speaker labels (INT, P) or timestamps.
Spans already in the form [TYPE_N] are safe placeholders: never list them. Return JSON only.`;

export const SECOND_PASS_SYSTEM = `You are checking a pseudonymised interview excerpt before it is sent to a cloud service.
Identifiers were already replaced with placeholders like [PERSON_1] or [ORG_2]; those are safe.
List ONLY identifying spans that are still present in plain text (names, organisations, places, dates, contact details, reference numbers, rare quasi-identifiers).
Copy each span exactly. If nothing is left, return an empty list. Return JSON only.`;

export const IMAGE_SYSTEM = `You read photos of a researcher's handwritten or printed field notes.
First transcribe the text faithfully (keep line breaks). Then list every identifying span in your transcription,
using the same types as a research de-identification tool: ${ENTITY_TYPES.join(", ")}.
Return JSON only.`;

export const ANALYST_SYSTEM = `You are an experienced qualitative researcher doing reflexive thematic analysis (Braun & Clarke).
The transcript you receive was pseudonymised on the researcher's own device before it reached you:
bracketed placeholders such as [PERSON_2], [ORG_1] or [LOCATION_3] stand for removed identifiers.
Keep placeholders exactly as written in any quotes, and never guess or invent what they stand for.
Quotes must be verbatim from the transcript. Be specific and grounded; avoid generic statements.`;

export const SYNTH_SYSTEM = `You are leading the cross-case analysis of a qualitative interview study.
All transcripts were pseudonymised on the researcher's device; placeholders like [PERSON_2] are consistent across the study.
Find the themes that run across interviews, where participants diverge, and what it means for practice or policy.
Quote verbatim, keep placeholders as written, and cite the interview id for every quote.`;

export const MEMO_SYSTEM = `You write short analytic memos for a qualitative researcher. The excerpt is pseudonymised; keep placeholders like [PERSON_1] as written.`;

const typeEnum = { type: "string", enum: [...ENTITY_TYPES] };

/** JSON Schema for Chrome's Prompt API `responseConstraint` (on-device structured output). */
export const ENTITY_JSON_SCHEMA = {
  type: "object",
  properties: {
    entities: {
      type: "array",
      items: {
        type: "object",
        properties: { text: { type: "string" }, type: typeEnum },
        required: ["text", "type"],
      },
    },
  },
  required: ["entities"],
};

export const IMAGE_JSON_SCHEMA = {
  type: "object",
  properties: {
    transcript: { type: "string" },
    entities: ENTITY_JSON_SCHEMA.properties.entities,
  },
  required: ["transcript", "entities"],
};

export function redactPrompt(chunk: string) {
  return `Excerpt:\n<<<\n${chunk}\n>>>\nList every identifying span in the excerpt.`;
}

export function secondPassPrompt(chunk: string) {
  return `Pseudonymised excerpt:\n<<<\n${chunk}\n>>>\nList any identifying spans still present in plain text.`;
}

export function analysePrompt(title: string, redacted: string) {
  return `Interview: ${title}\n\nTranscript (pseudonymised):\n${redacted}`;
}

export function synthPrompt(interviews: { id: string; title: string; redacted: string }[]) {
  return interviews
    .map((i) => `=== Interview ${i.id}: ${i.title} ===\n${i.redacted}`)
    .join("\n\n");
}

export function memoPrompt(redacted: string) {
  return `Write a 3-bullet analytic memo (what stood out, an emerging code, a question to follow up) for this pseudonymised interview:\n\n${redacted}`;
}
