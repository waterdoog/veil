import { Fragment, type ReactNode } from "react";
import { realFor } from "../core/codebook";
import type { CodebookEntry, EntityType, Span } from "../core/types";

export const TYPE_LABEL: Record<EntityType, string> = {
  PERSON: "Person",
  ORG: "Organisation",
  LOCATION: "Place",
  DATE: "Date",
  CONTACT: "Contact",
  ID: "Reference no.",
  HEALTH: "Health",
  FINANCIAL: "Money",
  QUASI: "Quasi-identifier",
};

export function SourceBadge({ source, mode }: { source?: "on_device" | "in_cloud" | "unknown"; mode?: string }) {
  if (!source && !mode) return null;
  if (source === "unknown") return <span className="badge" title={mode ? `Requested mode: ${mode}` : undefined}>source not reported</span>;
  const s = source ?? (mode === "only_in_cloud" ? "in_cloud" : "on_device");
  return (
    <span className={`badge ${s === "on_device" ? "badge-device" : "badge-cloud"}`} title={mode ? `Requested mode: ${mode}` : undefined}>
      {s === "on_device" ? <DeviceIcon /> : <CloudIcon />}
      {s === "on_device" ? "on device · Gemini Nano" : "in cloud · Gemini"}
    </span>
  );
}

export function DeviceIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}
export function CloudIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
      <path d="M7 18a5 5 0 1 1 .9-9.9A6 6 0 0 1 19 10a4 4 0 0 1-1 8z" />
    </svg>
  );
}
export function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

/** Raw transcript with each redacted span highlighted. Clicking a span switches that detection off. */
export function HighlightedText({
  text,
  spans,
  onToggle,
}: {
  text: string;
  spans: Span[];
  onToggle?: (token: string, real: string) => void;
}) {
  const out: ReactNode[] = [];
  let last = 0;
  spans.forEach((s, i) => {
    if (s.start > last) out.push(<Fragment key={`t${i}`}>{text.slice(last, s.start)}</Fragment>);
    const real = text.slice(s.start, s.end);
    out.push(
      <mark
        key={`m${i}`}
        className={`hl hl-${s.type}`}
        title={`${TYPE_LABEL[s.type]} → ${s.token}${onToggle ? " · click to keep this text" : ""}`}
        onClick={onToggle ? () => onToggle(s.token, real) : undefined}
      >
        {real}
      </mark>,
    );
    last = s.end;
  });
  if (last < text.length) out.push(<Fragment key="end">{text.slice(last)}</Fragment>);
  return <>{out}</>;
}

/** Model output with placeholders. Shows real values (re-hydrated on this device) or the tokens the cloud saw. */
export function TokenText({ text, codebook, showReal }: { text: string; codebook: CodebookEntry[]; showReal: boolean }) {
  const parts = text.split(/(\[[A-Z]+_\d+\])/g);
  return (
    <>
      {parts.map((p, i) => {
        if (!/^\[[A-Z]+_\d+\]$/.test(p)) return <Fragment key={i}>{p}</Fragment>;
        const real = realFor(p, codebook);
        const type = p.slice(1).split("_")[0] as EntityType;
        if (showReal && real)
          return (
            <span key={i} className={`rehydrated hl-${type}`} title={`Re-identified on this device (cloud saw ${p})`}>
              {real}
            </span>
          );
        return (
          <span key={i} className={`token hl-${type}`} title={real ? "Real value stays on this device" : undefined}>
            {p}
          </span>
        );
      })}
    </>
  );
}

export function Progress({ done, total, label }: { done: number; total: number; label: string }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className="progress-label">
        <span>{label}</span>
        <span>
          {done}/{total}
        </span>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Transcript rendered one line per element, so a quote's timestamp can be scrolled to and highlighted. */
export function LinedTranscript({
  text,
  spans,
  onToggle,
  flash,
}: {
  text: string;
  spans: Span[];
  onToggle?: (token: string, real: string) => void;
  flash?: number | null;
}) {
  const lines = text.split("\n");
  let offset = 0;
  return (
    <>
      {lines.map((line, i) => {
        const start = offset;
        const end = start + line.length;
        offset = end + 1;
        const local = spans
          .filter((s) => s.start < end && s.end > start)
          .map((s) => ({ ...s, start: Math.max(0, s.start - start), end: Math.min(line.length, s.end - start) }));
        return (
          <div key={i} data-line={i} className={`tline ${turn(line, local) ? "turn" : ""} ${flash === i ? "flash" : ""}`}>
            {line ? <Line text={line} spans={local} onToggle={onToggle} /> : " "}
          </div>
        );
      })}
    </>
  );
}

/** Find the transcript line a quote came from: by timestamp first, then by its opening words. */
export function findQuoteLine(raw: string, quote: { quote: string; timestamp?: string }, rehydrated: string): number | null {
  const lines = raw.split("\n");
  if (quote.timestamp) {
    const ts = quote.timestamp.replace(/[[\]]/g, "").trim();
    const i = lines.findIndex((l) => l.includes(`[${ts}]`) || l.startsWith(ts));
    if (i >= 0) return i;
  }
  const words = rehydrated.replace(/[“”"…]|\.\.\./g, " ").trim().split(/\s+/);
  for (const n of [8, 5, 3]) {
    if (words.length < n) continue;
    const probe = words.slice(0, n).join(" ").toLowerCase();
    const i = lines.findIndex((l) => l.toLowerCase().replace(/\s+/g, " ").includes(probe));
    if (i >= 0) return i;
  }
  return null;
}

/** "[00:01:12] P: ..." — timestamps and speaker tags are structure, not prose; set them apart (when no identifier sits inside them). */
const TURN = /^(\[\d{1,2}:\d{2}(?::\d{2})?\])(\s*)([A-Z][A-Za-z]{0,11}:)?(\s*)/;
function turn(line: string, spans: Span[]) {
  const m = line.match(TURN);
  return m && !spans.some((s) => s.start < m[0].length) ? m : null;
}
function Line({ text, spans, onToggle }: { text: string; spans: Span[]; onToggle?: (token: string, real: string) => void }) {
  const m = turn(text, spans);
  if (!m) return <HighlightedText text={text} spans={spans} onToggle={onToggle} />;
  const n = m[0].length;
  return (
    <>
      <span className="ts">{m[1]}</span>
      {m[3] && <span className="who">{m[3]}</span>}{" "}
      <HighlightedText text={text.slice(n)} spans={spans.map((s) => ({ ...s, start: s.start - n, end: s.end - n }))} onToggle={onToggle} />
    </>
  );
}
