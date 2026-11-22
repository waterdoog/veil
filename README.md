# Veil — pseudonymise on your device, analyse in the cloud

**Veil lets qualitative researchers use a cloud AI model on interview transcripts while the work of finding and removing participants' identities happens on their own laptop.**

Gemini Nano, running in Chrome through **Firebase AI Logic hybrid inference**, finds names, places, organisations, dates, contact details and rare identifying details *on the device*. Veil swaps each for a consistent placeholder (`[PERSON_1]`, `[ORG_4]`), shows the researcher exactly what will leave, re-scans every outgoing payload and blocks it if anything identifying slipped through, and only then sends the pseudonymised text to cloud Gemini for long-context thematic analysis. The results come back with placeholders, and Veil puts the real names back — on the researcher's screen only.

![Pseudonymising an interview on device: highlights on the raw transcript, placeholders in what the cloud will see](docs/1-pseudonymise-on-device.jpg)

Built for [#BuildHybridAI 2026](https://firebasehybridaihackathon.devpost.com/) · Web (Chrome) · Apache-2.0

---

## The problem

Interview research runs on consent forms and ethics approvals that promise participants their identities stay protected. Before a transcript can go anywhere near a third-party AI service, researchers typically have to pseudonymise it — by hand, line by line, for every interview. That is hours of work per transcript, it is error-prone, and it is the main reason many researchers can't use the AI tools everyone else uses.

The usual "local AI" answer doesn't solve it: a small on-device model can't do a good cross-interview thematic analysis of 60,000 characters of transcripts. The usual "cloud AI" answer can, but it means uploading identifiable data.

## How this differs from what researchers use today

| | Where identifiers are removed | AI analysis | Install |
|---|---|---|---|
| Dovetail, Condens, Marvin (research repositories) | Redaction runs **after upload**, in the vendor's cloud ([Dovetail](https://dovetail.com/changelog/automatic-redaction/), [Condens](https://condens.io/help/security-and-privacy/security-and-privacy-features/data-anonymization/), [Marvin](https://help.heymarvin.com/en/articles/10130399-how-do-i-mask-sensitive-and-personally-identifiable-information-pii-in-files)) | Yes, cloud | SaaS |
| ATLAS.ti / NVivo AI | Text is sent to a cloud model under no-training terms ([ATLAS.ti](https://atlasti.com/ai-data-security-and-privacy)) | Yes, cloud | Desktop |
| Microsoft Presidio, Private AI | Before sending — but you build/host the pipeline yourself ([Presidio](https://github.com/microsoft/presidio), [Private AI](https://docs.private-ai.com/what-is-privategpt)) | Bring your own | Python / container |
| **Veil** | **On the researcher's laptop, before anything is uploaded** (Gemini Nano + patterns + review + airlock) | Yes — cloud Gemini on pseudonymised text only | Open a web page |

Pseudonymised text is still personal data under GDPR — Veil reduces what reaches a cloud service and documents it for an ethics committee; it doesn't make data anonymous.

## The idea: split the trust, not just the workload

Most hybrid apps use the on-device model as a cheaper or offline *substitute* for the cloud. Veil uses the two models for **different jobs that need different levels of trust, at the same time, even with perfect connectivity**:

| Job | Sees | Firebase AI Logic mode | Why |
|---|---|---|---|
| Find identifiers in the raw transcript | identifiable text | `ONLY_ON_DEVICE` | Raw text must never leave. If Nano isn't available, Veil **fails closed** — it never falls back to the cloud with raw data. |
| Second check of the pseudonymised text (strict policy) | pseudonymised text | `ONLY_ON_DEVICE` | Catch what the first pass missed before release. |
| Read a photo of handwritten field notes | image of identifiable notes | `ONLY_ON_DEVICE` (text + image input) | Photos of notes are as sensitive as transcripts. |
| Thematic analysis of one interview | pseudonymised text | `ONLY_IN_CLOUD` | Needs a large model and long context. |
| Cross-interview synthesis | all pseudonymised transcripts (~60k chars) | `ONLY_IN_CLOUD` | Far beyond Nano's ~9k-token window. |
| Quick analytic memo | pseudonymised text | `PREFER_ON_DEVICE` | Free and offline when Nano is there; cloud fallback is safe because the input is already pseudonymised. |

Every call records `response.inferenceSource`, so the **Airlock log** shows, for each request, the mode Veil asked for, where inference actually ran, and the exact text that left the device.

```mermaid
flowchart LR
  subgraph Device["This laptop (Chrome)"]
    R[Raw transcript<br/>IndexedDB only] --> N["Gemini Nano<br/>ONLY_ON_DEVICE<br/>+ pattern detectors"]
    N --> C[Codebook<br/>real ↔ token<br/>IndexedDB only]
    C --> P[Pseudonymised text]
    P --> A{Airlock<br/>re-scan every payload}
    A -- blocked --> R
    O[Cloud output with tokens] --> H[Re-identify locally<br/>for display]
  end
  A -- passes --> G["Gemini (cloud)<br/>ONLY_IN_CLOUD"]
  G --> O
  P --> F[(Firestore:<br/>pseudonymised text + analysis only)]
```

## What it does

- **Pseudonymise on device.** Transcripts are chunked to fit Nano's prompt budget; Nano returns identifiers as structured JSON (Prompt API `responseConstraint`). Deterministic detectors catch fixed-shape identifiers (emails, UK and US phone numbers, postcodes and ZIP+4, street addresses, NHS-style numbers, SSNs and other reference numbers, specific dates). If Nano finds a first name, Veil also catches "First Surname".
- **Consistent placeholders across a study.** Organisations and places get the same token in every interview, so the cloud's cross-case analysis lines up. People are scoped per interview (two participants' "Gareth" are different people).
- **Review like a researcher.** Highlights in the raw text; click a highlight to keep that text; select any text to redact it by hand; a codebook table with on/off switches. Merge two placeholders that turn out to be the same person or place. Two policies: *Standard* keeps health details (often the research data itself) and *Strict* removes them too and adds a second on-device pass.
- **The airlock.** Right before *any* cloud request, Veil re-scans the payload against every codebook value and identifier pattern — including the interview title, which is user-written and often contains a name. One hit and the request is blocked, with a one-click "Redact these".
- **Cloud analysis, re-identified locally.** Reflexive thematic analysis (themes, verbatim quotes with timestamps, tensions, follow-up questions) per interview, plus a cross-interview synthesis. A switch flips between "real names (re-identified on this device)" and "exactly what the cloud saw".
- **Offline.** Pseudonymisation works with no connection. Cloud requests made offline are queued and sent when the connection returns; Firestore's offline cache syncs results.
- **Ethics audit pack.** One click exports (a) an audit report for an ethics committee with no identifiable data — policy, how each interview was checked, identifiers replaced per type, airlock blocks, and a SHA-256 of every payload that left the device; (b) the pseudonymised dataset as Markdown and the coded quotes as CSV (for NVivo, ATLAS.ti, MAXQDA or a spreadsheet); (c) the codebook key, behind a warning, for secure storage.
- **Research questions.** A study's research questions steer the cloud analysis and synthesis — and go through the codebook and airlock, since they often name a site.
- **Quotes link back.** Click any quote in the cloud analysis to jump to that moment in the raw transcript.
- **Bring your own transcripts.** Paste text or upload `.txt`, `.vtt` (Zoom/Teams captions) or `.docx` — parsed in the browser, never uploaded. UK and US identifier formats are detected (phones, postcodes/ZIP+4, NHS/SSN-style numbers, street addresses).
- **Setup check.** A built-in panel tells you whether this browser can run Gemini Nano (Chrome version, Prompt API, text and image availability) and gives the exact `chrome://` flags to copy.
- **Measured, not claimed.** The bundled sample study (six entirely fictional interviews) ships with an answer key of every identifier, and Veil shows the share of identifiers removed for each interview, with the misses one click away.

### Measured on real Gemini Nano

Desktop Chrome 158, Gemini Nano via Firebase AI Logic (`ONLY_ON_DEVICE`), scored against answer keys of every identifier in fictional interviews. **Recall** = share of answer-key identifiers fully replaced; **precision** = share of replacements that are answer-key identifiers.

| Set | Build | Recall | Precision |
|---|---|---|---|
| **Held-out** — 4 interviews (US/UK/Ireland, UX/education/social care), never used for tuning | first look | 115 / 149 = **77.2%** | 96.8% |
| Held-out | after general fixes informed by those misses (titled names, $ amounts, ages, org acronyms) | 131 / 149 = **87.9%** | 97.1% |
| Development — 6 Long COVID interviews, used for tuning | first build | 214 / 265 = 80.8% | — |
| Development | current | 238 / 265 = **89.8%** | 90.2% |
| Development, Strict policy (also health terms, second on-device pass) | | 276 / 338 = 81.7% | — |

**Baseline — Microsoft Presidio** (open-source PII detector, default configuration with spaCy `en_core_web_lg`, scored with the same code on the same interviews): held-out recall **60.4%** at **53.4%** precision; development 53.2% / 57.6%. Presidio finds people very well (51/51 on held-out) but almost none of the organisations, money amounts or quasi-identifiers that make an interview participant recognisable. Script: `planning/presidio_baseline.py` in our working repo; spans and scoring reproduced in `tests`-style code (`src/core/evaluate.ts`).

The six-interview study pseudonymises in about 4–5 minutes on a MacBook, entirely on device; the airlock found no known identifier in any outgoing payload in any run. What Nano still misses is mostly quasi-identifiers — a rare hobby, an unusual job description, a small place name — which is why Veil keeps the human review step and shows every miss. Nano is not deterministic: a few items caught in one run are missed in the next.

**No Gemini Nano in your browser?** Click **Replay a recorded Nano run**: the sample study loads with the detections real Gemini Nano made in Chrome 158 (clearly labelled as recorded), and review, the airlock and cloud analysis run live.

| Cloud analysis, re-identified on this device | Exactly what the cloud saw |
|---|---|
| ![](docs/2-cloud-analysis-reidentified-locally.jpg) | ![](docs/3-what-the-cloud-saw.jpg) |

## Firebase products used

| Product | How Veil uses it | Code |
|---|---|---|
| **Firebase AI Logic** (hybrid inference, Gemini Developer API backend) | Six model instances across `ONLY_ON_DEVICE`, `ONLY_IN_CLOUD`, `PREFER_ON_DEVICE`; `initializeDeviceModel` with download progress; structured output on device (`responseConstraint`) and in cloud (`responseSchema`); streaming; `inferenceSource` | [`src/ai/backend.ts`](src/ai/backend.ts) |
| **App Check** | Required by AI Logic; reCAPTCHA Enterprise in production, debug provider in development | [`src/firebase.ts`](src/firebase.ts) |
| **Authentication** | Anonymous sign-in, so each researcher's Firestore data is private to them | [`src/firebase.ts`](src/firebase.ts) |
| **Cloud Firestore** | Stores only pseudonymised text and analysis; offline persistence. Security rules also reject interview text containing an email, a UK mobile, a US SSN or a US phone number — a last-ditch backstop against bad writes, not the privacy mechanism (the airlock runs before anything is sent) | [`src/store/cloud.ts`](src/store/cloud.ts), [`firestore.rules`](firestore.rules) |
| **Remote Config** | Cloud model name, default redaction policy, on-device chunk size — changeable without a redeploy | [`src/firebase.ts`](src/firebase.ts), [`remoteconfig.template.json`](remoteconfig.template.json) |
| **Hosting** | Serves the app | [`firebase.json`](firebase.json) |

What never touches Firebase or any server: raw transcripts, photos of notes, and the codebook (all in IndexedDB, [`src/store/local.ts`](src/store/local.ts)).

## Try it

**Hosted:** https://veil-hybrid-29fb6.web.app — desktop Chrome 139+ with Gemini Nano for the live on-device path. **No Nano?** The first button on the page loads the sample study with a recorded real Gemini Nano run; everything else runs live.

1. Enable `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`, restart Chrome.
2. Open Veil and click **Set up on-device model** (one-time download, stays on your machine).
3. Click **Load the sample study** → open an interview → **Pseudonymise on this device**.
4. Review the highlights, check the airlock, then **Release to cloud analysis**.
5. Open **Cross-interview synthesis**, and the **Airlock log** to see where every call ran and what left the device.
6. Click **Test the airlock**: Veil slips a real name back into the outgoing text and shows the airlock blocking it (nothing is sent).
7. To see it fail closed, open Veil in a browser without Gemini Nano: pseudonymisation falls back to pattern detection + manual redaction, never to the cloud, and release stays locked until you confirm a manual review.

If the chip says "On-device model unavailable" in Chrome 139+: check `chrome://on-device-internals` for the model status, make sure the flag above is enabled, and on some machines also set `chrome://flags/#optimization-guide-on-device-model` to *Enabled BypassPerfRequirement*. Veil's **check setup** panel walks through each requirement. Chrome only downloads Gemini Nano when the profile drive has at least 22 GB free (the model itself is much smaller) and the machine has a supported GPU or enough RAM — see Chrome's Prompt API docs.

The sample interviews in [`sample-data/`](sample-data) are entirely fictional, generated for testing; phone numbers use Ofcom's drama range and emails use `example.com`.

## Run locally

```bash
npm install
cp .env.example .env   # fill in your Firebase web app config
npm run dev            # http://localhost:5180
npm test               # unit tests: pseudonymisation, airlock, chunking, evaluation, exports, .docx
```

Firebase setup:

1. Create a Firebase project → **AI Services → AI Logic → Get started** → choose the **Gemini Developer API** (no billing needed). This also enforces App Check for AI Logic.
2. Add a **Web app**, copy its config into `.env`.
3. **Authentication** → enable **Anonymous**. **Firestore** → create a database. 
4. **App Check** → enable the reCAPTCHA Enterprise API, create a web key for your Hosting domains, and register the web app with the **reCAPTCHA Enterprise** provider (put the site key in `VITE_RECAPTCHA_SITE_KEY`). For localhost, run `npm run dev`, copy the debug token printed in the console and add it under App Check → Manage debug tokens. Never commit it.
5. `npx firebase-tools deploy --only firestore:rules,remoteconfig,hosting` (after `npm run build`).

## Honest limits

- On-device inference needs desktop Chrome 139+ with the Prompt API; Nano's quality is lower than a cloud model's, which is why Veil adds deterministic detectors, a second pass, a human review step and the airlock rather than trusting one model.
- Pseudonymisation is not anonymisation: rich qualitative data can be re-identifiable from context. Veil reduces the work and the risk; the researcher still reviews and stays responsible to their ethics approval.
- The airlock checks for identifiers Veil knows about (codebook + patterns). It cannot catch an identifier no detector and no reviewer ever flagged — which is why the human review step exists and why Veil reports how many identifiers it removed on the answer-keyed sample.
- `deviceStatus()` reads Chrome's `LanguageModel.availability()` directly, only to show model status in the header before any click; every inference call goes through Firebase AI Logic. If the SDK doesn't report `inferenceSource`, the log says "source not reported" rather than guessing.

## Built during #BuildHybridAI

Everything in this repository was written during the submission period (work started 2026-11-21; the period opened 2026-11-11). The team builds [aicoo](https://www.aicoo.io), an AI workspace with meeting recording and transcription; Veil is a new, separate, open-source app and contains no aicoo code. Development used Claude Code as the coding assistant. Third-party code: React, Vite, the Firebase JS SDK (all via npm, under their own licences).

## Licence

[Apache-2.0](LICENSE)
