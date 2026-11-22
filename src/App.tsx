import { useEffect, useState } from "react";
import type { AiBackend } from "./ai/backend";
import type { RuntimeConfig } from "./firebase";
import { POLICIES, type PolicyName } from "./core/types";
import { useVeil, type Veil } from "./useVeil";
import { auditReportHtml, codebookJson, pseudonymisedMarkdown } from "./core/report";
import { CloudIcon, DeviceIcon, LockIcon } from "./ui/bits";
import { InterviewView } from "./ui/InterviewView";
import { AddInterview, Ledger, SetupPanel, SynthesisView } from "./ui/Panels";

export function App({
  backend,
  cfg,
  userId,
  configured,
  simulated,
}: {
  backend: AiBackend | null;
  cfg: RuntimeConfig;
  userId: string | null;
  configured: boolean;
  simulated: boolean;
}) {
  const veil = useVeil(backend, cfg, userId);
  const [view, setView] = useState<string>("home");
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const { study } = veil;
  const current = study.interviews.find((i) => i.id === view);

  useEffect(() => {
    if (view !== "home" && view !== "synthesis" && !current) setView("home");
  }, [view, current]);

  return (
    <div className="app">
      {simulated && <div className="sim-banner">Development harness — model calls are simulated. Production builds always use Firebase AI Logic.</div>}
      <header className="topbar">
        <button className="brand" onClick={() => setView("home")}>
          <img src="/veil.svg" alt="" width={28} height={28} />
          <span>Veil</span>
        </button>
        <span className="tagline">Pseudonymise on your device. Analyse in the cloud.</span>
        <span className="grow" />
        <DeviceChip veil={veil} onSetup={() => setSetupOpen(true)} />
        <span className={`chip-status ${veil.online ? "" : "off"}`} title={`Cloud model: ${cfg.cloudModel} via Firebase AI Logic`}>
          <CloudIcon /> {veil.online ? cfg.cloudModel : "offline — cloud queued"}
        </span>
        <button className="btn btn-ghost btn-small" onClick={() => setLedgerOpen((x) => !x)}>
          Airlock log <span className="count">{veil.ledger.length}</span>
        </button>
      </header>

      {!configured && !simulated && (
        <div className="notice notice-warn wide">
          Firebase isn't configured for this build. Copy <code>.env.example</code> to <code>.env</code> with your Firebase
          web config (see README) — Veil's AI runs on Firebase AI Logic.
        </div>
      )}

      <div className="body">
        <nav className="sidebar">
          <input className="study-name" value={study.name} onChange={(e) => veil.setName(e.target.value)} aria-label="Study name" />
          <label className="field">
            <span>Redaction policy</span>
            <select value={study.policy} onChange={(e) => veil.setPolicy(e.target.value as PolicyName)}>
              {Object.values(POLICIES).map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name === "strict" ? "Strict (+ second on-device check)" : "Standard (keeps health details)"}
                </option>
              ))}
            </select>
          </label>
          <div className="list-head">
            <span>Interviews</span>
            <button className="btn btn-small" onClick={() => setAdding(true)}>
              + Add
            </button>
          </div>
          <ul className="iv-list">
            {study.interviews.map((i) => (
              <li key={i.id}>
                <button className={view === i.id ? "on" : ""} onClick={() => setView(i.id)}>
                  <StatusDot status={i.status} />
                  <span className="iv-title">{i.title}</span>
                </button>
              </li>
            ))}
            {!study.interviews.length && <li className="muted small pad">No interviews yet.</li>}
          </ul>
          {study.interviews.length > 0 && (
            <button className={`synth-link ${view === "synthesis" ? "on" : ""}`} onClick={() => setView("synthesis")}>
              <CloudIcon /> Cross-interview synthesis
            </button>
          )}
          <span className="grow" />
          {study.interviews.length > 0 && (
            <div className="exports">
              <div className="list-head">
                <span>Export</span>
              </div>
              <button className="linkish small" onClick={() => download(`veil-audit-${slug(study.name)}.html`, auditReportHtml(study, veil.ledger), "text/html")}>
                Ethics audit report (no identifiable data)
              </button>
              <button className="linkish small" onClick={() => download(`veil-pseudonymised-${slug(study.name)}.md`, pseudonymisedMarkdown(study), "text/markdown")}>
                Pseudonymised dataset (.md)
              </button>
              <button
                className="linkish small"
                onClick={() => {
                  if (confirm("The codebook links placeholders to real names. Download it only to storage your ethics approval allows. Continue?"))
                    download(`veil-codebook-${slug(study.name)}.json`, codebookJson(study), "application/json");
                }}
              >
                Codebook key (contains real names)
              </button>
            </div>
          )}
          <div className="side-foot small muted">
            <button className="linkish" onClick={veil.loadSample}>
              Load sample study
            </button>{" "}
            ·{" "}
            <button className="linkish" onClick={veil.newStudy}>
              New study
            </button>
          </div>
        </nav>

        <main className="main">
          {view === "home" && <Home veil={veil} onAdd={() => setAdding(true)} onOpen={setView} onSetup={() => setSetupOpen(true)} />}
          {view === "synthesis" && <SynthesisView veil={veil} />}
          {current && <InterviewView key={current.id} veil={veil} iv={current} />}
        </main>
      </div>

      {setupOpen && <SetupPanel veil={veil} onClose={() => setSetupOpen(false)} />}
      {ledgerOpen && <Ledger entries={veil.ledger} onClose={() => setLedgerOpen(false)} />}
      {adding && (
        <AddInterview
          veil={veil}
          onDone={(id) => {
            setAdding(false);
            if (id) setView(id);
          }}
        />
      )}
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const label: Record<string, string> = {
    raw: "Not pseudonymised",
    pseudonymising: "Pseudonymising on device",
    review: "Ready to review",
    queued: "Queued (offline)",
    analysing: "Analysing in cloud",
    analysed: "Analysed",
    blocked: "Blocked by airlock",
  };
  return <span className={`dot dot-${status}`} title={label[status]} aria-label={label[status]} />;
}

function DeviceChip({ veil, onSetup }: { veil: Veil; onSetup: () => void }) {
  if (veil.downloadPct !== null)
    return (
      <span className="chip-status device">
        <DeviceIcon /> Downloading Gemini Nano {Math.round(veil.downloadPct * 100)}%
      </span>
    );
  if (veil.device === "available")
    return (
      <button className="chip-status device" onClick={onSetup} title="Raw text is processed by Gemini Nano in Chrome">
        <DeviceIcon /> Gemini Nano ready
      </button>
    );
  if (veil.device === "downloadable" || veil.device === "downloading")
    return (
      <button className="btn btn-device btn-small" onClick={veil.prepareDevice}>
        <DeviceIcon /> Set up on-device model
      </button>
    );
  return (
    <button className="chip-status warn" onClick={onSetup} title="Chrome desktop 139+ with the Prompt API is needed. Veil fails closed: raw text is never sent to the cloud.">
      <LockIcon /> On-device model unavailable — check setup
    </button>
  );
}

function Home({ veil, onAdd, onOpen, onSetup }: { veil: Veil; onAdd: () => void; onOpen: (id: string) => void; onSetup: () => void }) {
  const { study } = veil;
  return (
    <div className="home">
      <div className="hero">
        <h1>
          Find the names on your laptop.
          <br />
          <em>Send the cloud only the story.</em>
        </h1>
        <p className="lede">
          Qualitative researchers promise ethics committees that identifiable transcripts stay under their control, then
          spend hours pseudonymising by hand before they can use any AI. Veil does it on your laptop with Gemini Nano, shows
          you exactly what will leave, blocks anything that slipped through, and only then hands the cloud model a
          pseudonymised copy for thematic analysis. Results come back with real names restored — locally.
        </p>
        <div className="actions">
          {!study.interviews.length ? (
            <>
              <button className="btn btn-device" onClick={veil.loadSample}>
                Load the sample study (6 fictional interviews)
              </button>
              <button className="btn btn-ghost" onClick={onAdd}>
                Add your own transcript
              </button>
            </>
          ) : (
            <button className="btn" onClick={() => onOpen(study.interviews[0].id)}>
              Open {study.interviews[0].title.slice(0, 40)}
            </button>
          )}
        </div>
      </div>

      <ol className="how">
        <li>
          <span className="how-n device">1</span>
          <div>
            <b>Pseudonymise — on device</b>
            <p>
              Gemini Nano in Chrome, via Firebase AI Logic in <code>ONLY_ON_DEVICE</code> mode, finds names, places,
              organisations, dates and rare details chunk by chunk. Pattern detectors catch emails, phones, postcodes and
              reference numbers. No on-device model? Veil fails closed — it never falls back to the cloud with raw text.
            </p>
          </div>
        </li>
        <li>
          <span className="how-n">2</span>
          <div>
            <b>Airlock — on device</b>
            <p>
              Every outgoing payload is re-scanned against the study codebook and identifier patterns. One hit and the
              request is blocked. The log shows every call, its mode, where it actually ran and the exact text sent.
            </p>
          </div>
        </li>
        <li>
          <span className="how-n cloud">3</span>
          <div>
            <b>Analyse — in the cloud</b>
            <p>
              Gemini (<code>ONLY_IN_CLOUD</code>) does long-context thematic analysis per interview and across the study.
              Light tasks like memos use <code>PREFER_ON_DEVICE</code> — free and offline with Nano, cloud otherwise, safe
              because they only ever see pseudonymised text. Placeholders are swapped back for real names on your screen
              only.
            </p>
          </div>
        </li>
      </ol>

      {veil.device !== "available" && (
        <div className="card setup">
          <h3>Turn on the on-device model</h3>
          {veil.device === "downloadable" || veil.device === "downloading" ? (
            <p>
              Chrome supports Gemini Nano on this computer. Download it once (a few minutes, stays on this device):{" "}
              <button className="btn btn-device btn-small" onClick={veil.prepareDevice}>
                Set up on-device model
              </button>
            </p>
          ) : (
            <p>
              Use Chrome on desktop (version 139 or later) with <code>chrome://flags/#prompt-api-for-gemini-nano-multimodal-input</code>{" "}
              enabled, then reload. Without it you can still use Veil with pattern detection and manual redaction — raw text
              is never sent to the cloud.{" "}
              <button className="btn btn-ghost btn-small" onClick={onSetup}>
                Check my setup
              </button>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "study";
}

/** Saves a file generated in the browser. Nothing is uploaded. */
function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
