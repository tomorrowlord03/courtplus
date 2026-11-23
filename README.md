# Court+

An AI-powered legal platform (Windows app + online AWS backend) for three users - **judges, lawyers and citizens** - that speeds up cases, makes evidence tamper-proof, and gives citizens a direct, safe channel to the court. AI only gives hints; the judge always decides.

**Team Cookie Eaters - Hack-a-Sol 5.0, IIIT Naya Raipur**

## The problem

India has about 3-4 crore pending cases. At today's speed the backlog would take hundreds of years to clear. On top of delay, there is mistrust: evidence can be suppressed or changed by middlemen, clerks or local pressure, and ordinary citizens do not know their rights or what to do.

## What Court+ is

One platform with three doors. Judges get hints, triage and a tamper-proof record of the hearing so they decide faster. Lawyers get settlement and case analysis. Citizens get a direct, even anonymous, tamper-proof channel to the judge and a plain-language guide to their rights. The AI never decides - the judge does.

## Core foundation: zero tampering and a direct bridge

1. **Cryptographic evidence vault.** Every uploaded file (photo, video, audio, document) gets a SHA-256 fingerprint, a timestamp and a digital signature the moment it arrives. Any later change - by anyone - is detected, and every action is kept in an audit log that cannot be secretly edited. The app prepares the Section 63 Bharatiya Sakshya Adhiniyam certificate for the electronic record.
2. **Direct citizen-to-judge bridge.** Citizens upload proof straight to the judge's portal, so raw, unedited facts reach the bench without middlemen.
3. **Anonymous whistleblower channel.** A citizen who fears threats can submit verified, tamper-proof evidence without revealing identity. The judge sees the authentic proof; the citizen gets a private receipt code to follow up.

## Features by user

### For judges
- Citizen evidence feed (normal + anonymous), tamper-checked.
- JAI (Justice Acceleration Index) smart triage: ranks cases by human impact and urgency (people in custody, elderly, women and children, national security) with the reasons shown.
- Adjournment analyzer: tracks delay patterns; when a party asks for 3 weeks, it checks the workload and suggests a realistic date.
- Backlog dashboard: cases filed vs cases resolved, disposal speed.
- Tamper-proof stenographer: records the hearing, writes the transcript and a summary on the computer, and stores the signed original audio.
- Drafting studio: orders, notices and judgments, digitally signed, in 13 Indian languages.
- Undertrial release check (BNSS s.479): finds prisoners eligible to apply for release, with the legal proof.
- Decision support *(in progress)*: AI suggests relevant legal sections (IPC/BNS) and similar past cases as hints - it never gives a verdict.
- Research engine *(in progress)*: fast search across past judgments and precedents.

### For lawyers
- Settlement and compensation analyzer (shared with judges): what courts awarded in similar past cases (divorce/maintenance, motor accident, property), the standard formulas (e.g. motor accident compensation), and Lok Adalat suggestion.
- Case analyzer: upload a case file; it summarises it, splits it into facts / arguments / reasoning, and flags procedural gaps to check.
- Tamper-proof filing: prepare papers and file signed evidence directly to the court record. AI precedent research is in progress.

### For citizens
- Direct-to-judge proof upload (with identity or anonymous).
- Legal rights guides: 14 topics in English and Hindi (road accidents, police refusing an FIR, domestic violence, arrest rights, free legal aid and more), each with the relevant law and step-by-step actions such as FIR, medical record and compensation claim.
- Legal rights and action advisor *(in progress)*: describe the problem in plain words (e.g. "I was injured in a road accident") and get the matching guide.
- Track my case shows the court office's recorded milestones and source pages. *(being integrated)*
- A settlement payment estimator for citizens calculates upfront payments, instalments and costs from the citizen's own entries. *(being integrated)*

## The AI - trained on old Indian cases

- **Base:** InLegalBERT, a language model pre-trained on Indian court judgments.
- **Already trained:** a legal entity model on the official InLegalNER dataset of real judgments (finds names, sections, courts, dates). Official test score 0.874 (the published research paper reports 0.810). Tested on 34 real Chhattisgarh High Court orders it never saw.
- **Now training** on old cases from the IL-TUR Indian legal benchmark and 1,200 real bail judgments:
  - Section suggestion: learns which statutes apply from the facts of tens of thousands of past cases.
  - Precedent search: learns which past judgments are relevant to a case.
  - Case structure: learns facts / arguments / reasoning parts of a judgment, used for summaries.
- **No made-up data:** training and demo use only real published cases.

Model details and measurements: [ml/ner/MODEL_CARD.md](ml/ner/MODEL_CARD.md) and [ml/ner/METRICS.md](ml/ner/METRICS.md).

## Safe and legal by design

- AI never decides or predicts the verdict; it only gives hints with sources. The judge decides.
- Every AI suggestion needs a human to confirm it.
- Personal details are masked; data is encrypted; every document is signed; every action is logged.
- Follows the Supreme Court's draft AI regulations (no AI risk scoring for bail).
- No real court records, evidence or model weights are stored in this repository.

## Status

**Built**
- Evidence vault, direct citizen-to-judge bridge and anonymous channel.
- JAI triage, adjournment analyzer and backlog dashboard.
- Tamper-proof hearing recorder with local transcription.
- Lawyer settlement / MACT calculator and case analyzer.
- Citizen rights guides (14 topics, English + Hindi).
- Glass UI with user profiles.
- Official data.gov.in court statistics.
- Windows app (Electron) with an encrypted local database; tamper-proof layer (SHA-256, digital signatures, QR code, verifier screen, hash-chained audit log); drafting studio with signed PDFs in 13 languages; trained legal entity model built into the app; undertrial release check with legal proof trace; online backend on AWS (Mumbai).

**In progress**
- Section suggestion, precedent search and case-structure models trained on IL-TUR and official eCourts judgments.
- Research engine and hints panel.
- Citizen advisor UI.
- Roles.

**Honest limits:** this is a hackathon build. AI output can be wrong or incomplete and is always shown as a hint for a person to check; interfaces and data formats may change.

## Build and run

Requires Node.js 22 or newer.

```bash
npm install
npm run build
npm test
```

Run the desktop app in development:

```bash
npm run dev -w @courtplus/desktop
```

The online backend lives in `apps/appliance` and is deployed with Docker Compose (`deploy/docker-compose.yml`). Step-by-step instructions for an EC2 instance in Mumbai are in [deploy/aws/README.md](deploy/aws/README.md). The speech model for the hearing recorder is downloaded at build time with `npm run asr-model -w @courtplus/desktop`.

More detail: [FEATURES.md](FEATURES.md), [docs/TECH_STACK.md](docs/TECH_STACK.md), [docs/CONTRACTS.md](docs/CONTRACTS.md) and [docs/LEGAL_RULES.md](docs/LEGAL_RULES.md).

## Data sources and licences

| Data | Source | Licence |
| --- | --- | --- |
| Court statistics (`data/stats/gov`, `data/stats/india.json`) | Open Government Data Platform India, [data.gov.in](https://www.data.gov.in) | Government Open Data License - India (GODL) |
| Prison and legal-aid figures (`data/stats/chhattisgarh.json`) | NCRB Prison Statistics India, NALSA UTRC reports, MHA parliamentary replies | Official public documents, cited per figure |
| Statutes, IPC-BNS crosswalk and rights guides (`data/crosswalk`, `data/guides`) | [India Code](https://www.indiacode.nic.in) and official gazette notifications | Public government text |
| Base language model | [InLegalBERT](https://huggingface.co/law-ai/InLegalBERT) | MIT |
| Entity model training data | [InLegalNER](https://huggingface.co/datasets/opennyaiorg/InLegalNER) | MIT |
| Bail judgments (benchmark and training, not stored here) | [IndianBailJudgments-1200](https://huggingface.co/datasets/SnehaDeshmukh/IndianBailJudgments-1200) | CC BY 4.0 |
| Old cases for the models in progress (not stored here) | [IL-TUR benchmark](https://aclanthology.org/2024.acl-long.618/) | CC BY-NC-SA 4.0, non-commercial research use |
| Official judgments for the models in progress (not stored here) | eCourts and High Court websites | Public court records |
| Speech recognition model (downloaded at build time) | Whisper, ONNX export from [onnx-community](https://huggingface.co/onnx-community) | MIT |
| Fonts | Noto fonts, Inter | SIL Open Font License |

## Team

**Team Cookie Eaters - Hack-a-Sol 5.0, IIIT Naya Raipur**
