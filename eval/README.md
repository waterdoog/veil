# Baseline: Microsoft Presidio

1. `pip install presidio-analyzer spacy` and the `en_core_web_lg` model.
2. From the repo root: `python eval/presidio_baseline.py` → `presidio_spans.json` (move it to `eval/`).
3. `npx vite-node eval/score_presidio.ts` — scores Presidio's spans with Veil's own `evaluate()` (same answer keys, Standard-policy types).

Result (Presidio default configuration, score ≥ 0.35): held-out recall 90/149 = 60.4%, precision 53.4%; development recall 141/265 = 53.2%, precision 57.6%.

Fair configuration (spaCy ORG → ORGANIZATION, MONEY enabled): `python eval/presidio_fair.py` → held-out recall 121/149 = 81.2%, precision 66.7%; development 72.8% / 67.2%.
