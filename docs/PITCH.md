# Court+ Pitch: Hack-a-Sol 5.0, IIIT Naya Raipur

**Track:** Cybersecurity, with civic impact. **Prepared:** 23 November 2026.  
**Team:** **Team Cookie Eaters**, Hack-a-Sol 5.0, IIIT Naya Raipur.

**Sources:** Every statistic cited below comes directly from official government databases and publications:
- `data/stats/india.json`: Open Government Data Platform India (data.gov.in) official datasets on High Court pendency, District Court 10-year pendency, High Court judge vacancies, National Lok Adalat disposals, Motor Accident Claims Tribunal (MACT) pendency, and undertrial duration.
- `data/stats/chhattisgarh.json`: National Crime Records Bureau (NCRB) Prison Statistics India (PSI-2024), NALSA Undertrial Review Committee (UTRC) official reports, and Ministry of Home Affairs (MHA) parliamentary returns.
- Official Supreme Court judgments and statutory provisions from indiacode.nic.in.
- Machine learning benchmarks from `ml/ner/METRICS.md` and `ml/oldcases/METRICS.md`.

**Ethical & Language Rules for Presenters:**
- Always say: "could apply", "screen", "route for human review", and "draft for an authorized officer to verify and sign".
- Never say: "guaranteed", "entitled", "AI decides", "admissible", or "predicts".
- Court+ never predicts bail outcomes, verdicts, or recidivism risk scores. All AI outputs are explicitly labelled: "Hint — the judge decides".

---

## 1. Pitch Slides (5 Minutes)

### Slide 1: The Problem — India's Backlog and the Human Cost

**Headline:** India's courts carry about 5.6 crore pending cases (NJDG / Parliament replies, 2026: 4.98 crore district courts, 63.76 lakh High Courts, about 97,000 Supreme Court). The system is choked at every tier, from district courts to High Courts.

**Official Sourced Statistics:**
- **63,96,737 cases pending across all High Courts in India** as of 25 March 2026.  
  *(Source: High Court-wise Number of Pending Cases in High Courts as per National Judicial Data Grid (NJDG) as on 25-03-2026, Open Government Data Platform India (data.gov.in), updated 2026-10-17)*
- **75,525 cases pending in the High Court of Chhattisgarh** as of 25 March 2026.  
  *(Source: High Court-wise Number of Pending Cases in High Courts as per National Judicial Data Grid (NJDG) as on 25-03-2026, Open Government Data Platform India (data.gov.in), updated 2026-10-17)*
- **52,56,293 cases pending for over 10 years in District and Subordinate Courts across India** as of 27 March 2026.  
  *(Source: State/UT-wise Number of Cases Pending for 10 years in District and Subordinate Courts as on 27-03-2026, Open Government Data Platform India (data.gov.in), updated 2026-10-17)*
- **1,166 cases pending for over 10 years in District Courts of Chhattisgarh** as of 27 March 2026.  
  *(Source: State/UT-wise Number of Cases Pending for 10 years in District and Subordinate Courts as on 27-03-2026, Open Government Data Platform India (data.gov.in), updated 2026-10-17)*
- **308 High Court judge posts vacant across India** out of 1,122 sanctioned strength as of 30 January 2026.  
  *(Source: High Court-wise Number of Sanctioned Strength, Working Strength, Vacancies of Judges in the High Courts as on 30-01-2026, Open Government Data Platform India (data.gov.in), updated 2026-10-17)*
- **7 High Court judge posts vacant in Chhattisgarh** out of 22 sanctioned strength as of 30 January 2026.  
  *(Source: High Court-wise Number of Sanctioned Strength, Working Strength, Vacancies of Judges in the High Courts as on 30-01-2026, Open Government Data Platform India (data.gov.in), updated 2026-10-17)*
- **12,478 undertrial prisoners in Chhattisgarh**, comprising **66.4% of all 18,798 inmates**, in prisons operating at **127.6% capacity** (14,733 places) as of 31 December 2024.  
  *(Source: NCRB, Prison Statistics India 2024, Tables 1.2 and 6.4)*
- **3,663 undertrials in Chhattisgarh detained for more than 1 year** as of 31 December 2023.  
  *(Source: State/UT-wise Number of Undertrial Prisoners with Duration of Confinement as on 31-12-2023, Open Government Data Platform India (data.gov.in), updated 2026-10-16)*
- **10,73,020 Motor Accident Claims pending before tribunals across India** (2024-25) involving ₹96,25,712 lakh in claims.  
  *(Source: Year-wise Details of Total Number and Amount of Motor Accident Claims Pending Before Claims Tribunals from 2020-21 to 2024-25, Open Government Data Platform India (data.gov.in), updated 2026-10-17)*
- **14,84,25,050 cases disposed in National Lok Adalats in 2025**, proving the immense appetite for pre-trial and settlement mechanisms.  
  *(Source: Year-wise Number of Disposal of Cases in National Lok Adalats from 2021 to 2025, Open Government Data Platform India (data.gov.in), updated 2026-10-14)*

**Speaker Note:** Do not invent or round these numbers. The 52 lakh 10-year-old district court cases represent generations waiting for justice. Two in three prisoners in our home state have not been convicted of any crime. The judicial bottleneck is aggravated by high vacancy rates, while over 10 lakh road accident victims wait for compensation.

---

### Slide 2: Why Now? The Legal & Technological Turning Point

**Headline:** India's legal landscape is undergoing its biggest transformation in 150 years.

- **The New Bharatiya Laws (July 2024 onwards):**
  - **Bharatiya Nagarik Suraksha Sanhita (BNSS), 2023:** Section 479 introduces a mandatory duty on jail superintendents to apply for bail for undertrials who have served one-third (first-timers) or one-half of maximum sentences. Section 346 mandates day-to-day criminal proceedings.
  - **Bharatiya Sakshya Adhiniyam (BSA), 2023:** Section 63 replaces old IEA Section 65B, introducing strict statutory admissibility criteria and a mandatory Schedule certificate (Part A & Part B) for all electronic evidence.
  - **Bharatiya Nyaya Sanhita (BNS), 2023:** Runs concurrently with IPC in pending trials, requiring seamless statutory crosswalks.
- **Supreme Court Draft Regulations for Use of AI in Courts (3 June 2026):**
  - **Rule 19(1)(i):** Authorizes AI for document anonymisation, transcription, legal research, and workflow assistance.
  - **Rule 20(1)(d):** Strictly prohibits AI from predicting judicial decisions, assessing bail risk, or generating verdicts.
- **eCourts Phase III:** Demands digital-first infrastructure connecting police stations, prisons, legal-aid defense counsel, and court registries into a single auditable workflow.

**Speaker Note:** Technology cannot just be bolted on; it must comply strictly with the law. BSA Section 63 makes cryptographic provenance mandatory. The draft AI regulations give us clear ethical boundaries: assist with research, transcription, and workflow, but never predict or decide.

---

### Slide 3: Court+ in One Line

**Headline:** An AI legal platform for Judges, Lawyers, and Citizens to cut India's case backlog through verifiable evidence, transparent triage, and procedural intelligence.

- **For Judges:** Smart docket triage, adjournment analysis, offline speech-to-text hearing transcription, and tamper-evident evidence handling.
- **For Lawyers:** Deep case analysis, procedural compliance checklists, deterministic MACT/maintenance calculators, and precedent discovery.
- **For Citizens:** One-in-one-out plain-language legal rights guides, direct mobile evidence submission, and transparent case tracking.
- **Architecture:** Standalone, offline-capable Windows desktop application paired with an optional secure cloud backend on AWS Mumbai (`ap-south-1`).

**Speaker Note:** Court+ is not a generic chatbot or a speculative tech demo. It is a comprehensive judicial workstation designed for the realities of Indian courtrooms: poor connectivity, strict statutory rules, and overburdened officers.

---

### Slide 4: The Foundation: Evidence Vault & Citizen-to-Judge Bridge

**Headline:** Cryptographic evidence integrity from citizen smartphone to the judge's bench.

- **Tamper-Evident Evidence Vault:**
  - Files (documents, photos, audio, video up to 50 MB) are verified with magic bytes and hashed with **SHA-256** upon intake.
  - Timestamped and signed with an **Ed25519** digital signature over canonical RFC 8785 JSON.
  - Appended to a tamper-evident, append-only **hash-chained audit ledger** (`prevHash` → `entryHash`).
  - Stored encrypted at rest using **AES-256-GCM**.
- **Bharatiya Sakshya Adhiniyam (BSA) 2023 Section 63 Certificate:**
  - One-click automated generation of the statutory electronic record certificate.
  - Pre-fills the Schedule format: Part A for the submitter and Part B for system cryptographic integrity (SHA-256 hash value, timestamp, system metadata).
- **Direct Citizen-to-Judge Bridge:**
  - Citizens upload proof directly via a mobile-optimized web portal (`/submit`).
  - Verified evidence flows straight to the presiding judge's **Evidence Inbox** with an "Unchanged since upload" integrity badge.
- **Identity-Blind Anonymous Channel:**
  - Whistleblowers and victims can submit sensitive evidence without revealing identity.
  - No names, phone numbers, IP addresses, or tracking cookies are stored.
  - Issues a one-time random 128-bit receipt code (only its SHA-256 digest is stored) for anonymous status tracking.

**Speaker Note:** In traditional court proceedings, electronic evidence is routinely challenged for broken chain of custody. Court+ solves this cryptographically at source. The judge sees an instant badge: "Unchanged since upload", and exports a ready-to-sign Section 63 certificate.

---

### Slide 5: Court+ for Judges: Triage, Adjournments & Stenographer

**Headline:** Freeing judicial time to hear urgent matters and eliminate procedural delays.

- **Smart Triage (JAI — Justice Acceleration Index):**
  - Deterministic 0 to 100 priority score computed strictly from verifiable statutory factors.
  - Factor weights: Article 21 / BNSS Section 479 custody status, vulnerable litigants (senior citizens, women, children, disability), case age buckets (matching NJDG ageing categories), national security statutes, and statutory limits (e.g. NI Act s.143(3) six-month mandate).
  - Every score displays itemized reason chips with clickable statute links.
  - **Judicial Override:** Judges can pin matters up or down with a recorded reason, committed to the audit log.
  - **Automated Cause List:** Automatically generates tomorrow's daily cause list (e.g., 40 matters) balancing urgent priorities with a mandatory quota for the oldest pending cases; exportable to PDF.
- **Adjournment Analyzer:**
  - Automatically tracks adjournment history per case and per party.
  - Checks statutory ceilings: **CPC Order XVII Rule 1 proviso** (maximum 3 adjournments per party in civil suits) and **BNSS Section 346** (day-to-day proceedings).
  - Inspects real docket capacity and suggests the earliest viable hearing date (e.g., *"Requested 21 days → Suggested 14 days based on courtroom capacity"*).
- **Tamper-Evident AI Stenographer:**
  - Offline live hearing recording with crash-safe WebM/Opus streaming.
  - In-hearing marker taps for speaker roles (Judge, Petitioner Counsel, Respondent Counsel, Witness).
  - Local speech-to-text transcription via Whisper ONNX (English + Hindi) running on CPU.
  - Cryptographic locking: SHA-256 digest and Ed25519 signature make the audio tamper-evident: any later change is detected.
  - Extractive summary of orders, witness statements, and next dates, exportable with verification QR codes.

**Speaker Note:** Notice the philosophy: no machine-learned black-box score decides a human being's case. JAI is transparent arithmetic quoting the law. The Adjournment Analyzer cuts down the cycle of endless routine adjournments that drives India's 52 lakh 10-year pendency.

---

### Slide 6: Court+ for Lawyers: Case Analyzer & Settlement Analyzer

**Headline:** Empowering advocates with procedural checklists and scientific valuation tools.

- **Case Analyzer:**
  - Instant intake of chargesheets, bail applications, and orders.
  - Rhetorical Role breakdown: automatically segments text into Facts, Issues, Arguments, Precedents, Statutes, and Reasoning.
  - Identifies legal entities and masks party names for privacy.
  - **Procedural Gaps & Weak Points Checklist:**
    - Checks mandatory compliance with arrest procedures for offences under 7 years (*Arnesh Kumar v. State of Bihar*, 2014; BNSS appearance notice).
    - Checks written communication of arrest grounds (*Pankaj Bansal*, 2023; *Prabir Purkayastha*, 2024).
    - Flags statutory default bail eligibility upon chargesheet delay (BNSS Section 187(3)).
    - Flags missing electronic evidence certificates under BSA Section 63 (*Arjun Panditrao Khotkar*, 2020).
    - Checks public servant prosecution sanction and limitation periods under Limitation Act, 1963.
- **Settlement & Compensation Analyzer:**
  - **Motor Accident Claims (MACT):** Exact, line-by-line deterministic implementation of Supreme Court landmark formulas:
    - *Sarla Verma v. DTC* (2009): multiplier tables and personal living expense deductions.
    - *National Insurance Co. v. Pranay Sethi* (2017): future prospects additions and conventional heads with periodic percentage increases.
    - *Raj Kumar v. Ajay Kumar* (2011): permanent disability and loss of earning capacity.
  - **Maintenance Guidance:** Evaluates disclosure criteria under *Rajnesh v. Neha* (2020) and the 25% net income benchmark in *Kalyan Dey Chowdhury v. Rita Dey* (2017).
  - **Past Awards Context:** Retrieves past compensation awards from published case law to guide fair settlement negotiations.
  - **ADR Routing:** Direct routing to Lok Adalat (Legal Services Authorities Act 1987) or Mediation (Mediation Act 2023) with one-click draft settlement proposals.

**Speaker Note:** With over 10 lakh MACT claims pending across India, standardizing compensation formulas and promoting Lok Adalat settlements can resolve lakhs of cases without years of contentious trial.

---

### Slide 7: Court+ for Citizens: Rights Advisor & Case Tracking

**Headline:** Demystifying the law for 140 crore Indians — accurate, vetted, and accessible.

- **Citizen Legal Rights & Action Advisor (NOT a Chatbot):**
  - Citizens describe their problem in plain everyday language (English or Hindi).
  - One query in → One structured, vetted guidance card out.
  - Covers 14+ essential legal topics:
    - Road accident claims (MV Act ss. 164/166, Good Samaritan protections s.134A).
    - Police refusal to register FIR (BNSS s.173 Zero FIR, report to SP s.173(4), Magistrate complaint s.175(3)).
    - Domestic violence remedies (PWDVA 2005) and cruelty/dowry protections.
    - Cheque bounce notice timelines (NI Act ss. 138-142).
    - Cybercrime financial fraud (immediate 1930 helpline reporting and cybercrime.gov.in).
    - Arrest rights (*D.K. Basu* guidelines, right to inform family, free legal aid).
    - Consumer disputes, tenant-landlord disputes, unpaid wages, and senior citizen maintenance.
  - Shows plain-language rights, sequential step-by-step action plans, required documents, statutory limitation deadlines, and emergency helplines.
  - Direct connection to **NALSA National Free Legal Aid Helpline (15100)**.
- **Mobile Submit Proof:**
  - Litigants and witnesses submit photographic and document proof directly from their phone browser via `/submit`, receiving an instant verifiable digital receipt.
- **Track My Case:**
  - Direct case status lookup by CNR or case number; displays verified hearing dates, next stage descriptions, and signed hearing summaries published by the court, linking directly to official eCourts services.

**Speaker Note:** Citizens do not want a chatty AI that hallucinates imaginary legal advice. They need clear, verified instructions: what does the law say, what documents do I bring, where do I go tomorrow morning, and how do I call free legal aid?

---

### Slide 8: The AI Trained on Old Indian Cases

**Headline:** Built on InLegalBERT and the IL-TUR benchmark, adapted specifically for Indian jurisprudence.

- **Base Architecture:** InLegalBERT, fine-tuned on thousands of official Indian court judgments and benchmark splits.
- **Court+ LegalNER (Named Entity Recognition):**
  - Fine-tuned on the official InLegalNER train split.
  - Achieves strict entity F1 score of **0.874** on the official test split (Precision 0.862, Recall 0.887; 13,351 entities), against **0.810** reported by Kalamkar et al. (2022).
  - Automatically recognizes courts, judges, petitioners, respondents, dates, statutes, and provisions; masks sensitive personal names.
- **Legal Statute Identification (LSI):**
  - Multi-label classifier mapping factual summaries of cases to cited statutes, trained on the IL-TUR LSI benchmark.
  - Test Performance: `[metric from ml/oldcases/METRICS.md]`.
  - Integrates an automated IPC-to-BNS crosswalk mapping historical charges to the new criminal code.
- **Prior Case Retrieval (PCR):**
  - Hybrid retrieval combining BM25 lexical search with dense InLegalBERT embeddings.
  - Test Performance: `[metric from ml/oldcases/METRICS.md]`.
  - Shipped index (<300 MB) covering thousands of official Supreme Court (2020-2026) and Chhattisgarh High Court judgments.
- **Rhetorical Role (RR) Classification:**
  - Sentence-level classification structuring legal judgments into 7 rhetorical roles: Facts, Issues, Arguments, Precedents, Statutes, Ratio, and Ruling.
  - Test Performance: `[metric from ml/oldcases/METRICS.md]`.
- **Extractive Summarization:**
  - Purely extractive sentence selection based on rhetorical roles and positional scoring; evaluated on IL-TUR summarization splits (`[metric from ml/oldcases/METRICS.md]`).
  - **Zero generative hallucination:** No generative text models are used for judicial summaries.
- **Deliberate Absence:** We explicitly did NOT train or integrate Judgment Prediction (CJPE) or Bail Outcome models.

**Speaker Note:** We take pride in what we chose *not* to build. In accordance with the Supreme Court's draft guidelines, we do not predict how a judge will rule or whether someone should get bail. Our AI is an extraction and retrieval engine, not a robotic judge.

---

### Slide 9: Safety, Ethics & The Law

**Headline:** Designed from day one to operate within the strict boundaries of Indian constitutional and procedural law.

- **Rule 20(1)(d) Compliance:** Draft Supreme Court AI Regulations explicitly prohibit AI risk scoring or predictive judicial determination. Court+ does not calculate recidivism risk, does not predict bail, and does not score criminal propensity.
- **Rule 19(1)(i) Compliance:** Fully leverages permitted AI applications: document anonymisation, multilingual accessibility, speech transcription, and workflow optimization.
- **"Hint — The Judge Decides":** Every algorithmic insight carries this explicit label and links back to the underlying statute or case law citation.
- **Mandatory Human-in-the-Loop:**
  - AI suggestions only copy text into review forms.
  - A human officer must review, edit, confirm, and sign every record.
  - Framed charges are never counted toward sentence thresholds until verified by a human against the judicial order.
- **Cryptographic Transparency:**
  - Every calculation is accompanied by a mathematical proof trace showing the exact statutory rules, day-counting conventions, and formulas applied.
- **Data Privacy & Security:**
  - Local desktop database encrypted at rest using **SQLCipher (AES-256)**.
  - Original case files stay strictly on the local computer and are never transmitted over the internet without authorization.
  - Cloud synchronization uses encrypted HTTPS channels to our AWS Mumbai backend.

**Speaker Note:** If an algorithm makes a mistake in an e-commerce app, a user gets the wrong product. If an algorithm makes a mistake in a courtroom, an innocent person stays behind bars or a victim is denied justice. That is why human confirmation is hardcoded into every screen.

---

### Slide 10: Honest Limits

**Headline:** Transparent boundaries about what Court+ can and cannot do today.

- **1. Digital Signatures vs. CCA-Licensed DSC:**
  - Court+ exports Ed25519 system signatures paired with a BSA Section 63 certificate.
  - This provides cryptographic byte-level integrity, timestamping, and tamper detection.
  - It is **not** a CCA-licensed Class 3 Digital Signature Certificate (DSC) or Aadhaar eSign yet. Licensed DSC and eSign integrations are architected for our production roadmap.
- **2. Anonymous Channel vs. Zero-Knowledge Proofs:**
  - Our anonymous whistleblower channel is **identity-blind**: the backend intentionally does not collect or log IP addresses, device identifiers, or phone numbers, and stores only the SHA-256 hash of the receipt code.
  - It is **not** a cryptographic zero-knowledge proof. Network-level adversaries monitoring physical connections could correlate timing.
- **3. Settlement & Compensation Figures:**
  - Compensation figures produced by the MACT and Maintenance tools are based strictly on statutory formulas and past judicial awards (*Sarla Verma*, *Pranay Sethi*, *Rajnesh v. Neha*).
  - They are contextual aids for negotiation, **not** binding guarantees or financial predictions.
- **4. Document Quality & Translation Review:**
  - Poorly scanned physical orders and photocopies require manual verification.
  - Hindi and regional language legal drafts and guides carry a prominent banner: *"Machine translation, not yet reviewed by a bilingual advocate"* until verified by accredited counsel.

**Speaker Note:** We believe a hackathon jury respects honesty far more than exaggerated claims. We tell you exactly where our system signature ends, how our anonymous channel operates, and why human lawyers must review translated legal drafts.

---

### Slide 11: Architecture & Security

**Headline:** Enterprise-grade security combining offline-first edge compute with resilient cloud infrastructure.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       COURT+ DESKTOP WORKSPACE (WINDOWS)                    │
│  Electron + React + TypeScript                                             │
│  ┌───────────────────────┐ ┌───────────────────────┐ ┌───────────────────┐  │
│  │ Local ONNX Models     │ │ SQLCipher (AES-256)   │ │ Ed25519 Signer    │  │
│  │ • LegalNER (InLegal)  │ │ Local Encrypted DB    │ │ RFC 8785 JSON     │  │
│  │ • LSI Statute Suggest │ │ Append-Only Audit Log │ │ SHA-256 Hasher    │  │
│  │ • PCR Precedent Embed │ │ Proof Trace Generator │ │ BSA s.63 Engine   │  │
│  │ • Whisper ASR (Steno) │ └───────────────────────┘ └───────────────────┘  │
│  └───────────────────────┘                                                  │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ Optional HTTPS Sync / Auth
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    COURT+ CLOUD BACKEND (AWS MUMBAI ap-south-1)             │
│  Docker + Fastify + Caddy (TLS)                                            │
│  ┌───────────────────────┐ ┌───────────────────────┐ ┌───────────────────┐  │
│  │ Citizen Mobile Portal │ │ Encrypted Vault       │ │ Public Verifier   │  │
│  │ • /submit (Mobile Web)│ │ • AES-256-GCM Storage │ │ • /v/:receiptId   │  │
│  │ • Identified Uploads  │ │ • Magic-Byte Check    │ │ • Rate-limited    │  │
│  │ • Anonymous Channel   │ │ • Hash-Chained Log    │ │ • Offline-ready   │  │
│  └───────────────────────┘ └───────────────────────┘ └───────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

- **Offline-First Resilience:** The core desktop workstation operates completely disconnected from the internet. Judges and court staff can triage dockets, record hearings, analyze cases, and sign drafts without network connectivity.
- **Cloud Backend (AWS Mumbai `ap-south-1`):** Fastify microservice containerized with Docker behind Caddy reverse proxy with automated TLS.
- **Tamper-Evident Public Verifier:** Courts, advocates, and citizens can verify signed PDFs online (`/v/:id`) or offline via the standalone Verifier desktop tool.

**Speaker Note:** The dual-tier architecture ensures that sensitive court documents never leave the court without explicit human export, while citizens can still participate from any basic smartphone.

---

### Slide 12: Roadmap & Team

**Headline:** Designed for scale across Indian judiciary and legal services.

- **Product Roadmap:**
  - **Q1 2027:** Full integration with Aadhaar eSign and Controller of Certifying Authorities (CCA) licensed Digital Signature Certificates.
  - **Q2 2027:** Direct two-way API connectors for eCourts CIS 3.x and National Judicial Data Grid (NJDG) push/pull workflows.
  - **Q3 2027:** Extension of vetted legal action guides and speech recognition models to all 22 Eighth Schedule Indian languages.
  - **Q4 2027:** Pilot deployment across District Legal Services Authorities (DLSAs) and Taluka courts.
- **Team:** **Team Cookie Eaters**
  - Hack-a-Sol 5.0, IIIT Naya Raipur.
  - Committed to building open, verifiable, constitutional civic technology.

**Speaker Note:** India's backlog of about 5.6 crore pending cases (NJDG / Parliament replies, 2026: 4.98 crore district courts, 63.76 lakh High Courts, about 97,000 Supreme Court) will not be solved by replacing judges with algorithms. It will be solved by giving judges, lawyers, and citizens verifiable tools that eliminate friction, protect evidence, and uphold the rule of law. Thank you.

---

## 2. Timed 3-Minute Live Demo Script

**Pre-Demo Setup (Before Going on Stage):**
1. Ensure the portable Court+ desktop app is running on Windows with local models pre-loaded.
2. Keep a smartphone connected to mobile data or Wi-Fi displaying the mobile web page `https://[backend-url]/submit`.
3. Have a pre-cleared sample court order PDF ready in your local demo folder.
4. Set the desktop profile to **Judge** view initially.
5. Have a working microphone connected for the 30-second stenographer recording.

---

### Demo Timeline (0:00 to 3:00)

| Timestamp | Screen / Action | Exact Clicks & Actions | Spoken Script (Say Clearly) | Fallback / Recovery Plan |
|---|---|---|---|---|
| **0:00 – 0:25** (25s) | **Citizen Mobile Submit (`/submit`)** | On the smartphone, open `/submit`. Enter case ref `CNR-CGRA01-002142-2026`, choose **Identified**, type name `Ramesh Kumar` and phone `9876543210`. Select photo/document file and tap **Submit proof**. | *"We begin with a citizen submitting crucial evidence from a smartphone browser via `/submit`. The backend hashes the file with SHA-256, signs an Ed25519 receipt, and encrypts it at rest."* | If mobile network lags, show the pre-submitted receipt screen with its QR code on screen. |
| **0:25 – 0:45** (20s) | **Judge Evidence Inbox** | Switch to the desktop app. Click **Evidence inbox** in the sidebar. Click on the newly received item for `CNR-CGRA01-002142-2026`. Point to the green badge: **Unchanged since upload**. | *"Instantly, on the judge’s desktop Evidence Inbox, the proof arrives. The system verifies its cryptographic digest. The judge sees 'Unchanged since upload' with full chain-of-custody details."* | If live fetch fails, select the pre-loaded evidence item in the inbox list. |
| **0:45 – 1:05** (20s) | **Export BSA s.63 Certificate** | In the Evidence detail pane, click **Export BSA s.63 certificate**. Select destination folder and click Save. | *"Under Section 63 of the Bharatiya Sakshya Adhiniyam, 2023, electronic evidence requires a statutory certificate. With one click, Court+ generates the Schedule certificate with Part A submitter details and Part B cryptographic SHA-256 verification."* | If file save dialog stalls, point to the pre-generated certificate PDF on the desktop. |
| **1:05 – 1:30** (25s) | **Smart Triage (JAI)** | Click **Smart triage** in the sidebar. Point to the ranked docket list with JAI scores (e.g. 88, 72, 65). Point to factor chips: `Art. 21 Custody`, `Senior Citizen`, `Oldest Case Bucket`. | *"Next, docket management. Smart Triage scores cases using the Justice Acceleration Index—a 100% rule-based score reflecting Article 21 custody, senior citizen litigants, and national ageing buckets. Every factor quotes the law; the judge retains full override power."* | If the list is filtering, click 'All cases' to show the populated ranked docket. |
| **1:30 – 1:55** (25s) | **Adjournment Analyzer** | Click **Adjournment analyzer** (or click 'Adjournment' on a triage case). In the form, select a case, enter Requesting Party `Defendant Counsel`, Days requested `21`, Procedure `Civil suit under CPC`. Click **Review request**. | *"Lawyers often request routine 21-day adjournments. Court+ checks CPC Order XVII Rule 1 and court docket capacity. Notice the result: 'Requested 21 days → Suggested 14 days based on courtroom capacity'. The judge records the decision in the audit log."* | If request calculation is cached, click 'Use suggested date' and record the decision. |
| **1:55 – 2:20** (25s) | **Tamper-Evident Stenographer** | Click **Hearing recorder**. Select a matter. Click **Start recording**. Speak for 5-10 seconds: *"The witness deposed that the accident occurred at 10 PM near the bypass road."* Tap **Witness** marker. Click **Stop recording**. Show local Whisper transcript and click **Sign transcript**. | *"In the courtroom, our offline AI Stenographer records the hearing, marks speaker roles, and transcribes speech locally using Whisper ONNX. On stop, it computes a SHA-256 hash and signs the audio, creating a tamper-evident record: any later change is detected."* | If microphone input fails, open the pre-recorded 30-second hearing sample and display the signed transcript. |
| **2:20 – 2:35** (15s) | **Research & Hints Panel** | Open **Research** (or Case View **Hints for this case**). Point to suggested sections and retrieved precedent citations with text snippets. | *"For judicial decision support, our models trained on old Indian judgments suggest relevant statutory provisions and find matching Supreme Court precedents. Notice the persistent banner: 'Hint — the judge decides'. Zero outcome prediction."* | Show the precedent search result card with Supreme Court citation. |
| **2:35 – 2:45** (10s) | **Lawyer MACT Calculator** | Switch view to **Lawyer view**. Click **Settlement analyzer** → **Motor accident claim**. Enter Age `32`, Income `₹25,000`, Dependents `3`. Point to line-by-line calculation. | *"For advocates, our Settlement Analyzer automates Motor Accident Claims strictly following the Supreme Court’s Sarla Verma and Pranay Sethi formulas—calculating future prospects, multipliers, and consortium line by line."* | Point to the final compensation total and the button 'Draft settlement proposal for Lok Adalat'. |
| **2:45 – 3:00** (15s) | **Citizen Rights Advisor** | Switch to **Citizen view**. Click **Rights advisor**. In the box, type: *"I was injured in a road accident"*. Click **Find legal guidance**. | *"Finally, for ordinary citizens, our Rights Advisor takes plain-language queries and instantly delivers a structured action plan: your rights under MV Act s.166, documents needed, limitation deadlines, and a direct button to NALSA free legal aid at 15100."* | Show the generated rights card and NALSA 15100 assistance button. |

---

## 3. Likely Jury Questions & Honest Answers (Q&A)

### Q1: "Isn't this just another generative AI wrapper around cloud language models?"
**Answer:** No. Court+ is an offline-first engineering platform that does not rely on third-party cloud APIs. All core AI models (InLegalBERT for LegalNER, LSI for statute identification, rhetorical role classifiers, and Whisper for speech-to-text) run locally via ONNX runtimes on edge hardware. Furthermore, our legal calculations (custody counting under BNSS Section 479, MACT formulas, and JAI triage) are deterministic rule engines quoting bare act provisions, avoiding generative hallucinations completely.

### Q2: "Can Court+ predict the outcome of a bail application or a trial verdict?"
**Answer:** Absolutely not. We deliberately refrained from training or deploying judgment prediction (such as IL-TUR CJPE) or bail outcome models. Rule 20(1)(d) of the Supreme Court's draft AI Regulations explicitly prohibits AI risk scoring or predictive determination in judicial matters. In Court+, AI suggests text and precedents, but only a human judge decides legal outcomes.

### Q3: "How does the Evidence Vault comply with Section 63 of the Bharatiya Sakshya Adhiniyam, 2023?"
**Answer:** Section 63 requires that electronic records produced in court be accompanied by a certificate identifying the electronic record, describing the manner in which it was produced, and certifying system integrity. Court+ automates this by computing a SHA-256 hash immediately on upload, recording timestamps, and generating a signed PDF certificate containing both Part A (submitter affirmation) and Part B (cryptographic system details), matching the official Schedule format.

### Q4: "How can you claim the anonymous channel is anonymous if it runs on a web server?"
**Answer:** We are completely transparent about this boundary: Court+ operates an **identity-blind** intake channel. The server deliberately does not collect, log, or persist IP addresses, browser fingerprints, or tracking cookies. It returns a random 128-bit receipt code and stores only its one-way SHA-256 hash. However, as noted in our honest limits, this is not a cryptographic zero-knowledge proof. A state-level network adversary monitoring raw ISP packet streams could correlate timing. For court intake, identity-blind logging provides substantial real-world whistleblower protection.

### Q5: "Why did you use a rule-based algorithm for Smart Triage (JAI) instead of a trained machine learning ranking model?"
**Answer:** In justice administration, decisions must be explainable and constitutionally justifiable under Article 14 and 21. A machine learning ranking model trained on historical court data would inevitably encode systemic biases—such as historical delays against marginalized groups. Our Justice Acceleration Index (JAI) uses transparent, publicly audited statutory weights: detention status, vulnerable categories (women, children, senior citizens), and statutory speedy trial mandates (e.g. NI Act s.143(3)). Every factor quotes its legal source, and judges can override rankings with logged reasons.

### Q6: "How do you achieve 0.874 F1 on LegalNER when published papers reported 0.810?"
**Answer:** We fine-tuned InLegalBERT on the official InLegalNER benchmark dataset using specialized domain adaptation: optimizing learning rate schedules, sliding-window chunking with token overlap to preserve legal cross-references, and strict entity-level boundary evaluation. Full evaluation code and confusion matrices are documented in `ml/ner/METRICS.md`.

### Q7: "What stops an internal administrator from tampering with the case history or evidence log?"
**Answer:** Every evidence submission, judge review, and procedural action is recorded in an append-only, SHA-256 hash-chained audit ledger where each entry contains `prevHash` and `entryHash`. Rewriting a past entry invalidates all subsequent block hashes. Furthermore, judicial officers can export an off-system audit anchor (the head hash on a printed DLSA handoff sheet), anchoring the ledger against silent database manipulation.

### Q8: "How does the MACT calculator handle non-standard compensation cases?"
**Answer:** The MACT calculator implements the settled law established by the Supreme Court in *Sarla Verma* (2009), *Pranay Sethi* (2017), and *Raj Kumar* (2011). It transparently computes multipliers, personal deductions, and future prospects based on the inputs provided. For complex non-standard claims (such as multi-party liability or contested negligence), it provides the statutory baseline calculation while flagging the matter for judicial determination and offering ADR settlement drafting for Lok Adalat.

### Q9: "How does Court+ function in rural taluka courts with no internet access?"
**Answer:** The Court+ Windows desktop application is completely standalone. It packages local SQLCipher encrypted databases, local ONNX neural network runtimes, and local document processing engines. Court staff can import scanned orders, conduct smart triage, record hearings, transcribe audio, and export cryptographically signed PDF bundles entirely offline. Synchronization with the AWS cloud backend is optional and occurs whenever connectivity is restored.

### Q10: "What is the difference between your Ed25519 signature and a CCA-licensed DSC?"
**Answer:** An Ed25519 signature generated by Court+ proves mathematical byte-level authenticity: it verifies that the PDF, receipt, and audit manifest have not been altered by a single bit since the issuing office generated them. However, it is an application-level system key, not a government-issued Class 3 Digital Signature Certificate (DSC) issued under the Information Technology Act by a licensed Certifying Authority (CCA). Our production roadmap incorporates PKCS#11 hardware crypto-tokens and Aadhaar eSign to bridge system signatures with official CCA-licensed identities.

---

## 4. Sixty-Second Elevator Pitch

India's courts are overwhelmed with about 5.6 crore pending cases (NJDG / Parliament replies, 2026: 4.98 crore district courts, 63.76 lakh High Courts, about 97,000 Supreme Court), including 52 lakh matters delayed for over a decade in district courts, while two out of three prison inmates in Chhattisgarh languish as undertrials. 

**Court+** is an AI legal platform built for Judges, Lawyers, and Citizens to break this backlog. 

For judges, it provides deterministic Smart Triage, automated adjournment checks, and offline speech-to-text hearing transcription. For lawyers, it automates case analysis, procedural compliance checks, and landmark MACT compensation calculations. For citizens, it offers plain-language rights guides, direct mobile evidence submission, and transparent case tracking.

Every digital document is secured with SHA-256 hashing, Ed25519 signatures, and automatic BSA Section 63 electronic evidence certificates. Our AI models are fine-tuned on official Indian case law—achieving an F1 score of 0.874 on LegalNER—while adhering strictly to the Supreme Court’s draft AI regulations: zero prediction of bail or verdicts, transparent proof traces, and human confirmation on every action.

Built by **Team Cookie Eaters** at IIIT Naya Raipur for Hack-a-Sol 5.0, Court+ combines cryptographic cybersecurity with profound civic impact: **The AI reads, the law decides, and the human signs.**
