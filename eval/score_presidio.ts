import { readFileSync, readdirSync } from "node:fs";
import { evaluate } from "../src/core/evaluate";
import { POLICIES } from "../src/core/types";
const base = new URL("../", import.meta.url).pathname;
const spans = JSON.parse(readFileSync(base + "eval/presidio_spans.json", "utf8"));
const sets = { dev: base + "sample-data/", holdout: base + "sample-data/holdout/" };
for (const [name, dir] of Object.entries(sets)) {
  let tot = 0, cau = 0, sp = 0, tp = 0; const byType: Record<string, [number, number]> = {};
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const d = JSON.parse(readFileSync(dir + f, "utf8"));
    const s = (spans[d.id] ?? []).map((x: any) => ({ start: x.start, end: x.end, token: "", type: "PERSON" }));
    const r = evaluate(d.transcript, s, d.identifiers, POLICIES.standard.redact);
    tot += r.total; cau += r.caught; sp += r.spans; tp += Math.round(r.precision * r.spans);
    for (const [t, v] of Object.entries(r.byType)) { byType[t] ??= [0, 0]; byType[t][0] += v.caught; byType[t][1] += v.total; }
  }
  console.log(name, `recall ${cau}/${tot} = ${(100 * cau / tot).toFixed(1)}%`, `precision ${tp}/${sp} = ${(100 * tp / sp).toFixed(1)}%`, JSON.stringify(byType));
}
