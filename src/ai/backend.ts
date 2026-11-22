import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
  Schema,
  type GenerativeModel,
  type Part,
} from "firebase/ai";
import { firebaseApp } from "../firebase";
import type { Entity, EntityType } from "../core/types";
import { ENTITY_TYPES } from "../core/types";
import {
  redactPrompt,
  secondPassPrompt,
  ANALYST_SYSTEM,
  ENTITY_JSON_SCHEMA,
  IMAGE_JSON_SCHEMA,
  IMAGE_SYSTEM,
  MEMO_SYSTEM,
  REDACTOR_SYSTEM,
  SECOND_PASS_SYSTEM,
  SYNTH_SYSTEM,
} from "./prompts";

/** Where inference ran, as reported by the SDK's `response.inferenceSource`. "unknown" if the SDK didn't say. */
export type Source = "on_device" | "in_cloud" | "unknown";
const src = (v: unknown): Source => (v === "on_device" || v === "in_cloud" ? v : "unknown");
export interface AiResult<T> {
  data: T;
  source: Source;
}

export interface Analysis {
  summary: string;
  participant_context: string;
  themes: { name: string; description: string; quotes: { quote: string; timestamp?: string }[] }[];
  tensions: string[];
  follow_up_questions: string[];
}

export interface Synthesis {
  overview: string;
  themes: { name: string; description: string; interviews: string[]; quotes: { quote: string; interview: string }[] }[];
  divergences: string[];
  implications: string[];
}

export type DeviceStatus = "unknown" | "unavailable" | "downloadable" | "downloading" | "available";

/** Everything the app asks a model to do. One implementation talks to Firebase AI Logic; tests use a fake. */
export interface AiBackend {
  deviceStatus(): Promise<DeviceStatus>;
  /** Availability of the multimodal (text + image) on-device model, for reading photos of notes. */
  imageStatus(): Promise<DeviceStatus>;
  /** Must be called from a user gesture (Chrome's user-activation rule). */
  prepareDevice(onProgress: (p: number) => void): Promise<void>;
  findIdentifiers(chunk: string): Promise<AiResult<Entity[]>>;
  findResidual(chunk: string): Promise<AiResult<Entity[]>>;
  readImage(file: File): Promise<AiResult<{ transcript: string; entities: Entity[] }>>;
  analyseInterview(prompt: string): Promise<AiResult<Analysis>>;
  synthesise(prompt: string): Promise<AiResult<Synthesis>>;
  memo(prompt: string, onText: (t: string) => void): Promise<AiResult<string>>;
}

function cleanEntities(raw: unknown): Entity[] {
  const list = (raw as { entities?: unknown[] })?.entities;
  if (!Array.isArray(list)) return [];
  const out: Entity[] = [];
  for (const it of list) {
    const e = it as { text?: unknown; type?: unknown };
    if (typeof e.text !== "string" || typeof e.type !== "string") continue;
    const type = e.type.toUpperCase() as EntityType;
    if (!ENTITY_TYPES.includes(type)) continue;
    out.push({ text: e.text, type, source: "nano" });
  }
  return out;
}

function parseJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  return JSON.parse(t);
}

/** Small models sometimes stop mid-JSON. Recover the complete {"text","type"} objects that did arrive. */
function salvageEntities(text: string): unknown {
  const out: { text: string; type: string }[] = [];
  // Any complete {...} object without nested braces; key order and type case don't matter.
  for (const m of text.matchAll(/\{[^{}]*\}/g)) {
    try {
      const o = JSON.parse(m[0]) as { text?: unknown; type?: unknown };
      if (typeof o.text === "string" && typeof o.type === "string") out.push({ text: o.text, type: o.type });
    } catch {
      /* incomplete object */
    }
  }
  return { entities: out };
}

/** Parse the entity list; `truncated` is true when the JSON was cut off and only complete items were salvaged. */
export function parseEntities(text: string): { entities: Entity[]; truncated: boolean } {
  try {
    return { entities: cleanEntities(parseJson(text)), truncated: false };
  } catch {
    return { entities: cleanEntities(salvageEntities(text)), truncated: true };
  }
}

const onDeviceText = (system: string, schema: object) => ({
  mode: InferenceMode.ONLY_ON_DEVICE,
  onDeviceParams: {
    createOptions: {
      expectedInputs: [{ type: "text" as const, languages: ["en"] }],
      expectedOutputs: [{ type: "text" as const, languages: ["en"] }],
      initialPrompts: [{ role: "system" as const, content: [{ type: "text" as const, value: system }] }],
    },
    promptOptions: { responseConstraint: schema },
  },
});

const analysisSchema = Schema.object({
  properties: {
    summary: Schema.string(),
    participant_context: Schema.string(),
    themes: Schema.array({
      items: Schema.object({
        properties: {
          name: Schema.string(),
          description: Schema.string(),
          quotes: Schema.array({
            items: Schema.object({ properties: { quote: Schema.string(), timestamp: Schema.string() }, optionalProperties: ["timestamp"] }),
          }),
        },
      }),
    }),
    tensions: Schema.array({ items: Schema.string() }),
    follow_up_questions: Schema.array({ items: Schema.string() }),
  },
});

const synthesisSchema = Schema.object({
  properties: {
    overview: Schema.string(),
    themes: Schema.array({
      items: Schema.object({
        properties: {
          name: Schema.string(),
          description: Schema.string(),
          interviews: Schema.array({ items: Schema.string() }),
          quotes: Schema.array({
            items: Schema.object({ properties: { quote: Schema.string(), interview: Schema.string() } }),
          }),
        },
      }),
    }),
    divergences: Schema.array({ items: Schema.string() }),
    implications: Schema.array({ items: Schema.string() }),
  },
});

/**
 * Firebase AI Logic, three ways:
 *  - ONLY_ON_DEVICE for anything that touches raw, identifiable text. If Gemini Nano is not
 *    available the call throws — Veil never "falls back" to the cloud with raw data.
 *  - ONLY_IN_CLOUD for long-context analysis of text that already passed the airlock.
 *  - PREFER_ON_DEVICE for light tasks on pseudonymised text: free and offline when Nano is
 *    there, cloud otherwise. Safe to fall back because the input is already pseudonymised.
 */
export class FirebaseBackend implements AiBackend {
  private redactor: GenerativeModel;
  private checker: GenerativeModel;
  private imageReader: GenerativeModel;
  private analyst: GenerativeModel[];
  private synthesiser: GenerativeModel[];
  private memoWriter: GenerativeModel;

  constructor(cloudModel: string) {
    const ai = getAI(firebaseApp(), { backend: new GoogleAIBackend() });
    this.redactor = getGenerativeModel(ai, onDeviceText(REDACTOR_SYSTEM, ENTITY_JSON_SCHEMA));
    this.checker = getGenerativeModel(ai, onDeviceText(SECOND_PASS_SYSTEM, ENTITY_JSON_SCHEMA));
    this.imageReader = getGenerativeModel(ai, {
      mode: InferenceMode.ONLY_ON_DEVICE,
      onDeviceParams: {
        createOptions: {
          expectedInputs: [{ type: "text", languages: ["en"] }, { type: "image" }],
          expectedOutputs: [{ type: "text", languages: ["en"] }],
          initialPrompts: [{ role: "system", content: [{ type: "text", value: IMAGE_SYSTEM }] }],
        },
        promptOptions: { responseConstraint: IMAGE_JSON_SCHEMA },
      },
    });
    const cloud = (system: string, schema: Schema, model = cloudModel) => ({
      mode: InferenceMode.ONLY_IN_CLOUD,
      inCloudParams: {
        model,
        systemInstruction: system,
        // A modest thinking budget keeps time-to-first-token short; the analysis prompt is well structured.
        generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0.4, thinkingConfig: { thinkingBudget: 1024 } },
      },
    });
    // The configured model first; if it is overloaded, Firebase AI Logic's default cloud model.
    const models = [...new Set([cloudModel, FALLBACK_CLOUD_MODEL])];
    this.analyst = models.map((m) => getGenerativeModel(ai, cloud(ANALYST_SYSTEM, analysisSchema, m)));
    this.synthesiser = models.map((m) => getGenerativeModel(ai, cloud(SYNTH_SYSTEM, synthesisSchema, m)));
    this.memoWriter = getGenerativeModel(ai, {
      mode: InferenceMode.PREFER_ON_DEVICE,
      onDeviceParams: {
        createOptions: {
          expectedInputs: [{ type: "text", languages: ["en"] }],
          expectedOutputs: [{ type: "text", languages: ["en"] }],
          initialPrompts: [{ role: "system", content: [{ type: "text", value: MEMO_SYSTEM }] }],
        },
      },
      inCloudParams: { model: cloudModel, systemInstruction: MEMO_SYSTEM },
    });
  }

  /**
   * Reads Chrome's availability state for the on-device model so the UI can show "ready / downloadable /
   * unavailable" before the user clicks anything. Firebase AI Logic's own check runs inside
   * generateContent(); this read-only probe doesn't create a session or start a download (which Chrome
   * only allows after a user gesture). All inference still goes through Firebase AI Logic.
   */
  async deviceStatus(): Promise<DeviceStatus> {
    return languageModelAvailability([{ type: "text", languages: ["en"] }]);
  }

  async imageStatus(): Promise<DeviceStatus> {
    return languageModelAvailability([{ type: "text", languages: ["en"] }, { type: "image" }]);
  }

  async prepareDevice(onProgress: (p: number) => void): Promise<void> {
    await this.redactor.initializeDeviceModel(onProgress);
    // The other on-device instances share Chrome's downloaded model; initialising them is cheap.
    await Promise.all([
      this.checker.initializeDeviceModel(),
      this.memoWriter.initializeDeviceModel(),
      // Warm the image model too if this browser supports image input, so photos work later even offline.
      this.imageStatus()
        .then((st) => (st !== "unavailable" ? this.imageReader.initializeDeviceModel() : undefined))
        .catch(() => undefined), // image support is optional; never let it break text setup
    ]);
  }

  async findIdentifiers(chunk: string): Promise<AiResult<Entity[]>> {
    const r = await this.redactor.generateContent(redactPrompt(chunk));
    let source = src(r.response.inferenceSource);
    const first = parseEntities(r.response.text());
    let data = first.entities;
    // Reply cut off (or empty on a long chunk): keep what arrived, then re-scan the chunk as two halves
    // (shorter prompts, shorter replies) so identifiers in the lost tail aren't silently dropped.
    if (first.truncated || (!data.length && chunk.length > 1200)) {
      const nl = chunk.lastIndexOf("\n", chunk.length / 2);
      const mid = nl > 0 ? nl : Math.floor(chunk.length / 2);
      for (const h of [chunk.slice(0, mid), chunk.slice(mid)]) {
        const rr = await this.redactor.generateContent(redactPrompt(h));
        data = data.concat(parseEntities(rr.response.text()).entities);
        const s2 = src(rr.response.inferenceSource);
        // Report the least private source seen across the calls (they are all ONLY_ON_DEVICE).
        if (s2 === "in_cloud" || source === "unknown") source = s2;
      }
    }
    return { data, source };
  }

  async findResidual(chunk: string): Promise<AiResult<Entity[]>> {
    const r = await this.checker.generateContent(secondPassPrompt(chunk));
    return { data: parseEntities(r.response.text()).entities, source: src(r.response.inferenceSource) };
  }

  async readImage(file: File): Promise<AiResult<{ transcript: string; entities: Entity[] }>> {
    // Image input needs the multimodal on-device model; check before we try (ONLY_ON_DEVICE would throw).
    if ((await languageModelAvailability([{ type: "text", languages: ["en"] }, { type: "image" }])) === "unavailable")
      throw new Error("Image input isn't available for Gemini Nano in this browser. Enable chrome://flags/#prompt-api-for-gemini-nano-multimodal-input.");
    await this.imageReader.initializeDeviceModel();
    const part = await fileToPart(file);
    const r = await this.imageReader.generateContent(["Transcribe these notes and list identifying spans.", part]);
    const text = r.response.text();
    let transcript = "";
    let entities: Entity[] = [];
    try {
      const d = parseJson(text) as { transcript?: string };
      transcript = String(d.transcript ?? "");
      entities = cleanEntities(d);
    } catch {
      // Cut off mid-JSON: keep whatever transcript text and complete entities arrived.
      const m = text.match(/"transcript"\s*:\s*"((?:[^"\\]|\\.)*)/);
      try {
        transcript = m ? JSON.parse(`"${m[1]}"`) : "";
      } catch {
        transcript = m ? m[1].replace(/\\n/g, "\n") : "";
      }
      entities = parseEntities(text).entities;
    }
    if (!transcript) throw new Error("Gemini Nano couldn't read text from this photo. Try a sharper, closer shot.");
    return { data: { transcript, entities }, source: src(r.response.inferenceSource) };
  }

  async analyseInterview(prompt: string): Promise<AiResult<Analysis>> {
    return cloudWithFallback(this.analyst, prompt, normaliseAnalysis);
  }

  async synthesise(prompt: string): Promise<AiResult<Synthesis>> {
    return cloudWithFallback(this.synthesiser, prompt, normaliseSynthesis);
  }

  async memo(prompt: string, onText: (t: string) => void): Promise<AiResult<string>> {
    const r = await this.memoWriter.generateContentStream(prompt);
    let text = "";
    for await (const c of r.stream) {
      text += c.text();
      onText(text);
    }
    const final = await r.response;
    return { data: text, source: src(final.inferenceSource) };
  }
}

const FALLBACK_CLOUD_MODEL = "gemini-3.5-flash-lite";
const OVERLOADED = /\b(429|500|503)\b|RESOURCE_EXHAUSTED|UNAVAILABLE|overloaded|high demand/i;

async function cloudWithFallback<T>(models: GenerativeModel[], prompt: string, normalise: (x: unknown) => T): Promise<AiResult<T>> {
  let last: unknown;
  for (const m of models) {
    try {
      return await cloudJson(m, prompt, normalise);
    } catch (e) {
      last = e;
      if (!OVERLOADED.test(String(e))) throw e;
    }
  }
  throw last;
}

/** Retry rate-limit / overload errors (429, 500 "high demand", 503) with exponential backoff; anything else fails at once. */
async function withBackoff<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries - 1 || !OVERLOADED.test(String(e))) throw e;
      await new Promise((r) => setTimeout(r, 1500 * 2 ** i + Math.random() * 500));
    }
  }
}

/** Cloud call expecting JSON: one retry on unparseable output, then a clear error. Shapes are normalised. */
async function cloudJson<T>(model: GenerativeModel, prompt: string, normalise: (x: unknown) => T): Promise<AiResult<T>> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    // Stream, so bytes keep flowing on long analyses (some proxies drop connections that are silent for ~30 s).
    const r = await withBackoff(() => model.generateContentStream(prompt));
    let text = "";
    for await (const c of r.stream) text += c.text();
    const final = await r.response;
    try {
      return { data: normalise(parseJson(text)), source: src(final.inferenceSource) };
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`The cloud model returned malformed JSON twice (${String(lastErr)}). Try again.`);
}

const str = (x: unknown) => (typeof x === "string" ? x : "");
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const strs = (x: unknown) => arr(x).map(str).filter(Boolean);

export function normaliseAnalysis(x: unknown): Analysis {
  const o = (x ?? {}) as Record<string, unknown>;
  return {
    summary: str(o.summary),
    participant_context: str(o.participant_context),
    themes: arr(o.themes).map((t) => {
      const tt = (t ?? {}) as Record<string, unknown>;
      return {
        name: str(tt.name),
        description: str(tt.description),
        quotes: arr(tt.quotes).map((q) => ({ quote: str((q as Record<string, unknown>)?.quote), timestamp: str((q as Record<string, unknown>)?.timestamp) || undefined })),
      };
    }),
    tensions: strs(o.tensions),
    follow_up_questions: strs(o.follow_up_questions),
  };
}

export function normaliseSynthesis(x: unknown): Synthesis {
  const o = (x ?? {}) as Record<string, unknown>;
  return {
    overview: str(o.overview),
    themes: arr(o.themes).map((t) => {
      const tt = (t ?? {}) as Record<string, unknown>;
      return {
        name: str(tt.name),
        description: str(tt.description),
        interviews: strs(tt.interviews),
        quotes: arr(tt.quotes).map((q) => ({ quote: str((q as Record<string, unknown>)?.quote), interview: str((q as Record<string, unknown>)?.interview) })),
      };
    }),
    divergences: strs(o.divergences),
    implications: strs(o.implications),
  };
}

async function languageModelAvailability(expectedInputs: object[]): Promise<DeviceStatus> {
  const LM = (globalThis as unknown as { LanguageModel?: { availability(o?: object): Promise<string> } }).LanguageModel;
  if (!LM) return "unavailable";
  try {
    const a = await LM.availability({ expectedInputs, expectedOutputs: [{ type: "text", languages: ["en"] }] });
    return (["unavailable", "downloadable", "downloading", "available"].includes(a) ? a : "unknown") as DeviceStatus;
  } catch {
    return "unavailable";
  }
}

/**
 * Photos from phones can be huge or in formats the on-device model rejects. Re-encode on a canvas
 * as JPEG, longest side ≤ 1536 px, before handing it to Gemini Nano. Stays in memory on this device.
 */
async function fileToPart(file: File): Promise<Part> {
  let blob: Blob = file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1536 / Math.max(bmp.width, bmp.height));
    const canvas = new OffscreenCanvas(Math.round(bmp.width * scale), Math.round(bmp.height * scale));
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
  } catch {
    if (!/^image\/(png|jpeg)$/.test(file.type)) throw new Error("Use a PNG or JPEG photo.");
  }
  const data = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(",")[1] ?? "");
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
  return { type: "inlineData", inlineData: { data, mimeType: blob.type || "image/jpeg" } } as Part;
}
