# Baseline: Microsoft Presidio (spaCy en_core_web_lg + Presidio recognizers) on the same fictional interviews.
# Outputs replaced spans per interview, scored with Veil's own evaluate() afterwards.
import json, glob, sys
from presidio_analyzer import AnalyzerEngine
eng = AnalyzerEngine()
out = {}
for f in sorted(glob.glob("sample-data/*.json") + glob.glob("sample-data/holdout/*.json")):
    d = json.load(open(f))
    res = eng.analyze(text=d["transcript"], language="en")
    spans = sorted({(r.start, r.end, r.entity_type) for r in res if r.score >= 0.35})
    out[d["id"]] = [{"start": s, "end": e, "type": t} for s, e, t in spans]
    print(d["id"], len(spans), file=sys.stderr)
json.dump(out, open("eval/presidio_spans.json", "w"))
