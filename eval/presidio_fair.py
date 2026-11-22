import json, glob, sys
from presidio_analyzer import AnalyzerEngine, RecognizerRegistry
from presidio_analyzer.nlp_engine import NlpEngineProvider
conf = {"nlp_engine_name": "spacy", "models": [{"lang_code": "en", "model_name": "en_core_web_lg"}],
        "ner_model_configuration": {"model_to_presidio_entity_mapping": {"PERSON": "PERSON", "PER": "PERSON", "ORG": "ORGANIZATION", "GPE": "LOCATION", "LOC": "LOCATION", "FAC": "LOCATION", "DATE": "DATE_TIME", "NORP": "NRP", "MONEY": "MONEY"},
                                     "labels_to_ignore": ["CARDINAL", "ORDINAL", "QUANTITY", "PERCENT", "TIME", "PRODUCT", "EVENT", "WORK_OF_ART", "LAW", "LANGUAGE"]}}
nlp = NlpEngineProvider(nlp_configuration=conf).create_engine()
eng = AnalyzerEngine(nlp_engine=nlp, supported_languages=["en"])
ents = eng.get_supported_entities() + ["ORGANIZATION", "MONEY"]
out = {}
for f in sorted(glob.glob("sample-data/*.json") + glob.glob("sample-data/holdout/*.json")):
    d = json.load(open(f))
    res = eng.analyze(text=d["transcript"], language="en", entities=list(set(ents)))
    out[d["id"]] = [{"start": r.start, "end": r.end, "type": r.entity_type} for r in res if r.score >= 0.35]
json.dump(out, open("eval/presidio_fair_spans.json", "w"))
print("ok", sum(len(v) for v in out.values()))
