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
  ANALYST_SYSTEM,
  ENTITY_JSON_SCHEMA,
  IMAGE_JSON_SCHEMA,
  IMAGE_SYSTEM,
  MEMO_SYSTEM,
  REDACTOR_SYSTEM,
  SECOND_PASS_SYSTEM,
  SYNTH_SYSTEM,
} from "./prompts";

export type Source = "on_device" | "in_cloud";
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
  private analyst: GenerativeModel;
  private synthesiser: GenerativeModel;
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
    const cloud = (system: string, schema: Schema) => ({
      mode: InferenceMode.ONLY_IN_CLOUD,
      inCloudParams: {
        model: cloudModel,
        systemInstruction: system,
        generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0.4 },
      },
    });
    this.analyst = getGenerativeModel(ai, cloud(ANALYST_SYSTEM, analysisSchema));
    this.synthesiser = getGenerativeModel(ai, cloud(SYNTH_SYSTEM, synthesisSchema));
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

  async deviceStatus(): Promise<DeviceStatus> {
    const LM = (globalThis as unknown as { LanguageModel?: { availability(o?: object): Promise<string> } }).LanguageModel;
    if (!LM) return "unavailable";
    try {
      const a = await LM.availability({
        expectedInputs: [{ type: "text", languages: ["en"] }],
        expectedOutputs: [{ type: "text", languages: ["en"] }],
      });
      return (["unavailable", "downloadable", "downloading", "available"].includes(a) ? a : "unknown") as DeviceStatus;
    } catch {
      return "unavailable";
    }
  }

  async prepareDevice(onProgress: (p: number) => void): Promise<void> {
    await this.redactor.initializeDeviceModel(onProgress);
    // The other on-device instances share Chrome's downloaded model; initialising them is cheap.
    await Promise.all([
      this.checker.initializeDeviceModel(),
      this.memoWriter.initializeDeviceModel(),
    ]);
  }

  async findIdentifiers(chunk: string): Promise<AiResult<Entity[]>> {
    const { redactPrompt } = await import("./prompts");
    const r = await this.redactor.generateContent(redactPrompt(chunk));
    return { data: cleanEntities(parseJson(r.response.text())), source: (r.response.inferenceSource ?? "on_device") as Source };
  }

  async findResidual(chunk: string): Promise<AiResult<Entity[]>> {
    const { secondPassPrompt } = await import("./prompts");
    const r = await this.checker.generateContent(secondPassPrompt(chunk));
    return { data: cleanEntities(parseJson(r.response.text())), source: (r.response.inferenceSource ?? "on_device") as Source };
  }

  async readImage(file: File): Promise<AiResult<{ transcript: string; entities: Entity[] }>> {
    await this.imageReader.initializeDeviceModel();
    const part = await fileToPart(file);
    const r = await this.imageReader.generateContent(["Transcribe these notes and list identifying spans.", part]);
    const d = parseJson(r.response.text()) as { transcript?: string };
    return {
      data: { transcript: String(d.transcript ?? ""), entities: cleanEntities(d) },
      source: (r.response.inferenceSource ?? "on_device") as Source,
    };
  }

  async analyseInterview(prompt: string): Promise<AiResult<Analysis>> {
    const r = await this.analyst.generateContent(prompt);
    return { data: parseJson(r.response.text()) as Analysis, source: (r.response.inferenceSource ?? "in_cloud") as Source };
  }

  async synthesise(prompt: string): Promise<AiResult<Synthesis>> {
    const r = await this.synthesiser.generateContent(prompt);
    return { data: parseJson(r.response.text()) as Synthesis, source: (r.response.inferenceSource ?? "in_cloud") as Source };
  }

  async memo(prompt: string, onText: (t: string) => void): Promise<AiResult<string>> {
    const r = await this.memoWriter.generateContentStream(prompt);
    let text = "";
    for await (const c of r.stream) {
      text += c.text();
      onText(text);
    }
    const final = await r.response;
    return { data: text, source: (final.inferenceSource ?? "in_cloud") as Source };
  }
}

async function fileToPart(file: File): Promise<Part> {
  const data = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(",")[1] ?? "");
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
  return { type: "inlineData", inlineData: { data, mimeType: file.type } } as Part;
}
