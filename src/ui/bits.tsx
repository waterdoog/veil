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
