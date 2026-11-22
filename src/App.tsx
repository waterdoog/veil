import { useEffect, useRef, useState } from "react";
import type { AiBackend } from "./ai/backend";
import type { RuntimeConfig } from "./firebase";
import { POLICIES, type PolicyName } from "./core/types";
import { useVeil, type Veil } from "./useVeil";
import { auditReportHtml, codebookJson, codedQuotesCsv, pseudonymisedMarkdown } from "./core/report";
import { studyToQdpx } from "./core/qdpx";
import { decryptBackup, encryptBackup } from "./core/backup";
import type { Study } from "./model";
import { hasRecordedRun } from "./replay";
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

  // A shared ?load=replay link lands straight on a document, raw on the left and what the cloud sees on the right.
  const landing = useRef(new URLSearchParams(location.search).get("load"));
  useEffect(() => {
    if (!landing.current?.startsWith("replay") || !study.replay || !study.interviews.length) return;
    setView((study.interviews.find((i) => i.id === "s-hr") ?? study.interviews[0]).id);
    landing.current = null;
    // Drop the parameter so a reload keeps the reviewer's own changes instead of reloading the recording.
    history.replaceState(null, "", location.pathname);
  }, [study]);

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
          <details className="side-group settings-group">
            <summary>Study settings</summary>
            <div className="side-body">
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
          <label className="field">
            <span>Research questions</span>
            <textarea
              className="rq"
              rows={3}
              placeholder="e.g. How do workers decide whether to disclose a fluctuating condition at work?"
              value={study.researchQuestions ?? ""}
              onChange={(e) => veil.setQuestions(e.target.value)}
            />
          </label>
            </div>
          </details>
          <div className="list-head">
            <span>Documents</span>
            <button className="btn btn-ghost btn-small" onClick={() => setAdding(true)}>
              Add
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
          {veil.batch ? (
            <div className="batch small">
              Pseudonymising on device… {veil.batch.done}/{veil.batch.total}{" "}
              <button className="linkish" onClick={veil.stopBatch}>
                stop after this one
              </button>
            </div>
          ) : (
            study.interviews.some((i) => i.status === "raw") && (
              <button className="synth-link device-link" onClick={veil.pseudonymiseAll}>
                <DeviceIcon /> Pseudonymise all on this device
              </button>
            )
          )}
          {study.interviews.length > 0 && (
            <button className={`synth-link ${view === "synthesis" ? "on" : ""}`} onClick={() => setView("synthesis")}>
              <CloudIcon /> Cross-interview synthesis
            </button>
          )}
          <span className="grow" />
          {study.interviews.length > 0 && (
            <details className="side-group exports-group">
              <summary>Export</summary>
              <div className="side-body exports">
              <button className="linkish small" onClick={() => download(`veil-audit-${slug(study.name)}.html`, auditReportHtml(study, veil.ledger), "text/html")}>
                Ethics audit report (no identifiable data)
              </button>
              <button className="linkish small" onClick={() => download(`veil-pseudonymised-${slug(study.name)}.md`, pseudonymisedMarkdown(study), "text/markdown")}>
                Pseudonymised dataset (.md)
              </button>
              <button
                className="linkish small"
                title="REFI-QDA project: pseudonymised transcripts with every coded quote, for NVivo, ATLAS.ti, MAXQDA or QDA Miner"
                onClick={() => download(`veil-${slug(study.name)}.qdpx`, studyToQdpx(study).bytes, "application/zip")}
              >
                Coded project (.qdpx for NVivo / ATLAS.ti / MAXQDA)
              </button>
              <button className="linkish small" onClick={() => download(`veil-coded-quotes-${slug(study.name)}.csv`, codedQuotesCsv(study), "text/csv")}>
                Coded quotes (.csv)
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
              <button
                className="linkish small"
                title="The whole study, raw text and key included, encrypted on this device with your passphrase (AES-256-GCM)"
                onClick={async () => {
                  const pass = prompt("Passphrase for the encrypted backup (at least 8 characters). Without it the file can't be opened — Veil can't recover it.");
                  if (!pass) return;
                  if (prompt("Type the passphrase again") !== pass) return alert("The passphrases didn't match. Nothing was saved.");
                  try {
                    download(`veil-${slug(study.name)}.veilbackup`, await encryptBackup(study, pass), "application/json");
                  } catch (e) {
                    alert((e as Error).message);
                  }
                }}
              >
                Encrypted backup of everything
              </button>
              </div>
            </details>
          )}
          <input
            id="restore-file"
            type="file"
            accept=".veilbackup,application/json"
            hidden
            onChange={async (ev) => {
              const f = ev.target.files?.[0];
              ev.target.value = "";
              if (!f) return;
              const pass = prompt(`Passphrase for ${f.name}`);
              if (!pass) return;
              try {
                const st = await decryptBackup<Study>(await f.text(), pass);
                if (study.interviews.length && !confirm(`Replace the current study "${study.name}" with "${st.name}"?`)) return;
                veil.restoreStudy(st);
                setView("home");
              } catch (e) {
                alert((e as Error).message);
              }
            }}
          />
          <details className="side-group side-foot">
            <summary>Samples and benchmarks</summary>
            <div className="side-body">
            <button className="linkish" onClick={veil.loadSample}>
              Load sample study
            </button>{hasRecordedRun && (
              <>
                <button className="linkish" onClick={() => veil.loadReplay()} title="Detections recorded from real Gemini Nano (Chrome 158)">
                  Recorded Nano run
                </button></>
            )}
            <button className="linkish" onClick={veil.loadHoldout} title="Four more fictional interviews that were never used to tune Veil">
              Held-out set
            </button><button className="linkish" onClick={veil.loadScenarios} title="A court judgment, an HR investigation file and a hospital discharge summary">
              Beyond interviews (HR, clinical, legal, note)
            </button><button className="linkish" onClick={veil.loadTab} title="Text Anonymization Benchmark — 8 public ECHR judgments with expert annotations">
              TAB benchmark
            </button><button className="linkish" onClick={veil.newStudy}>
              New study
            </button><button className="linkish" onClick={() => document.getElementById("restore-file")?.click()}>
              Restore a backup
            </button>
            </div>
          </details>
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
      <LockIcon /> Gemini Nano unavailable
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
          Interviews, HR files, clinical letters: the documents people most want AI help with are the ones they can't
          upload. Gemini Nano finds the names and places on your laptop; the cloud model only ever reads a pseudonymised copy.
        </p>
        <div className="actions">
          {!study.interviews.length ? (
            <>
              {hasRecordedRun && veil.device === "unavailable" ? (
                <button className="btn btn-device" onClick={() => veil.loadReplay()}>
                  Start here: sample study with a recorded Gemini Nano run
                </button>
              ) : (
                <button className="btn btn-device" onClick={veil.loadSample}>
                  Load the sample study (6 fictional interviews)
                </button>
              )}

              <button className="btn btn-ghost" onClick={onAdd}>
                Add your own transcript
              </button>
            </>
          ) : (
            <button className="btn" onClick={() => onOpen(study.interviews[0].id)}>
              Open the study ({study.interviews.length} {study.interviews.length === 1 ? "document" : "documents"})
            </button>
          )}
          {hasRecordedRun && veil.device !== "available" && study.interviews.length > 0 && !study.replay && (
            <button className="btn btn-ghost" onClick={() => veil.loadReplay()} title="Detections made by real Gemini Nano on another machine; cloud analysis runs live">
              No Gemini Nano here? Replay a recorded Nano run
            </button>
          )}
        </div>
      </div>

      {study.interviews.every((iv) => iv.truth) && (
        <div className="starters">
          <span className="muted">Try it on</span>
          {veil.device === "available" && (
            <button
              className="starter live"
              onClick={() => {
                veil.loadQuick();
                onOpen("q01");
              }}
            >
              <b>Live in ~15 seconds</b>
              <span>One page, pseudonymised by Gemini Nano on this device</span>
            </button>
          )}
          <button
            className="starter"
            onClick={() => {
              if (hasRecordedRun && veil.device !== "available") veil.loadReplay();
              else veil.loadSample();
              onOpen("p01");
            }}
          >
            <b>Research interviews</b>
            <span>6 fictional Long COVID interviews{hasRecordedRun && veil.device !== "available" ? " · recorded Nano run" : ""}</span>
          </button>
          {[
            ["s-hr", "HR investigation file", "Grievance + capability review"],
            ["s-clin", "Hospital discharge summary", "Cardiology, NHS-style"],
            ["s-legal", "Court judgment", "Real ECHR judgment (TAB)"],
            ["s-note", "Handwritten note", "Photo, read on device"],
          ].map(([id, name, sub]) => (
            <button
              key={id}
              className="starter"
              onClick={() => {
                if (id === "s-note" && veil.device === "available") return void veil.addSampleNote(onOpen);
                if (veil.device !== "available") veil.loadReplay("scenarios");
                else veil.loadScenarios();
                onOpen(id);
              }}
            >
              <b>{name}</b>
              <span>{sub}{veil.device !== "available" ? " · recorded Nano run" : ""}</span>
            </button>
          ))}
        </div>
      )}

      <ol className="how">
        <li>
          <span className="how-n device">1</span>
          <div>
            <b>On your laptop</b>
            <p>
              Gemini Nano in Chrome finds names, places, organisations and dates. Without it, Veil never falls back to the
              cloud with raw text.
            </p>
          </div>
        </li>
        <li>
          <span className="how-n">2</span>
          <div>
            <b>The airlock</b>
            <p>
              Every request is re-checked before it leaves. A known identifier blocks it; the log shows exactly what was sent.
            </p>
          </div>
        </li>
        <li>
          <span className="how-n cloud">3</span>
          <div>
            <b>In the cloud</b>
            <p>
              Gemini writes the thematic analysis across all documents. Real names are put back on your screen only.
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
function download(name: string, data: string | Uint8Array, type: string) {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
