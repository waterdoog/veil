import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AiBackend, DeviceStatus } from "./ai/backend";
import { analysePrompt, memoPrompt, synthPrompt } from "./ai/prompts";
import { guardPayload, guardSections, sha256, type GuardResult, type LedgerEntry, type Purpose } from "./core/airlock";
import { chunkTranscript } from "./core/chunk";
import { applyCodebook, mergeEntities, mergeTokens, norm } from "./core/codebook";
import { extendNames, findPatterns } from "./core/patterns";
import { POLICIES, type Entity, type EntityType, type PolicyName } from "./core/types";
import type { RuntimeConfig } from "./firebase";
import { emptyStudy, releasable, uid, type Interview, type Study } from "./model";
import { sampleStudy } from "./sample";
import { getLocal, setLocal } from "./store/local";
import { saveInterview, saveSynthesis } from "./store/cloud";

const KEY = "study-v1";

export function useVeil(backend: AiBackend | null, cfg: RuntimeConfig, userId: string | null) {
  const [study, setStudy] = useState<Study>(() => emptyStudy(cfg.defaultPolicy));
  const [loaded, setLoaded] = useState(false);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [device, setDevice] = useState<DeviceStatus>("unknown");
  const [downloadPct, setDownloadPct] = useState<number | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const studyRef = useRef(study);
  studyRef.current = study;

  // Raw transcripts + codebook persist in IndexedDB only.
  useEffect(() => {
    getLocal<Study>(KEY).then((s) => {
      if (s) setStudy(s);
      setLoaded(true);
    });
  }, []);
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => setLocal(KEY, study), 300);
    return () => clearTimeout(t);
  }, [study, loaded]);

  useEffect(() => {
    if (!backend) return;
    backend.deviceStatus().then(setDevice);
  }, [backend]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const policy = POLICIES[study.policy];

  const patch = useCallback((id: string, p: Partial<Interview>) => {
    setStudy((s) => ({ ...s, interviews: s.interviews.map((i) => (i.id === id ? { ...i, ...p } : i)) }));
  }, []);

  const log = useCallback((e: Omit<LedgerEntry, "id" | "at" | "status">) => {
    const entry: LedgerEntry = { ...e, id: uid(), at: Date.now(), status: "running" };
    setLedger((l) => [entry, ...l].slice(0, 300));
    const t0 = performance.now();
    return (p: Partial<LedgerEntry>) =>
      setLedger((l) => l.map((x) => (x.id === entry.id ? { ...x, ...p, ms: Math.round(performance.now() - t0) } : x)));
  }, []);

  const addEntities = useCallback((entities: Entity[], origin: string) => {
    setStudy((s) => ({ ...s, codebook: mergeEntities(s.codebook, entities, origin) }));
  }, []);

  const prepareDevice = useCallback(async () => {
    if (!backend) return;
    setDownloadPct(0);
    try {
      await backend.prepareDevice((p) => setDownloadPct(p));
    } catch {
      /* status below tells the story */
    }
    setDownloadPct(null);
    setDevice(await backend.deviceStatus());
  }, [backend]);

  /** Step 1 — find identifiers on this device. Never sends raw text anywhere. */
  const pseudonymise = useCallback(
    async (id: string) => {
      if (!backend) return;
      const iv = studyRef.current.interviews.find((i) => i.id === id);
      if (!iv) return;
      addEntities(findPatterns(iv.raw), id);
      const status = await backend.deviceStatus();
      setDevice(status);
      if (status !== "available") {
        // Fail closed: no on-device model means no automatic detection. We do NOT fall back to the cloud.
        patch(id, { status: "review", deviceMissing: true, progress: undefined });
        return;
      }
      const chunks = chunkTranscript(iv.raw, cfg.chunkChars);
      patch(id, { status: "pseudonymising", deviceMissing: false, error: undefined, progress: { done: 0, total: chunks.length, stage: "Finding identifiers" } });
      try {
        for (let n = 0; n < chunks.length; n++) {
          const done = log({ interviewId: id, purpose: "pseudonymise", mode: "only_on_device", bytesIn: chunks[n].length, payloadPreview: chunks[n].slice(0, 400) });
          try {
            const r = await backend.findIdentifiers(chunks[n]);
            addEntities(r.data.filter((e) => chunks[n].includes(e.text)), id);
            done({ status: "ok", source: r.source });
          } catch (err) {
            done({ status: "error", error: String(err) });
            throw err;
          }
          patch(id, { progress: { done: n + 1, total: chunks.length, stage: "Finding identifiers" } });
        }
        await new Promise((r) => setTimeout(r, 0));
        const people = studyRef.current.codebook.filter((e) => e.type === "PERSON" && e.origin === id);
        const firsts = people.filter((e) => !e.real.includes(" ")).map((e) => e.real);
        const fulls = people.filter((e) => e.real.includes(" ") && !/^(Dr|Mr|Mrs|Ms|Miss|Prof|Nurse)\b/.test(e.real)).map((e) => e.real);
        addEntities(extendNames(iv.raw, firsts, fulls), id);
        if (POLICIES[studyRef.current.policy].secondPass) {
          await new Promise((r) => setTimeout(r, 50)); // let the codebook state settle
          const s = studyRef.current;
          const { redacted } = applyCodebook(iv.raw, s.codebook, POLICIES[s.policy], id);
          const rchunks = chunkTranscript(redacted, cfg.chunkChars);
          const residual: Entity[] = [];
          for (let n = 0; n < rchunks.length; n++) {
            patch(id, { progress: { done: n, total: rchunks.length, stage: "Second check" } });
            const done = log({ interviewId: id, purpose: "second-pass", mode: "only_on_device", bytesIn: rchunks[n].length, payloadPreview: rchunks[n].slice(0, 400) });
            const r = await backend.findResidual(rchunks[n]);
            done({ status: "ok", source: r.source });
            residual.push(...r.data.filter((e) => iv.raw.includes(e.text) && !/^\[[A-Z]+_\d+\]$/.test(e.text)));
          }
          addEntities(residual, id);
          patch(id, { residual });
        }
        patch(id, { status: "review", progress: undefined });
      } catch (err) {
        patch(id, { status: "review", progress: undefined, error: `On-device model error: ${String(err)}` });
      }
    },
    [backend, cfg.chunkChars, addEntities, patch, log],
  );

  /** Pseudonymise every interview that hasn't been done yet, one after another on this device. */
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);
  const cancelBatch = useRef(false);
  const pseudonymiseAll = useCallback(async () => {
    const todo = studyRef.current.interviews.filter((i) => i.status === "raw").map((i) => i.id);
    if (!todo.length) return;
    cancelBatch.current = false;
    setBatch({ done: 0, total: todo.length });
    for (let n = 0; n < todo.length && !cancelBatch.current; n++) {
      await pseudonymise(todo[n]);
      setBatch({ done: n + 1, total: todo.length });
    }
    setBatch(null);
  }, [pseudonymise]);
  const stopBatch = useCallback(() => {
    cancelBatch.current = true;
  }, []);

  /** Runs every outbound request through the airlock. Returns null (blocked) or the guard result. */
  const airlock = useCallback(
    async (purpose: Purpose, mode: LedgerEntry["mode"], payload: string, scope?: string | GuardResult) => {
      const s = studyRef.current;
      const guard = typeof scope === "object" ? scope : guardPayload(payload, s.codebook, POLICIES[s.policy], scope);
      const hash = await sha256(payload);
      const done = log({
        purpose,
        mode,
        bytesIn: guard.bytes,
        payloadPreview: payload.slice(0, 1200),
        guard,
        sha256: hash,
        interviewId: typeof scope === "string" ? scope : undefined,
      });
      if (!guard.ok) done({ status: "blocked" });
      return { guard, done };
    },
    [log],
  );

  const redactedOf = useCallback((iv: Interview) => {
    const s = studyRef.current;
    return applyCodebook(iv.raw, s.codebook, POLICIES[s.policy], iv.id).redacted;
  }, []);
  /** Titles are user-written and often contain names, so they go through the codebook too. */
  const titleOf = useCallback((iv: Interview) => {
    const s = studyRef.current;
    return applyCodebook(iv.title, s.codebook, POLICIES[s.policy], iv.id).redacted;
  }, []);
  const questionsFor = useCallback((interviewId?: string) => {
    const s = studyRef.current;
    return s.researchQuestions ? applyCodebook(s.researchQuestions, s.codebook, POLICIES[s.policy], interviewId).redacted : undefined;
  }, []);

  /** Step 2 — send pseudonymised text to the cloud model for analysis. */
  const analyse = useCallback(
    async (id: string) => {
      if (!backend) return;
      const s = studyRef.current;
      const iv = s.interviews.find((i) => i.id === id);
      if (!iv) return;
      if (!releasable(iv)) {
        patch(id, { error: "Not released: this transcript hasn't been checked on-device or confirmed by a manual review." });
        return;
      }
      if (!navigator.onLine) {
        patch(id, { status: "queued" });
        return;
      }
      const redacted = redactedOf(iv);
      const title = titleOf(iv);
      const payload = analysePrompt(title, redacted, questionsFor(id));
      const { guard, done } = await airlock("analyse-interview", "only_in_cloud", payload, id);
      if (!guard.ok) {
        patch(id, { status: "blocked", blockedBy: guard.findings.map((f) => f.text) });
        return;
      }
      patch(id, { status: "analysing", blockedBy: undefined, error: undefined });
      try {
        const r = await backend.analyseInterview(payload);
        done({ status: "ok", source: r.source });
        patch(id, { status: "analysed", analysis: r.data, analysisSource: r.source });
        if (userId) saveInterview(userId, s.id, { id, title, redacted, analysis: r.data, policy: s.policy }).catch(() => {});
      } catch (err) {
        done({ status: "error", error: String(err) });
        patch(id, { status: "review", error: `Cloud analysis failed: ${String(err)}` });
      }
    },
    [backend, airlock, patch, redactedOf, titleOf, questionsFor, userId],
  );

  /** Quick memo — PREFER_ON_DEVICE on already-pseudonymised text (free/offline with Nano, cloud otherwise). */
  const memo = useCallback(
    async (id: string) => {
      if (!backend) return;
      const iv = studyRef.current.interviews.find((i) => i.id === id);
      if (!iv) return;
      if (!releasable(iv)) {
        patch(id, { memo: "Not run: the memo can fall back to the cloud, so it needs an on-device check or a confirmed manual review first." });
        return;
      }
      const payload = memoPrompt(redactedOf(iv).slice(0, 12000));
      const { guard, done } = await airlock("quick-memo", "prefer_on_device", payload, id);
      if (!guard.ok) {
        patch(id, { status: "blocked", blockedBy: guard.findings.map((f) => f.text) });
        return;
      }
      patch(id, { memo: "", memoSource: undefined });
      try {
        const r = await backend.memo(payload, (t) => patch(id, { memo: t }));
        done({ status: "ok", source: r.source });
        patch(id, { memo: r.data, memoSource: r.source });
      } catch (err) {
        done({ status: "error", error: String(err) });
        patch(id, { memo: `Memo failed: ${String(err)}` });
      }
    },
    [backend, airlock, patch, redactedOf],
  );

  /** Step 3 — cross-interview synthesis in the cloud (long context). */
  const synthesise = useCallback(async () => {
    if (!backend) return;
    const s = studyRef.current;
    const ready = s.interviews.filter((i) => releasable(i) && i.status !== "blocked");
    if (!ready.length) return;
    const parts = ready.map((i) => ({ id: i.id, title: titleOf(i), redacted: redactedOf(i) }));
    const rq = questionsFor();
    const payload = synthPrompt(parts, rq);
    const sectionGuard = guardSections(
      [...parts.map((p) => ({ interviewId: p.id, text: synthPrompt([p]) })), ...(rq ? [{ interviewId: "", text: rq }] : [])],
      s.codebook,
      POLICIES[s.policy],
    );
    const { guard, done } = await airlock("synthesise-study", "only_in_cloud", payload, sectionGuard);
    if (!guard.ok) {
      setStudy((x) => ({ ...x, synthStatus: "blocked", synthError: `Blocked: ${guard.findings.map((f) => f.text).join(", ")}` }));
      return;
    }
    setStudy((x) => ({ ...x, synthStatus: "running", synthError: undefined }));
    try {
      const r = await backend.synthesise(payload);
      done({ status: "ok", source: r.source });
      setStudy((x) => ({ ...x, synthesis: r.data, synthesisSource: r.source, synthStatus: "done" }));
      if (userId) saveSynthesis(userId, s.id, s.name, r.data).catch(() => {});
    } catch (err) {
      done({ status: "error", error: String(err) });
      setStudy((x) => ({ ...x, synthStatus: "error", synthError: String(err) }));
    }
  }, [backend, airlock, redactedOf, titleOf, questionsFor, userId]);

  /** Photo of handwritten notes -> text, entirely on-device. */
  const addImage = useCallback(
    async (file: File) => {
      if (!backend) return;
      const id = uid();
      const iv: Interview = { id, title: `Field notes — ${file.name}`, raw: "", status: "pseudonymising", progress: { done: 0, total: 1, stage: "Reading photo on this device" } };
      setStudy((s) => ({ ...s, interviews: [...s.interviews, iv] }));
      const done = log({ interviewId: id, purpose: "read-image", mode: "only_on_device", bytesIn: file.size, payloadPreview: `${file.name} (${file.type}, ${Math.round(file.size / 1024)} KB)` });
      try {
        const r = await backend.readImage(file);
        done({ status: "ok", source: r.source });
        patch(id, { raw: r.data.transcript, status: "review", progress: undefined });
        addEntities([...r.data.entities.filter((e) => r.data.transcript.includes(e.text)), ...findPatterns(r.data.transcript)], id);
      } catch (err) {
        done({ status: "error", error: String(err) });
        patch(id, { status: "review", progress: undefined, deviceMissing: true, error: `Photo reading needs Gemini Nano with image input on this device: ${String(err)}` });
      }
      return id;
    },
    [backend, log, patch, addEntities],
  );

  // Offline queue: anything queued while offline goes out when the connection returns.
  useEffect(() => {
    if (!online) return;
    for (const i of studyRef.current.interviews) if (i.status === "queued") analyse(i.id);
  }, [online, analyse]);

  const actions = useMemo(
    () => ({
      setName: (name: string) => setStudy((s) => ({ ...s, name })),
      setQuestions: (researchQuestions: string) => setStudy((s) => ({ ...s, researchQuestions })),
      setPolicy: (p: PolicyName) => setStudy((s) => ({ ...s, policy: p })),
      setAttested: (id: string, v: boolean) => patch(id, { attested: v }),
      mergeToken: (from: string, to: string) => setStudy((s) => ({ ...s, codebook: mergeTokens(s.codebook, from, to) })),
      addText: (title: string, raw: string) => {
        const id = uid();
        setStudy((s) => ({ ...s, interviews: [...s.interviews, { id, title, raw, status: "raw" }] }));
        return id;
      },
      removeInterview: (id: string) =>
        setStudy((s) => ({
          ...s,
          interviews: s.interviews.filter((i) => i.id !== id),
          codebook: s.codebook.filter((e) => e.origin !== id || e.type !== "PERSON"),
        })),
      loadSample: () => setStudy(sampleStudy(studyRef.current.policy)),
      newStudy: () => setStudy(emptyStudy(studyRef.current.policy)),
      toggleEntry: (token: string, real: string) =>
        setStudy((s) => ({
          ...s,
          codebook: s.codebook.map((e) => (e.token === token && e.real === real ? { ...e, enabled: !e.enabled } : e)),
        })),
      redactManual: (text: string, type: EntityType, origin: string) => {
        const t = text.trim();
        if (t.length < 2) return;
        setStudy((s) => {
          const existing = s.codebook.find((e) => norm(e.real) === norm(t) && (e.type !== "PERSON" || e.origin === origin));
          if (existing) return { ...s, codebook: s.codebook.map((e) => (e === existing ? { ...e, enabled: true } : e)) };
          return { ...s, codebook: mergeEntities(s.codebook, [{ text: t, type, source: "manual" }], origin) };
        });
      },
      redactFindings: (texts: string[], origin: string) => {
        setStudy((s) => {
          const ents = texts.map((t) => ({ text: t, type: "QUASI" as EntityType, source: "manual" as const }));
          const typed = findPatterns(texts.join("\n"));
          const merged = mergeEntities(
            s.codebook.map((e) => (texts.some((t) => norm(t) === norm(e.real)) ? { ...e, enabled: true } : e)),
            [...typed.map((e) => ({ ...e, source: "manual" as const })), ...ents],
            origin,
          );
          return { ...s, codebook: merged };
        });
        patch(origin, { status: "review", blockedBy: undefined });
      },
    }),
    [patch],
  );

  return {
    study,
    policy,
    ledger,
    device,
    downloadPct,
    online,
    prepareDevice,
    batch,
    pseudonymiseAll,
    stopBatch,
    imageStatus: () => (backend ? backend.imageStatus() : Promise.resolve("unavailable" as DeviceStatus)),
    pseudonymise,
    analyse,
    memo,
    synthesise,
    addImage,
    redactedOf,
    titleOf,
    ...actions,
  };
}

export type Veil = ReturnType<typeof useVeil>;
