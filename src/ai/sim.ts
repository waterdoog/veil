import type { Entity } from "../core/types";
import { findPatterns } from "../core/patterns";
import type { AiBackend, AiResult, Analysis, DeviceStatus, Synthesis } from "./backend";

/**
 * DEVELOPMENT-ONLY stand-in used by the UI test harness (`npm run dev`, then open `/?sim`).
 * It is excluded from production builds (see main.tsx) and the UI shows a "Simulated" banner.
 * It finds identifiers from the sample answer key and deliberately misses some, so the
 * review/airlock flows can be exercised without Chrome's on-device model.
 */
export class SimBackend implements AiBackend {
  constructor(private answerKey: { text: string; type: Entity["type"] }[]) {}
  private status: DeviceStatus = "downloadable";
  async deviceStatus() {
    return this.status;
  }
  async imageStatus() {
    return this.status;
  }
  async prepareDevice(onProgress: (p: number) => void) {
    for (let i = 1; i <= 10; i++) {
      await sleep(80);
      onProgress(i / 10);
    }
    this.status = "available";
  }
  async findIdentifiers(chunk: string): Promise<AiResult<Entity[]>> {
    await sleep(250);
    const hits = this.answerKey.filter((k, i) => chunk.includes(k.text) && i % 7 !== 3);
    return { data: hits.map((h) => ({ ...h, source: "nano" as const })), source: "on_device" };
  }
  async findResidual(chunk: string): Promise<AiResult<Entity[]>> {
    await sleep(150);
    const hits = this.answerKey.filter((k) => chunk.includes(k.text) && k.type === "PERSON");
    return { data: hits.map((h) => ({ ...h, source: "nano" as const })), source: "on_device" };
  }
  async readImage(): Promise<AiResult<{ transcript: string; entities: Entity[] }>> {
    await sleep(400);
    const transcript = "Field note 3 Mar — met R. Adeyemi at Hollins Lane library, she asked us to call 07700 900123.";
    return {
      data: { transcript, entities: [{ text: "R. Adeyemi", type: "PERSON", source: "nano" }, { text: "Hollins Lane library", type: "LOCATION", source: "nano" }, ...findPatterns(transcript)] },
      source: "on_device",
    };
  }
  async analyseInterview(prompt: string): Promise<AiResult<Analysis>> {
    await sleep(700);
    const quote = (prompt.match(/P: ([^\n]{40,160})/) ?? [, "…"])[1]!;
    return {
      data: {
        summary: "Simulated analysis. The participant describes negotiating a phased return with [ORG_1] while managing fatigue.",
        participant_context: "Simulated context mentioning [PERSON_1].",
        themes: [
          { name: "Invisible effort", description: "Simulated theme.", quotes: [{ quote, timestamp: "00:01:12" }] },
          { name: "Disclosure as risk", description: "Simulated theme.", quotes: [{ quote: "[PERSON_2] said it was fine, but…" }] },
        ],
        tensions: ["Simulated tension."],
        follow_up_questions: ["Simulated follow-up?"],
      },
      source: "in_cloud",
    };
  }
  async synthesise(): Promise<AiResult<Synthesis>> {
    await sleep(900);
    return {
      data: {
        overview: "Simulated cross-case synthesis.",
        themes: [{ name: "Simulated theme", description: "…", interviews: ["p01", "p02"], quotes: [{ quote: "…", interview: "p01" }] }],
        divergences: ["Simulated divergence."],
        implications: ["Simulated implication."],
      },
      source: "in_cloud",
    };
  }
  async memo(_p: string, onText: (t: string) => void): Promise<AiResult<string>> {
    const out = "• Simulated memo line one.\n• Emerging code: simulated.\n• Follow up: simulated?";
    for (let i = 0; i < out.length; i += 6) {
      await sleep(20);
      onText(out.slice(0, i + 6));
    }
    return { data: out, source: this.status === "available" ? "on_device" : "in_cloud" };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
