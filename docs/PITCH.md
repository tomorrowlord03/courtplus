# CourtPlus pitch: Hack-a-Sol 5.0, IIIT Naya Raipur

**Track:** Cybersecurity, with civic impact. **Prepared:** 23 November 2026.

**Sources:** every number below comes from `docs/FINDINGS.md`, `FEATURES.md`, `docs/LEGAL_RULES.md`, `ml/ner/METRICS.md` or `data/stats/*.json`. Official sources are cited for the Devilal Gond case and the draft Supreme Court AI Regulations. Each number keeps its date and denominator. Figures marked `verified: false` in `data/stats` (Raipur RTI and the India-wide totals) stay off the slides.

**Language rules for everyone presenting:**
- Use "could apply", "screen", "route to review" and "draft for a human to sign".
- Never say "guaranteed", "entitled", "AI decides", "admissible" or "predicts".
- CourtPlus never predicts bail.

---

## 1. Slides

### Slide 1: Hook (Devilal Gond)

**Message:** An acquittal is not a release until someone checks and acts on it.

- Devilal Gond was acquitted by the Chhattisgarh High Court on **20 January 2018**. He was released from Central Jail Durg on **19 May 2025**.
- On **16 November 2026** the Supreme Court raised his compensation to **₹30 lakh** (*Devilal Gond v. State of Chhattisgarh*, 2026 INSC 1226). It described a breakdown in coordination.
- In para 55(xii) (paraphrased), the Court asks High Courts to consider safeguards and a system like Madhya Pradesh's.
- This was a communication and verification failure. It was not a gap in the law.

**Speaker note:** Para 55(xii) is paraphrased and cited rather than quoted verbatim. Be accurate here: Devilal had been convicted and was an appellant, not an undertrial. Present the case as a missed handoff, not as an s.479 case. The judgment gives conflicting exact durations, so quote only the two dates. Sources: SC judgment of 16 Nov 2026 (sci.gov.in).

### Slide 2: Chhattisgarh in numbers

**Message:** Two in three prisoners in Chhattisgarh have not been convicted, and the prisons are over capacity.

- **12,478 undertrials**, 66.4% of 18,798 inmates (NCRB PSI-2024, as of 31 Dec 2024).
- **127.6% occupancy**: 18,798 inmates in 14,733 places (NCRB PSI-2024, 31 Dec 2024).
- NALSA UTRC review, Oct-Dec 2025: **400 identified → 195 recommended for release → 183 released**. The October 2025 prison population of 21,412 is the base, so 400 is about 1.87% of it.
- s.479 BNSS alone in Chhattisgarh, 2024: **19 eligible, 4 superintendent applications, 15 released** (NCRB Table 7.4).

**Speaker note:** The UTRC funnel covers broad review categories. It does not count s.479 eligibility or missed cases. The NCRB s.479 row is an aggregate, so it cannot show which releases followed an application. Do not claim "X people are wrongly jailed." Every figure is from `data/stats/chhattisgarh.json`, and the slide shows each date.

### Slide 3: The gap

**Message:** The law is clear. The work of finding people and passing their cases on is where things break.

- **Finding people.** s.479(3) says the superintendent "shall forthwith make an application". First someone has to find who has crossed the threshold, across every case that person has.
- **Handoffs.** Court to jail to DLSA to lawyer. A bail grant is not a release. After 7 days without release the DLSA must be told. After 1 month with bonds unfurnished, the court may relax conditions (SC, 31 Jan 2023).
- **Stale FIR sections.** Records keep the FIR sections even after charges are framed differently. The maximum sentence, and so the threshold, depends on the charge actually framed.
- **IPC to BNS.** Old and new codes now run side by side in pending cases.

**Speaker note:** Framed charges override FIR sections, and an unframed charge is flagged (`docs/LEGAL_RULES.md`). Our own audit had to use FIR charges provisionally because no framing orders were verified (`docs/FINDINGS.md`).

### Slide 4: CourtPlus in one sentence

**Message:** CourtPlus reads court orders, routes cases for human review under s.479 BNSS, and prepares signed drafts for a person to check and file when the rule screen permits.

- **Users:** the jail office, the DLSA and legal-aid lawyers.
- **AI reads; the law is shown.** A trained model suggests facts; model and rule masks hide identifiers. A person reviews the suggestions and saves the facts before the engine uses them. The rule engine shows its working; a lawyer and the court make the legal decisions.
- **Four screen outcomes:** Apply now · Due in N days · Needs a lawyer · Outside this screen. Reaching the maximum term adds an urgent lawyer-review flag.
- **Action board:** cards track an owner, due date when set, and progress state. NALSA categories appear where the facts support them.

**Speaker note:** Say once, clearly: "It does not decide bail and does not predict anything about anyone." Every draft is marked DRAFT.

### Slide 5: Live demo

**Message:** One real order, from PDF to a human-reviewed AI assistance note and verification.

- Import a real, published Chhattisgarh High Court bail order with **Choose PDF or image**. The desktop lists suggestions, a page reference where available, and masked order text. The officer reviews, types the custody start from the original, and saves confirmed facts.
- The case view starts at today's date. Set the **What if we look at this date?** control to the order date for the retrospective proof trace.
- The action board has a **Needs a lawyer** lane. A **Court and jail records disagree** lane exists, but this cohort has no jail roster evidence or Devilal replay card.
- Export an **AI assistance note** for a selected review case. The verifier requires the PDF, receipt and manifest. It separately reports **Signature ✓ Valid**, **PDF ✓ Unchanged** or **PDF ✗ Changed**, and **Audit chain – Not checked** when no chain is supplied.

**Speaker note:** Run the script in section 2. If anything fails, switch to the backup video without comment and keep talking.

### Slide 6: AI that reads, law that decides

**Message:** The model reads documents, and the decision comes from the words of the law.

- **CourtPlus LegalNER** (InLegalBERT fine-tuned on the official InLegalNER train split): strict F1 **0.874** on the official test split (P 0.862, R 0.887; 13,351 entities), against **0.810** reported by Kalamkar et al. (2022).
- **Name masking:** the model plus rule patterns replace many names and identifiers, for example with "Accused-1". A second person must check every displayed order because the audit still found leaks.
- **Draft SC AI Regulations (3 Jun 2026):** r.19(1)(i) lists anonymisation as a permitted use. r.20(1)(d) would bar AI risk scoring, including bail eligibility. **We do not score risk.**
- The desktop **Use suggestion** button copies a value into the form; the officer can edit it and must press **Save confirmed case** before the engine uses the case.

**Speaker note:** The setups are not identical: the model recipe, windowing and evaluator differ from the paper, so this is not an exact reproduction (`ml/ner/METRICS.md`). On our 10 hand-checked Chhattisgarh orders, entity recall was low for dates (0.077) and case numbers (0.048), and person-name recall was 0.788. That is why people review each suggested value before saving. The AI Regulations are still a draft; their final notification is unverified.

### Slide 7: Security

**Message:** Tamper-evident drafts, an append-only log and encrypted storage. Integrity is checked, not assumed.

- **Ed25519-signed drafts** (RFC 8785 canonical JSON). With the office key trusted, the verifier separately reports signature validity and whether the PDF bytes are unchanged. It requires the PDF, receipt and manifest files.
- **Hash-chained audit log**. When the operator prints a DLSA handoff sheet, its checkpoint can expose a later rewrite of that history.
- **SQLCipher** (AES-256) encrypts the local database. Processing is local, and only an operator can export.
- **Optional online backend on AWS Mumbai (ap-south-1)** over HTTPS: jail-to-DLSA handoff sync, a public verify page and role-based access. It stores pseudonymised handoff data with exact dates, not anonymous data.

**Speaker note:** A valid signature authenticates the signed receipt with the trusted office key; the separate PDF check says whether the PDF bytes match. Neither check proves that the content is legally right. Call it "tamper-evident", never "admissible". The verifier works offline.

### Slide 8: Real-order audit (34 orders, rerun 23 Nov 2026)

**Message:** We ran CourtPlus on 34 real orders, and it sent all 34 to a lawyer. That is the safe result.

- **34 / 34** published Chhattisgarh High Court bail orders from October 2026 were imported and screened as of each order date.
- **30 / 34** had enough core facts for an order-level screen.
- **34 / 34** were routed to **Needs a lawyer**, and 0 to Apply now. Every order left prior convictions or other holds unestablished.
- **Threshold-to-grant interval: n = 0**, so it cannot be calculated. We report that instead of inventing a number.
- **Current intake field check:** exact order date 34 / 34 promoted; custody start 32 / 32 promoted where one value was verifiable; full charge set 9 / 9 promoted, but proposed for only 9 / 34. Bail outcome was not proposed.
- **Full masked-text audit:** at least 26 unmasked name occurrences or fragments in 18 / 34 orders. Court citation, case or crime identifiers remained in 32 / 34. A second human check stays mandatory.

**Speaker note:** This is a convenience sample, not a representative one. It makes no claim about anyone's current custody. A grant order records a decision, not a release. Stated outcomes were 27 grants, 5 rejections, 1 withdrawal and 1 mixed. The leak count is a confirmed minimum, and three ambiguous sign-off fragments were excluded. The audit's case-identifier check was broadened from one narrow pattern. Method and limits are in `docs/FINDINGS.md`.

### Slide 9: Impact and pilot ask

**Message:** Give us one week of shadow use with DLSA Raipur. It changes nothing in their process, and we measure what the tool catches.

- **Ask:** a **one-week shadow pilot with DLSA Raipur**. The DLSA keeps its current process, and CourtPlus runs alongside on orders the DLSA supplies.
- **Measures:** cases routed per lane, how long confirmation takes, disagreements with the panel lawyer, and masking leaks found by the second check.
- **Value:** each person's cases in one list, board ownership and due dates when assigned, 7-day and 1-month post-bail alerts, and signed drafts for human review.
- **Safeguards:** no outcome prediction or letterhead. Protected case types are excluded from this demo cohort; the importer warns but does not block every such case locally. Cloud sync filters them.

**Speaker note:** We are not claiming any government adoption. Impact is unmeasured until the pilot runs. Do not project "people freed".

### Slide 10: Team and roadmap

**Message:** Built for a real-order audit, with a clear next step.

- **Team:** [Team members]
- **Built:** PDF and OCR order reader (real scans not yet validated), name masker with a required human check, IPC-to-BNS crosswalk, rule engine with proof trace, action board, per-person case list, signed drafts and verifier, statistics page, and the optional online handoff backend.
- **Next:** validate scanned orders, add a date-role model (arrest, remand or bail), obtain fluent legal review of Hindi drafts, and validate the existing "no court update for 180 days" lane in practice.
- **Never:** bail outcome prediction, automated eCourts scraping past the CAPTCHA, and WhatsApp/SMS alerts that could reveal custody.

**Speaker note:** Close with: "The AI reads, the law decides, a person signs."

---

## 2. Three-minute demo script

**Setup before going on stage:**
- Rehearse this script on the portable app with the bundled model before using it live.
- Use the actual desktop build in **Legal-aid view**. Keep one real published order that a second person has checked for names, addresses, relatives and identifiers ready locally. Keep that case already saved as an import fallback. Never display an unchecked masked order.
- Preselect an empty export folder for the native save dialog. If using laptop B, open **Verifier** there and use **Trust an office public key** with the key exported from laptop A's **Settings** → **Export office public key**; verify the key fingerprint before the demo.
- Keep the signed PDF, receipt `.json`, manifest `.json`, a one-byte-edited PDF copy, and the backup video on a local USB stick. Test both bundles before the presentation.

| Time | Action (exact clicks) | Say | If it fails |
|---|---|---|---|
| 0:00-0:35 | Click **Import order**, then **Choose PDF or image** and select the cleared local PDF. | "The desktop reads a published order locally, suggests fields and masks many identifiers. We check its text before showing it." | If import fails or stalls, open **Cases** and select the same previously saved, cleared case. There is no manual form until the import succeeds. |
| 0:35-1:05 | In **Suggested facts**, click **Use suggestion** for a correct charge and order date when offered. Check the original; enter a nonidentifying **Person alias**, type its custody date in **Judicial custody start**, select **Judicial custody is ongoing** only if supported as of the order date, then click **Save confirmed case**. | "A suggestion only copies a value into the form. A person checks and saves the facts. Custody start is typed from the order in this desktop build." | If a suggestion is missing, type the value into **Confirmed case facts**. If the model cannot load, continue with the saved case. |
| 1:05-1:35 | Click **Cases**, open the saved case, and drag **What if we look at this date?** until the displayed date equals the order date. Scroll to **Proof trace** and **Alerts**. | "The case opens at today's date. For our retrospective audit, we set the order date. Unknown prior convictions or other holds route this case to **Needs a lawyer**." | If the date control or trace fails, show the audited result on slide 8 and state its order-date denominator. |
| 1:35-1:55 | Click **Action board** and point to **Needs a lawyer** and the **Court and jail records disagree** lane label. | "The separate 34-order audit sent every order to review. This board shows only cases saved in this desktop database. A mismatch card needs independent court and jail evidence; we have no Devilal replay card here." | If the board is empty, return to **Cases**. Do not claim the cohort is loaded on the board. |
| 1:55-2:35 | Click **Drafts**. In **Case**, select the just saved case; in **Draft type**, select **AI assistance note**; click **Export signed PDF** and choose the prepared folder. | "This is a review case, so the s.479(3) application is not offered. We export an AI assistance note for a human to review." | If the save dialog or export fails, use the pre-signed PDF, receipt and manifest from USB. |
| 2:35-2:55 | Open **Verifier**. Load **Signed PDF**, **Receipt file** and **Manifest file**, then click **Verify**. Repeat with the edited PDF and the same receipt and manifest. | "With the office key trusted, the signature is valid; the PDF check says unchanged for the original and changed for the edited copy. Audit chain may say not checked here." | If laptop B does not trust the key, use the **Verifier** on laptop A. Never call **Signature ✓ Valid** a whole-document verdict. |
| 2:55-3:00 | Click **Safeguards**. | "No outcome prediction or risk score. A person checks the facts and signs; the court decides." | Use the backup video only if it shows this same desktop flow. |

**Rule:** never improvise numbers during the demo. The board counts saved cases screened today; slide 8 counts the separate 34-order audit screened at each order date. Say that difference explicitly if the numbers differ.

---

## 3. Hard jury questions

1. **"Isn't this just a calculator?"**
   The date arithmetic is the easy part. The hard parts are reading the order, confirming facts, catching every case a person has, handling IPC to BNS, treating unknown facts as unknown, assigning an owner and due date, and producing a draft that is signed and verifiable. Existing calculators and e-Prisons date alerts cover parts of this; we combine them in one workflow.

2. **"Why did all 34 orders go to review?"**
   None of the 34 orders established prior conviction history or the absence of other holds, and the engine never treats silence as "no". There were further reasons too: NDPS charges in 10 orders, multiple applicants in 4, and unresolved penalties in 4. For a tool that drafts release applications, sending everything to a lawyer is the safe failure mode (`docs/FINDINGS.md`).

3. **"Can AI decide bail in India?"**
   No, and ours does not. The model only reads documents and masks names. The draft SC AI Regulations (3 Jun 2026) would bar AI risk scoring for bail eligibility under r.20(1)(d) and list anonymisation as permitted under r.19(1)(i). The rule engine is deterministic, shows its working and quotes the statute, and the court decides.

4. **"What if the AI misses a name?"**
   It does. The rerun found at least 26 residual personal-name occurrences or fragments in 18 of 34 masked orders, and court citation, case or crime identifiers stayed visible in 32. The model and pattern masks are only a first pass: a second person checks every displayed order and every export. The three additional ambiguous sign-off fragments are not in the confirmed minimum.

5. **"Who is liable if a draft is wrong?"**
   The responsible officer or lawyer must check the DRAFT before using it. The proof trace shows the values used and the rules applied; the signer and audit record support integrity checks. The desktop does not yet record a confirmer name for every imported fact. A valid signature does not prove legal correctness.

6. **"Why not use e-Prisons?"**
   We would complement it, not replace it. e-Prisons already records half and one-third dates from manual entry, and FASTER transmits orders. CourtPlus adds reading the order, confirming framed charges, routing unknown facts to review, multi-case checks, owners and due dates, and signed drafts. An integration would need official data access, which we do not have.

7. **"Is real data safe on AWS?"**
   Original order files stay local and are not committed. Optional cloud sync sends pseudonymised handoff facts, including exact dates, over HTTPS to the AWS Mumbai backend; this is not anonymous data. The local database is encrypted. The pilot must verify its data handling and access controls before any live case is synced.

8. **"Is the Hindi reviewed?"**
   Not yet by a fluent legal reviewer. As of 23 November 2026, Hindi legal drafts are exportable but unreviewed and do not show a legal-draft warning; English is authoritative for this demo. We do not demonstrate Hindi drafts as final.

9. **"Your F1 is 0.874. Why is real-order recall so low?"**
   0.874 is strict entity F1 on the official InLegalNER test split. A separate ten-order entity check found recall of 0.077 for dates and 0.048 for case numbers. The current 34-order cohort script uses additional patterns and context checks, so it now promotes an exact order date in 34/34; that is a different field-level measure. The desktop still requires human review and manual correction.

10. **"Devilal was not an undertrial. How does this help?"**
   He was a convict-appellant who had been acquitted. His story illustrates a missed court-to-jail handoff, not an s.479 case. The product has a **Court and jail records disagree** lane, but this desktop import does not capture an acquittal event or independent jail roster evidence, and we have no Devilal replay card. A pilot would need those inputs and an identity check to make that lane useful for this pattern.

11. **"Your audit found zero eligible grants. Where is the impact?"**
   We are honest that n = 0 for the threshold-to-grant interval. High Court bail orders are a selected sample and leave key facts unknown. Impact has to be measured in practice, which is the point of the proposed one-week shadow pilot with DLSA Raipur. We make no statewide claim.

12. **"What stops someone forging a draft?"**
   The Ed25519 signature is tied to the office key, and the verifier's separate PDF check flags a changed byte. If the operator printed a DLSA handoff sheet, its log checkpoint can reveal a later rewrite. If the office key is stolen, forged drafts could verify, so key custody is a pilot requirement.

---

## 4. Sixty-second elevator pitch

On 16 November 2026 the Supreme Court raised Devilal Gond's compensation to thirty lakh rupees. The Chhattisgarh High Court acquitted him in January 2018, but he was not released until May 2025. His case shows why a court-to-jail handoff must be checked; he was not an undertrial. In Chhattisgarh, two in three prisoners were undertrials, and prisons ran at 127.6% of capacity at the end of 2024. CourtPlus helps jail offices and legal-aid lawyers review orders and route cases. A trained model suggests fields and masks many identifiers; on the official legal test set it scored 0.874 strict F1 against a published 0.810 on a comparable but not identical setup. A person reviews and saves the facts. The rule engine applies section 479, shows its working and routes unknowns to a lawyer. The desktop can then export a signed AI assistance note for a human to review. It never predicts bail. In our retrospective audit, all 34 real orders went to lawyer review; masking still missed names. We ask DLSA Raipur for a one-week shadow pilot to measure the workflow safely.
