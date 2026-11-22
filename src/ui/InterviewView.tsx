import { useMemo, useState } from "react";
import { guardPayload } from "../core/airlock";
import { applyCodebook } from "../core/codebook";
import { evaluate } from "../core/evaluate";
import { analysePrompt } from "../ai/prompts";
import { POLICIES, type EntityType } from "../core/types";
import type { Interview } from "../model";
import type { Veil } from "../useVeil";
import { useEffect, useRef } from "react";
import { rehydrate } from "../core/codebook";
import { CloudIcon, DeviceIcon, findQuoteLine, LinedTranscript, LockIcon, Progress, SourceBadge, TokenText, TYPE_LABEL } from "./bits";

const MANUAL_TYPES: EntityType[] = ["PERSON", "ORG", "LOCATION", "DATE", "ID", "QUASI"];

export function InterviewView({ veil, iv }: { veil: Veil; iv: Interview }) {
  const [tab, setTab] = useState<"pseudo" | "analysis">(iv.analysis ? "analysis" : "pseudo");
  const [showReal, setShowReal] = useState(true);
  const [sel, setSel] = useState<{ text: string; x: number; y: number } | null>(null);
  const [flash, setFlash] = useState<number | null>(null);
  const [airlockTest, setAirlockTest] = useState<{ leaked: string; blocked: boolean } | null>(null);
  const rawRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (flash === null || tab !== "pseudo") return;
    rawRef.current?.querySelector(`[data-line="${flash}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = setTimeout(() => setFlash(null), 2400);
    return () => clearTimeout(t);
  }, [flash, tab]);
  const jumpTo = (q: { quote: string; timestamp?: string }) => {
    const line = findQuoteLine(iv.raw, q, rehydrate(q.quote, study.codebook));
    if (line === null) return;
    setTab("pseudo");
    setFlash(line);
  };
  const { study, policy } = veil;

  const { redacted, spans } = useMemo(() => applyCodebook(iv.raw, study.codebook, policy, iv.id), [iv.raw, study.codebook, policy, iv.id]);
  const title = useMemo(() => applyCodebook(iv.title, study.codebook, policy, iv.id).redacted, [iv.title, study.codebook, policy, iv.id]);
  const guard = useMemo(() => guardPayload(analysePrompt(title, redacted, study.researchQuestions ? applyCodebook(study.researchQuestions, study.codebook, policy, iv.id).redacted : undefined), study.codebook, policy, iv.id), [title, redacted, study.codebook, policy, iv.id, study.researchQuestions]);
  const evalRes = useMemo(() => (iv.truth ? evaluate(iv.raw, spans, iv.truth, policy.redact) : null), [iv.truth, iv.raw, spans, policy]);
  const entries = useMemo(() => {
    const order = ["PERSON", "ORG", "LOCATION", "DATE", "CONTACT", "ID", "FINANCIAL", "QUASI", "HEALTH"];
    const num = (t: string) => Number(t.match(/_(\d+)\]/)?.[1] ?? 0);
    return study.codebook
      .filter((e) => (e.type === "PERSON" ? e.origin === iv.id : iv.raw.toLowerCase().includes(e.real.toLowerCase())))
      .sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || num(a.token) - num(b.token));
  }, [study.codebook, iv.id, iv.raw]);

  const busy = iv.status === "pseudonymising" || iv.status === "analysing";
  const reviewed = iv.status !== "raw" && iv.status !== "pseudonymising";

  const onMouseUp = () => {
    const s = window.getSelection();
    const text = s?.toString().trim() ?? "";
    if (!s || text.length < 2 || text.length > 80) return setSel(null);
    const r = s.getRangeAt(0).getBoundingClientRect();
    setSel({ text, x: r.left + r.width / 2, y: r.top });
  };

  return (
    <div className="interview">
      <div className="iv-head">
        <div>
          <div className="eyebrow">Interview {iv.id}</div>
          <h2>{iv.title}</h2>
        </div>
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === "pseudo"} className={tab === "pseudo" ? "on" : ""} onClick={() => setTab("pseudo")}>
            <span className="step">1</span> Pseudonymise <small>on device</small>
          </button>
          <button role="tab" aria-selected={tab === "analysis"} className={tab === "analysis" ? "on" : ""} onClick={() => setTab("analysis")}>
            <span className="step">2</span> Analyse <small>in cloud</small>
          </button>
        </div>
      </div>

      {tab === "pseudo" && (
        <div className="split">
          <section className="pane pane-device">
            <header>
              <span className="pane-title">
                <LockIcon /> Raw transcript — stays on this device
              </span>
              <span className="muted">{spans.length} spans replaced</span>
            </header>
            {study.replay && (
              <div className="notice">
                <b>Recorded run.</b> These highlights were produced by real Gemini Nano in {study.replay.browser} on{" "}
                {new Date(study.replay.capturedAt).toLocaleDateString()} and replayed here, because this browser can't run the
                model. Review, the airlock and cloud analysis below run live.
              </div>
            )}
            {iv.progress && <Progress done={iv.progress.done} total={iv.progress.total} label={`${iv.progress.stage} with Gemini Nano…`} />}
            {iv.deviceMissing && (
              <div className="notice notice-warn">
                <strong>Gemini Nano isn't available in this browser, so Veil won't auto-detect names.</strong> It will not
                fall back to the cloud with raw text. Pattern detectors (emails, phones, postcodes, reference numbers) ran
                locally; select any other text below to redact it by hand.
              </div>
            )}
            {iv.error && <div className="notice notice-error">{iv.error}</div>}
            <div className="transcript" onMouseUp={onMouseUp} ref={rawRef}>
              <LinedTranscript text={iv.raw} spans={spans} onToggle={veil.toggleEntry} flash={flash} />
            </div>
            {sel && (
              <div className="seltool" style={{ left: sel.x, top: sel.y }}>
                <span>Redact “{sel.text.length > 24 ? sel.text.slice(0, 24) + "…" : sel.text}” as</span>
                {MANUAL_TYPES.map((t) => (
                  <button
                    key={t}
                    className={`chip hl-${t}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      veil.redactManual(sel.text, t, iv.id);
                      setSel(null);
                      window.getSelection()?.removeAllRanges();
                    }}
                  >
                    {TYPE_LABEL[t]}
                  </button>
                ))}
                <button className="chip ghost" onClick={() => setSel(null)}>
                  ✕
                </button>
              </div>
            )}
          </section>

          <section className="pane pane-out">
            <header>
              <span className="pane-title">
                <CloudIcon /> What the cloud will see
              </span>
              <span className="muted">{(guard.bytes / 1024).toFixed(1)} KB</span>
            </header>

            {!reviewed ? (
              <div className="cta-block">
                <p>
                  Gemini Nano reads the transcript <b>on this device</b>, in {Math.max(1, Math.ceil(iv.raw.length / 3500))} chunks, and
                  lists names, places, organisations, dates, contact details and rare details. Veil swaps each for a
                  consistent placeholder like <code>[PERSON_1]</code>.
                </p>
                <button className="btn btn-device" disabled={busy} onClick={() => veil.pseudonymise(iv.id)}>
                  <DeviceIcon /> Pseudonymise on this device
                </button>
                <p className="muted small">Policy: {POLICIES[study.policy].label}</p>
              </div>
            ) : (
              <>
                <div className={`guard ${guard.ok && !iv.deviceMissing ? "guard-ok" : guard.ok ? "guard-warn" : "guard-bad"}`}>
                  {guard.ok && iv.deviceMissing ? (
                    <>
                      <b>Only pattern checks ran.</b> No email/phone/postcode/reference-number patterns or hand-redacted values
                      remain, but names, places and organisations have <u>not</u> been checked by a model. Redact them by hand
                      before release.
                    </>
                  ) : guard.ok ? (
                    <>
                      <b>Airlock: nothing known left.</b> None of the {entries.filter((e) => e.enabled).length} identifiers found so far, and no
                      email/phone/postcode/reference-number patterns, appear in the outgoing text. It can't see identifiers nobody
                      flagged — read the right-hand side before you release it.
                    </>
                  ) : (
                    <>
                      <b>Airlock would block this.</b> Still in plain text:{" "}
                      {guard.findings.slice(0, 6).map((f) => (
                        <code key={f.text}>{f.text}</code>
                      ))}
                      <button className="btn btn-small" onClick={() => veil.redactFindings(guard.findings.map((f) => f.text), iv.id)}>
                        Redact these
                      </button>
                    </>
                  )}
                </div>

                {evalRes && (
                  <div className="evalcard">
                    <div className="eval-num">{Math.round(evalRes.recall * 100)}%</div>
                    <div>
                      <b>
                        {evalRes.caught} of {evalRes.total} identifiers removed
                      </b>{" "}
                      <span className="muted">(answer key for this fictional sample, policy types only)</span>
                      <div className="small">
                        Precision {Math.round(evalRes.precision * 100)}% — {evalRes.spans - Math.round(evalRes.precision * evalRes.spans)} of {evalRes.spans} replacements
                        aren't in the answer key{evalRes.falsePositives.length ? ` (e.g. ${evalRes.falsePositives.slice(0, 3).map((x) => `“${x}”`).join(", ")})` : ""}.
                      </div>
                      {evalRes.missed.length > 0 && (
                        <div className="small">
                          Missed:{" "}
                          {evalRes.missed.slice(0, 8).map((m) => (
                            <button key={m.text} className="chip linkish" title="Redact it" onClick={() => veil.redactManual(m.text, m.type, iv.id)}>
                              {m.text}
                            </button>
                          ))}
                          {evalRes.missed.length > 8 && <span className="muted"> +{evalRes.missed.length - 8} more</span>}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="transcript transcript-out">
                  <div className="out-title">Interview: <TokenText text={title} codebook={study.codebook} showReal={false} /></div>
                  <TokenText text={redacted} codebook={study.codebook} showReal={false} />
                </div>

                {iv.deviceMissing && (
                  <label className="attest">
                    <input type="checkbox" checked={!!iv.attested} onChange={(e) => veil.setAttested(iv.id, e.target.checked)} />
                    I have read the whole transcript and redacted every identifier by hand.
                  </label>
                )}
                {airlockTest && (
                  <div className={`notice ${airlockTest.blocked ? "notice-error" : "notice-warn"}`}>
                    {airlockTest.blocked ? (
                      <>
                        <b>Blocked.</b> We slipped “{airlockTest.leaked}” back into the outgoing text, as a careless edit would. The airlock
                        stopped it before anything was sent (see the Airlock log).
                      </>
                    ) : (
                      <>The test value wasn't caught — please report this.</>
                    )}
                  </div>
                )}
                <div className="actions">
                  <button
                    className="btn btn-ghost"
                    title="Insert a real name into the outgoing text and see the airlock block it. Nothing is sent."
                    onClick={async () => setAirlockTest(await veil.testAirlock(iv.id))}
                  >
                    Test the airlock
                  </button>
                  <button className="btn btn-ghost" disabled={busy} onClick={() => veil.pseudonymise(iv.id)}>
                    Re-run on device
                  </button>
                  <button
                    className="btn btn-cloud"
                    disabled={busy || !guard.ok || (iv.deviceMissing && !iv.attested)}
                    onClick={async () => {
                      await veil.analyse(iv.id);
                      setTab("analysis");
                    }}
                  >
                    <CloudIcon /> {veil.online ? "Release to cloud analysis" : "Queue for cloud (offline)"}
                  </button>
                </div>
              </>
            )}

            {entries.length > 0 && (
              <details className="codebook" open={reviewed}>
                <summary>
                  Codebook <span className="muted">— real values never leave this device</span>
                </summary>
                <table>
                  <tbody>
                    {entries.map((e) => (
                      <tr key={e.token + e.real} className={e.enabled && (policy.redact.includes(e.type) || e.source === "manual") ? "" : "off"}>
                        <td>
                          <input
                            type="checkbox"
                            checked={e.enabled}
                            onChange={() => veil.toggleEntry(e.token, e.real)}
                            aria-label={`Redact ${e.real}`}
                          />
                        </td>
                        <td className="real">{e.real}</td>
                        <td>
                          <span className={`token hl-${e.type}`}>{e.token}</span>
                        </td>
                        <td>
                          <select
                            className="merge"
                            value=""
                            aria-label={`Merge ${e.token} into another placeholder`}
                            onChange={(ev) => ev.target.value && veil.mergeToken(e.token, ev.target.value)}
                          >
                            <option value="">same as…</option>
                            {[...new Set(entries.filter((o) => o.type === e.type && o.token !== e.token).map((o) => o.token))].map((t) => (
                              <option key={t} value={t}>
                                {t} {entries.find((o) => o.token === t)?.real}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="muted small">
                          {e.source === "nano" ? "Nano" : e.source === "pattern" ? "pattern" : "you"}
                          {!policy.redact.includes(e.type) && e.source !== "manual" ? " · kept by policy" : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )}
          </section>
        </div>
      )}

      {tab === "analysis" && (
        <div className="analysis">
          {iv.status === "analysing" && <Progress done={0} total={1} label="Gemini in the cloud is reading the pseudonymised transcript…" />}
          {iv.status === "queued" && <div className="notice">You're offline. This interview is queued and will be analysed as soon as you reconnect.</div>}
          {iv.status === "blocked" && (
            <div className="notice notice-error">
              Blocked by the airlock: {iv.blockedBy?.join(", ")}. Go back to step 1 and redact these first.
            </div>
          )}
          {iv.error && <div className="notice notice-error">{iv.error}</div>}
          {!iv.analysis && iv.status !== "analysing" && (
            <div className="cta-block">
              <p>Pseudonymise this interview first, check the outgoing text, then release it to the cloud model.</p>
              <button className="btn" onClick={() => setTab("pseudo")}>
                Go to step 1
              </button>
            </div>
          )}
          {iv.analysis && (
            <>
              <div className="analysis-bar">
                <SourceBadge source={iv.analysisSource} mode="only_in_cloud" />
                <label className="switch">
                  <input type="checkbox" checked={showReal} onChange={(e) => setShowReal(e.target.checked)} />
                  <span>{showReal ? "Showing real names — re-identified on this device" : "Showing exactly what the cloud saw"}</span>
                </label>
              </div>
              <div className="card">
                <h3>Summary</h3>
                <p>
                  <TokenText text={iv.analysis.summary} codebook={study.codebook} showReal={showReal} />
                </p>
                <p className="muted">
                  <TokenText text={iv.analysis.participant_context} codebook={study.codebook} showReal={showReal} />
                </p>
              </div>
              <div className="themes">
                {iv.analysis.themes.map((t) => (
                  <div className="card theme" key={t.name}>
                    <h3>{t.name}</h3>
                    <p>
                      <TokenText text={t.description} codebook={study.codebook} showReal={showReal} />
                    </p>
                    {t.quotes.map((q, i) => (
                      <blockquote key={i} className="jump" onClick={() => jumpTo(q)} title="Show this moment in the transcript">
                        <TokenText text={q.quote} codebook={study.codebook} showReal={showReal} />
                        <cite>{q.timestamp ? `${q.timestamp} · ` : ""}show in transcript →</cite>
                      </blockquote>
                    ))}
                  </div>
                ))}
              </div>
              <div className="two">
                <div className="card">
                  <h3>Tensions</h3>
                  <ul>
                    {iv.analysis.tensions.map((x, i) => (
                      <li key={i}>
                        <TokenText text={x} codebook={study.codebook} showReal={showReal} />
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="card">
                  <h3>Follow-up questions</h3>
                  <ul>
                    {iv.analysis.follow_up_questions.map((x, i) => (
                      <li key={i}>
                        <TokenText text={x} codebook={study.codebook} showReal={showReal} />
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </>
          )}
          {reviewed && (
            <div className="card memo">
              <div className="memo-head">
                <h3>Quick memo</h3>
                <span className="muted small">Hybrid: runs on Gemini Nano when it's ready (free, works offline), otherwise in the cloud — safe either way, because it only ever sees pseudonymised text.</span>
                <button className="btn btn-small" onClick={() => veil.memo(iv.id)}>
                  Write memo
                </button>
              </div>
              {iv.memo !== undefined && (
                <>
                  {iv.memoSource && <SourceBadge source={iv.memoSource} mode="prefer_on_device" />}
                  <p className="memo-text">
                    <TokenText text={iv.memo} codebook={study.codebook} showReal={showReal} />
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
