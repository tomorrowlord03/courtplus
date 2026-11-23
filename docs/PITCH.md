# CourtPlus pitch: Hack-a-Sol 5.0, IIIT Naya Raipur

**Track:** Cybersecurity, with civic impact. **Prepared:** 23 November 2026.

**Sources:** every number below comes from `docs/FINDINGS.md`, `FEATURES.md`, `docs/LEGAL_RULES.md`, `ml/ner/METRICS.md` or `data/stats/*.json`. Public sources are cited for the Devilal Gond case and the draft Supreme Court AI Regulations. Each number keeps its date and denominator. Figures marked `verified: false` in `data/stats` (Raipur RTI and the India-wide totals) stay off the slides.

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
- In para 55(xii) (paraphrased), the Court directs High Courts to consider safeguards like Madhya Pradesh's and a similar online system.
- This was a communication and verification failure. It was not a gap in the law.

**Speaker note:** Para 55(xii) is not quoted word for word because the verbatim text was not available to us; we paraphrase and cite it. Be accurate here: Devilal had been convicted and was an appellant, not an undertrial. Present the case as a missed handoff, not as an s.479 case. The judgment gives conflicting exact durations, so quote only the two dates. Sources: SC judgment of 16 Nov 2026 (sci.gov.in), cross-checked against a second source.

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

**Speaker note:** The stale-section point comes from `docs/LEGAL_RULES.md` rule 1: framed charges override FIR sections, and an unframed charge is flagged. Our own audit had to use FIR charges provisionally because no framing orders were verified (`docs/FINDINGS.md`).

### Slide 4: CourtPlus in one sentence

**Message:** CourtPlus reads real court orders, shows who could apply for release under s.479 BNSS and who must act by when, and writes signed drafts for a human to check and sign.

- **Users:** the jail office, the DLSA and legal-aid lawyers.
- **AI reads; the law decides.** A trained model pulls facts from orders and masks names. A person confirms every fact. A rule engine applies the statute and shows its working.
- **Five outcomes:** Apply now · Due in N days · Needs a lawyer · Outside this check · Urgent: maximum reached.
- **Action board:** every card has an owner, a due date and a status, plus a NALSA 16-category tag.

**Speaker note:** Say once, clearly: "It does not decide bail and does not predict anything about anyone." Every draft is marked DRAFT.

### Slide 5: Live demo

**Message:** One real order, from PDF to signed draft, in three minutes.

- Import a real, published Chhattisgarh High Court bail order. The model highlights facts and masks names, and the officer confirms them.
- The proof trace shows dates, day counting, the sum and the statute text, with screening as of the order date.
- The action board shows real orders in their lanes and the "court and jail records disagree" replay of the Devilal case.
- Sign a draft. The verifier says **valid**; a copy with one edited character says **changed**.

**Speaker note:** Run the script in section 2. If anything fails, switch to the backup video without comment and keep talking.

### Slide 6: AI that reads, law that decides

**Message:** The model reads documents, and the decision comes from the words of the law.

- **CourtPlus LegalNER** (InLegalBERT fine-tuned on the official InLegalNER train split): strict F1 **0.874** on the official test split (P 0.862, R 0.887; 13,351 entities), against **0.810** reported by Kalamkar et al. (2022).
- **Name masking:** the same model replaces names, for example with "Accused-1", before anything is shown. A second person still checks every displayed order.
- **Draft SC AI Regulations (3 Jun 2026):** r.19(1)(i) lists anonymisation as a permitted use. r.20(1)(d) would bar AI risk scoring, including bail eligibility. **We do not score risk.**
- Every field the model suggests needs a human **Confirm** before the engine uses it.

**Speaker note:** The setups are not identical: the model recipe, windowing and evaluator differ from the paper, so this is not an exact reproduction (`ml/ner/METRICS.md`). On our 10 hand-checked Chhattisgarh orders, recall was low for dates (0.077) and case numbers (0.048), and person-name recall was 0.788. That is why people confirm every field. The AI Regulations are still a draft; their final notification is unverified.

### Slide 7: Security

**Message:** Tamper-evident drafts, an append-only log and encrypted storage. Integrity is checked, not assumed.

- **Ed25519-signed drafts** (RFC 8785 canonical JSON). A verifier on a second laptop says **valid**, or **changed** if even one letter is edited.
- **Hash-chained audit log**, with checkpoints anchored on the DLSA handoff sheet. History cannot be quietly rewritten.
- **SQLCipher** (AES-256) encrypts the local database. Processing is local, and only an operator can export.
- **Online backend on AWS Mumbai (ap-south-1)** over HTTPS: jail-to-DLSA handoff sync, a public verify page and role-based access. It stores anonymised data only.

**Speaker note:** A valid signature shows that the bytes are unchanged and were signed with the office key. It does not show that the content is legally right. Call it "tamper-evident", never "admissible". The verifier works offline.

### Slide 8: Real-order audit (34 orders)

**Message:** We ran CourtPlus on 34 real orders, and it sent all 34 to a lawyer. That is the safe result.

- **34 / 34** published Chhattisgarh High Court bail orders from October 2026 were imported and screened as of each order date.
- **30 / 34** had enough core facts for an order-level screen.
- **34 / 34** were routed to **Needs a lawyer**, and 0 to Apply now. Every order left prior convictions or other holds unestablished.
- **Threshold-to-grant interval: n = 0**, so it cannot be calculated. We report that instead of inventing a number.
- **Masking audit:** at least 26 unmasked names across 15 / 34 orders, and a case-number pattern visible in 34 / 34. A second human check stays mandatory.

**Speaker note:** This is a convenience sample, not a representative one. It makes no claim about anyone's current custody. A grant order records a decision, not a release. Stated outcomes were 27 grants, 5 rejections, 1 withdrawal and 1 mixed. Extraction: custody-since date exact in 32 / 32 proposed; charge set exact in 8 / 8 proposed, but proposed for only 8 of 34. Method and limits are in `docs/FINDINGS.md`.

### Slide 9: Impact and pilot ask

**Message:** Give us one week of shadow use with DLSA Raipur. It changes nothing in their process, and we measure what the tool catches.

- **Ask:** a **one-week shadow pilot with DLSA Raipur**. The DLSA keeps its current process, and CourtPlus runs alongside on orders the DLSA supplies.
- **Measures:** cases routed per lane, how long confirmation takes, disagreements with the panel lawyer, and masking leaks found by the second check.
- **Value:** each person's cases in one list, an owner and due date on every action, 7-day and 1-month post-bail reminders, and signed drafts ready for the superintendent.
- **Safeguards:** no outcome prediction, no letterhead, and no excluded case types (POCSO, sexual offences, juvenile).

**Speaker note:** We are not claiming any government adoption. Impact is unmeasured until the pilot runs. Do not project "people freed".

### Slide 10: Team and roadmap

**Message:** Built in 36 hours on real data, with a clear next step.

- **Team:** [names and roles: fill in before the event].
- **Built:** order reader and name masker, IPC-to-BNS crosswalk, rule engine with proof trace, action board, per-person case list, signed drafts and verifier, statistics page, and the online handoff backend.
- **Next:** scanned-order reading, a date-role model (arrest, remand or bail), Hindi drafts after fluent legal review, and the "no court update for 180 days" lane.
- **Never:** bail outcome prediction, automated eCourts scraping past the CAPTCHA, and WhatsApp/SMS alerts that could reveal custody.

**Speaker note:** Close with: "The AI reads, the law decides, a person signs."

---

## 2. Three-minute demo script

**Setup before going on stage:**
- Laptop A runs the CourtPlus app, already logged in to the backend, in **Legal-aid view**. One audited order PDF is ready on the desktop; its names were checked by a second person beforehand.
- Laptop B has the verifier open.
- On a USB stick: the signed draft PDF, a copy with one character changed, and the backup video.

| Time | Action (exact clicks) | Say | If it fails |
|---|---|---|---|
| 0:00-0:40 | Click **Import order** in the left menu. Drag the order PDF onto **Import a court order to begin**. | "A real published Chhattisgarh High Court order. Our model highlights sections, Acts, dates and the court, and masks names." | If the model or the import stalls, click **Edit** on a field and type the value, which is then labelled **Entered by hand**. Say: "Manual correction is built in for exactly this." |
| 0:40-1:10 | Click **Confirm** on the charge and the custody-since date. On one wrong or missing field, click **Edit** and correct it. | "Nothing the AI suggests is used until a person confirms it." | If highlights do not show, read the field from the order text and enter it by hand. |
| 1:10-1:45 | Open the case and scroll to **Proof trace**. Point to the alerts. | "The engine screens as of the order date. Prior convictions and other holds are unknown here, so it routes to **Needs a lawyer** and gives its reasons. Silence in an order means unknown, never no." | If the trace is blank, open **Cases**, pick another imported order and show its trace. |
| 1:45-2:15 | Click **Action board**. Point to the **Needs a lawyer** lane, then the **Court and jail records disagree** card for the Devilal replay. | "All 34 real orders landed in review, which is the honest result. This card replays the Devilal mismatch: a court event the jail list never acted on." | If the board is empty, switch to the board screenshot on slide 8. |
| 2:15-2:45 | Open a case and click **Prepare drafts for this case**, then wait for **Signed PDF ready**. On laptop B, open **Verifier**, load the PDF and click **Verify**: **valid**. Load the edited copy and click **Verify**: **changed**. | "Signed with Ed25519. One changed letter and verification fails. Tamper-evident, offline." | If drafting fails, verify the pre-signed PDF and the edited copy from the USB stick. If laptop B fails, use the **Verifier** screen on laptop A. |
| 2:45-3:00 | Click **Safeguards**. | "What it does, what it does not do: no prediction, no risk scoring. The AI reads, the law decides, a person signs." | If anything else fails, play the backup video from the matching timestamp. |

**Rule:** never improvise numbers during the demo. If a value on screen differs from the slides, say "the slide figures are the audited ones" and move on.

---

## 3. Hard jury questions

1. **"Isn't this just a calculator?"**
   The date arithmetic is the easy part. The hard parts are reading the order, confirming facts, catching every case a person has, handling IPC to BNS, treating unknown facts as unknown, assigning an owner and due date, and producing a draft that is signed and verifiable. Existing calculators and e-Prisons date alerts cover parts of this; we combine them in one workflow.

2. **"Why did all 34 orders go to review?"**
   None of the 34 orders established prior conviction history or the absence of other holds, and the engine never treats silence as "no". There were further reasons too: NDPS charges in 10 orders, multiple applicants in 4, and unresolved penalties in 4. For a tool that drafts release applications, sending everything to a lawyer is the safe failure mode (`docs/FINDINGS.md`).

3. **"Can AI decide bail in India?"**
   No, and ours does not. The model only reads documents and masks names. The draft SC AI Regulations (3 Jun 2026) would bar AI risk scoring for bail eligibility under r.20(1)(d) and list anonymisation as permitted under r.19(1)(i). The rule engine is deterministic, shows its working and quotes the statute, and the court decides.

4. **"What if the AI misses a name?"**
   It does. Our audit found at least 26 unmasked names in 15 of 34 orders, and case numbers stayed visible in all 34. That is why model masking is only a first pass: a second person checks every displayed order and every export. We publish the leak count rather than hide it.

5. **"Who is liable if a draft is wrong?"**
   The person who signs it, as today. Every output is marked DRAFT, and the superintendent or lawyer checks and signs it. The proof trace and signed audit log show which facts were confirmed, by whom and when. The signature proves the draft was not altered, not that it is legally correct.

6. **"Why not use e-Prisons?"**
   We would complement it, not replace it. e-Prisons already records half and one-third dates from manual entry, and FASTER transmits orders. CourtPlus adds reading the order, confirming framed charges, routing unknown facts to review, multi-case checks, owners and due dates, and signed drafts. An integration would need official data access, which we do not have.

7. **"Is real data safe on AWS?"**
   Real orders never go to the cloud. They stay in an encrypted local database, are never committed or uploaded, and are deleted after judging. The AWS Mumbai backend holds anonymised handoff data only, over HTTPS, on an encrypted disk, with role-based access and SSH restricted. Processing is local, and only an operator can export.

8. **"Is the Hindi reviewed?"**
   Not yet by a fluent legal reviewer. As of 23 November 2026 the Hindi strings are machine-assisted, and English is authoritative. Our plan says Hindi drafts ship only after a fluent reviewer approves them, so we do not demo Hindi as final.

9. **"Your F1 is 0.874. Why is real-order recall so low?"**
   0.874 is on the official InLegalNER test split. On 10 Chhattisgarh High Court orders, recall was 0.077 for dates and 0.048 for case numbers, because the layouts differ from the training data. That gap is why every field needs human confirmation and why manual entry is built in. We report both numbers.

10. **"Devilal was not an undertrial. How does this help?"**
   He wasn't: he was a convict-appellant who had been acquitted. His story is about a court order that was not acted on. The "court and jail records disagree" lane flags a person still on the roster after a court event like an acquittal or a bail grant, and asks for a check of the order, the person's identity and any current holds. It needs the court-side list to reach someone, which is why the pilot uses the DLSA.

11. **"Your audit found zero eligible grants. Where is the impact?"**
   We are honest that n = 0 for the threshold-to-grant interval. High Court bail orders are a hard, selected sample. Impact has to be measured in practice, which is the point of the one-week shadow pilot with DLSA Raipur. We make no statewide claim.

12. **"What stops someone forging a draft?"**
   The Ed25519 signature is tied to the office key, and the verifier flags any change in a single byte. Log checkpoints are anchored on the DLSA handoff sheet, so rewriting history shows up. The limit: if the office key is stolen, forged drafts would verify, so key custody is a pilot requirement.

---

## 4. Sixty-second elevator pitch

On 16 November 2026 the Supreme Court raised Devilal Gond's compensation to thirty lakh rupees. The Chhattisgarh High Court acquitted him in January 2018, but he was not released until May 2025, because nobody checked and acted on the order. In Chhattisgarh, two in three prisoners are undertrials, and the prisons ran at 127.6% of capacity at the end of 2024. The law already says when an undertrial could apply for release. What breaks is finding the people who qualify and passing each case from court to jail to the DLSA to a lawyer. CourtPlus is a tool for jail offices and legal-aid lawyers. A trained model reads real court orders and masks names; on the official legal test set it scores 0.874 F1, above the published 0.810. A person confirms every fact. Then a rule engine applies section 479, shows its working step by step, assigns an owner and a due date, and writes a signed draft for a human to sign. It never predicts bail. We ran it on 34 real orders, and it honestly sent all 34 to a lawyer. Our ask is a one-week shadow pilot with DLSA Raipur.
