import { useRef, useState } from "react";
import type { LedgerEntry } from "../core/airlock";
import type { Veil } from "../useVeil";
import { releasable } from "../model";
import { DeviceIcon, Progress, SourceBadge, TokenText } from "./bits";

const PURPOSE: Record<LedgerEntry["purpose"], string> = {
  pseudonymise: "Find identifiers",
  "second-pass": "Second check",
  "read-image": "Read photo",
  "analyse-interview": "Analyse interview",
  "synthesise-study": "Cross-interview synthesis",
  "quick-memo": "Quick memo",
};

export function Ledger({ entries, onClose }: { entries: LedgerEntry[]; onClose: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const dev = entries.filter((e) => e.source === "on_device").length;
  const cloud = entries.filter((e) => e.source === "in_cloud").length;
  const blocked = entries.filter((e) => e.status === "blocked").length;
  const sentKB = entries.filter((e) => e.source === "in_cloud").reduce((a, e) => a + e.bytesIn, 0) / 1024;
  return (
    <aside className="drawer" aria-label="Airlock log">
      <header>
        <h3>Airlock log</h3>
        <button className="btn btn-ghost btn-small" onClick={onClose}>
          Close
        </button>
      </header>
      <p className="muted small">
        Every model call Veil made in this session: the Firebase AI Logic mode it asked for, where inference actually ran
        (<code>response.inferenceSource</code>), and the exact text that left this device.
      </p>
      <div className="ledger-stats">
        <div>
          <b>{dev}</b>
          <span>on device</span>
        </div>
        <div>
          <b>{cloud}</b>
          <span>in cloud</span>
        </div>
        <div>
          <b>{sentKB.toFixed(1)} KB</b>
          <span>sent (pseudonymised)</span>
        </div>
        <div className={blocked ? "bad" : ""}>
          <b>{blocked}</b>
          <span>blocked</span>
        </div>
      </div>
      <ol className="ledger">
        {entries.map((e) => (
          <li key={e.id} className={`led led-${e.status}`}>
            <button className="led-row" onClick={() => setOpen(open === e.id ? null : e.id)}>
              <span className="led-time">{new Date(e.at).toLocaleTimeString()}</span>
              <span className="led-purpose">{PURPOSE[e.purpose]}</span>
              <code className="led-mode">{e.mode}</code>
              {e.status === "blocked" ? <span className="badge badge-bad">blocked</span> : e.status === "running" ? <span className="badge">running…</span> : e.status === "error" ? <span className="badge badge-bad">error</span> : <SourceBadge source={e.source} />}
            </button>
            {open === e.id && (
              <div className="led-detail">
                <div className="small muted">
                  {(e.bytesIn / 1024).toFixed(1)} KB input{e.ms !== undefined ? ` · ${e.ms} ms` : ""}
                  {e.source === "on_device" || e.mode === "only_on_device" ? " · never left this device" : ""}
                </div>
                {e.guard && (
                  <div className={`small ${e.guard.ok ? "ok" : "bad"}`}>
                    Airlock: {e.guard.ok ? "passed" : `blocked — ${e.guard.findings.map((f) => f.text).join(", ")}`}
                  </div>
                )}
                {e.error && <div className="small bad">{e.error}</div>}
                <pre>{e.payloadPreview}{e.payloadPreview.length >= 1200 ? "\n…" : ""}</pre>
              </div>
            )}
          </li>
        ))}
        {!entries.length && <li className="muted small">No model calls yet.</li>}
      </ol>
    </aside>
  );
}

export function SynthesisView({ veil }: { veil: Veil }) {
  const { study } = veil;
  const [showReal, setShowReal] = useState(true);
  const s = study.synthesis;
  const n = study.interviews.filter((i) => releasable(i) && i.status !== "blocked").length;
  return (
    <div className="interview">
      <div className="iv-head">
        <div>
          <div className="eyebrow">Study</div>
          <h2>Cross-interview synthesis</h2>
        </div>
        <button className="btn btn-cloud" disabled={!n || study.synthStatus === "running"} onClick={veil.synthesise}>
          {s ? "Re-run" : "Run"} synthesis on {n} pseudonymised interview{n === 1 ? "" : "s"}
        </button>
      </div>
      <p className="muted">
        Long-context work is what the cloud model is for: all pseudonymised transcripts go to Gemini together (through the
        same airlock), so it can compare cases. Placeholders are consistent across the study, so the same clinic is the same
        token in every interview.
      </p>
      {study.synthStatus === "running" && <Progress done={0} total={1} label="Gemini is comparing interviews…" />}
      {study.synthError && <div className="notice notice-error">{study.synthError}</div>}
      {s && (
        <div className="analysis">
          <div className="analysis-bar">
            <SourceBadge source={study.synthesisSource} mode="only_in_cloud" />
            <label className="switch">
              <input type="checkbox" checked={showReal} onChange={(e) => setShowReal(e.target.checked)} />
              <span>{showReal ? "Showing real names — re-identified on this device" : "Showing exactly what the cloud saw"}</span>
            </label>
          </div>
          <div className="card">
            <h3>Overview</h3>
            <p>
              <TokenText text={s.overview} codebook={study.codebook} showReal={showReal} />
            </p>
          </div>
          <div className="themes">
            {s.themes.map((t) => (
              <div className="card theme" key={t.name}>
                <h3>{t.name}</h3>
                <div className="chips">
                  {t.interviews.map((x) => (
                    <span key={x} className="chip">
                      {x}
                    </span>
                  ))}
                </div>
                <p>
                  <TokenText text={t.description} codebook={study.codebook} showReal={showReal} />
                </p>
                {t.quotes.map((q, i) => (
                  <blockquote key={i}>
                    <TokenText text={q.quote} codebook={study.codebook} showReal={showReal} />
                    <cite>{q.interview}</cite>
                  </blockquote>
                ))}
              </div>
            ))}
          </div>
          <div className="two">
            <div className="card">
              <h3>Where participants diverge</h3>
              <ul>
                {s.divergences.map((x, i) => (
                  <li key={i}>
                    <TokenText text={x} codebook={study.codebook} showReal={showReal} />
                  </li>
                ))}
              </ul>
            </div>
            <div className="card">
              <h3>Implications</h3>
              <ul>
                {s.implications.map((x, i) => (
                  <li key={i}>
                    <TokenText text={x} codebook={study.codebook} showReal={showReal} />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function vttToText(s: string) {
  if (!/^WEBVTT/.test(s)) return s;
  return s
    .split(/\r?\n/)
    .filter((l) => l && !/^WEBVTT/.test(l) && !/^\d+$/.test(l) && !/-->/.test(l))
    .join("\n");
}

export function AddInterview({ veil, onDone }: { veil: Veil; onDone: (id?: string) => void }) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  return (
    <div className="modal-bg" onClick={() => onDone()}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Add interview">
        <h3>Add an interview</h3>
        <p className="muted small">The transcript is stored in this browser only (IndexedDB). Nothing is uploaded until you release a pseudonymised version.</p>
        <input className="input" placeholder="Title, e.g. Participant 7 — nurse, night shifts" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea className="input" rows={10} placeholder="Paste a transcript…" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="actions">
          <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
            Upload .txt / .vtt
          </button>
          <button className="btn btn-ghost" onClick={() => imgRef.current?.click()}>
            <DeviceIcon /> Photo of notes
          </button>
          <span className="grow" />
          <button className="btn" disabled={!text.trim()} onClick={() => onDone(veil.addText(title.trim() || "Untitled interview", text))}>
            Add
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".txt,.vtt,.md,text/plain"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setText(vttToText(await f.text()));
            if (!title) setTitle(f.name.replace(/\.[^.]+$/, ""));
          }}
        />
        <input
          ref={imgRef}
          type="file"
          accept="image/png,image/jpeg"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const pending = veil.addImage(f);
            onDone();
            await pending;
          }}
        />
      </div>
    </div>
  );
}
