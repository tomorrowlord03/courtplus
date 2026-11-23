# Court+ Citizen Legal Rights & Action Guides

This directory contains vetted, plain-language action guides designed for the Court+ Citizen Advisor.
When a citizen describes a problem in natural language (in English or Hindi), the advisor matches the problem against these guides and returns structured, actionable steps, statutory protections, limitation deadlines, helplines, and free legal aid entitlements.

## Guiding Principles & Design

1. **Deterministic, Structured Answers**: NOT a free-form conversational chatbot. One citizen query in, one structured, citable guide out.
2. **Accuracy Over Length**: Every section number is verified against the bare acts published on [India Code (indiacode.nic.in)](https://www.indiacode.nic.in) and official gazette notifications.
3. **Dual Statute Cross-Referencing**: For criminal procedural and penal laws, modern 2023 codes are used as primary with old references in brackets:
   - **BNS (Bharatiya Nyaya Sanhita, 2023)** with old **IPC (Indian Penal Code, 1860)**
   - **BNSS (Bharatiya Nagarik Suraksha Sanhita, 2023)** with old **CrPC (Code of Criminal Procedure, 1973)**
   - **BSA (Bharatiya Sakshya Adhiniyam, 2023)** with old **IEA (Indian Evidence Act, 1872)**
4. **Official Sources Only**: All citations and links point exclusively to official government portals (`indiacode.nic.in`, `egazette.gov.in`, `nalsa.gov.in`, `mha.gov.in`, `wcd.nic.in`, `consumerhelpline.gov.in`, `cybercrime.gov.in`, or Supreme Court/High Court reported judgments).
5. **Human Language & Bilingual Keywords**: Every topic provides comprehensive English (`keywords_en`) and Devanagari Hindi (`keywords_hi`) keywords, titles, and step descriptions for natural matching.

---

## Catalog of Topics Covered

| ID | Topic | Primary Statutes & Verified Sections | Key Limitation / Timeline | Official Source |
|---|---|---|---|---|
| `road-accident` | Road Accident Injury / Death & MACT | MV Act 1988 s.166, s.164 (No-fault Rs. 5L/2.5L), s.161 (Hit & Run Rs. 2L/50k), s.134A (Good Samaritan); BNS s.106(1) [IPC 304A] | 6 months from accident for MACT claim (s.166(3)); Police DAR within 90 days | indiacode.nic.in/1798 |
| `police-refuses-fir` | Police Refusal to Register FIR | BNSS 2023 s.173(1)-(2) (Mandatory Zero/e-FIR), s.173(4) (SP remedy), s.175(3) (Magistrate application); BNS s.199 [IPC 166A] | Promptly; Lalita Kumari (2014) 2 SCC 1 | indiacode.nic.in/21920 |
| `domestic-violence` | Domestic Violence | PWDVA 2005 s.3, s.12, s.18 (Protection), s.19 (Residence), s.20 (Monetary), s.21 (Custody), s.22 (Compensation), s.31 (Breach penalty) | Urgent ex-parte interim relief under s.23; Rajnesh v. Neha guidelines | indiacode.nic.in/2021 |
| `dowry-cruelty` | Dowry Demands & Cruelty | BNS 2023 s.85/s.86 [IPC 498A], s.80 [IPC 304B]; Dowry Prohibition Act 1961 s.3, s.4, s.6; BSA s.118 [IEA 113B] | Cruelty soon before death within 7 years of marriage for dowry death | indiacode.nic.in/21921 |
| `cheque-bounce` | Cheque Dishonour | NI Act 1881 s.138, s.141, s.142, s.143A (20% interim compensation) | Cheque 3 mos; Notice within 30 days of memo; 15 days to pay; Court complaint within 30 days | indiacode.nic.in/2202 |
| `consumer-complaint` | Consumer Grievance & Defective Goods | Consumer Protection Act 2019 s.2(7), s.2(11), s.34 (District <= 50L), s.35 (e-Daakhil), s.47, s.58, s.69 | Within 2 years of cause of action (s.69) | indiacode.nic.in/15256 |
| `cybercrime-fraud` | Online Fraud, UPI & Cybercrime | IT Act 2000 s.66, s.66C, s.66D; BNS s.318(4) [IPC 420], s.316 [IPC 405/406]; BNSS s.503 [CrPC 457] | Golden hour (first 2-3 hrs) dial 1930; RBI 3-day zero liability rule | indiacode.nic.in/1999 |
| `unpaid-wages` | Unpaid Wages & Salary Arrears | Payment of Wages Act 1936 s.3, s.4, s.5, s.15(2); Minimum Wages Act 1948 s.12, s.20; Gratuity Act 1972 | Within 12 months under s.15(2) (condonable for cause); wages due by 7th/10th | indiacode.nic.in/2386 |
| `tenant-landlord` | Tenant & Landlord Rights | CG Rent Control Act 2011 s.4, s.5, s.8, Sched. 2 & 3; Transfer of Property Act 1882 s.106, s.108; BNS s.329 [IPC 441] | 15 days notice for month-to-month lease; essential services cannot be cut | indiacode.nic.in/10041 |
| `property-land-dispute` | Land & Property Disputes | CPC 1908 s.9, Order 39 Rules 1-2; Specific Relief Act 1963 s.5, s.6, s.34, s.38; Limitation Act Arts. 64/65 | Section 6 summary suit strictly within 6 months; adverse possession 12 years | indiacode.nic.in/2191 |
| `arrest-rights` | Rights of Arrested Persons | BNSS 2023 s.35 [CrPC 41], s.47 [CrPC 50], s.48 [CrPC 50A], s.53 [CrPC 54], s.58 [CrPC 57]; D.K. Basu guidelines | Strictly within 24 hours magistrate production; immediate memo & medical | indiacode.nic.in/21920 |
| `free-legal-aid` | Free Legal Services & Lok Adalats | Legal Services Authorities Act 1987 s.12, s.13, s.19-21; Constitution Art. 39A; NALSA Helpline 15100 | Pre-litigation, trial & appellate stages; all women, children & workers eligible | indiacode.nic.in/1932 |
| `maintenance` | Maintenance for Family & Parents | BNSS 2023 s.144 [CrPC 125], s.144(3); Senior Citizens Act 2007 s.4, s.5, s.9, s.23 (cancellation of deed); Rajnesh v Neha | Interim maintenance within 60 days of notice; arrears execution within 1 year | indiacode.nic.in/21920 |
| `workplace-sexual-harassment` | Workplace Sexual Harassment (POSH) | POSH Act 2013 s.2(n), s.3, s.4 (IC), s.6 (LC), s.9, s.11, s.12, s.16; BNS s.75 [IPC 354A], s.78 [IPC 354D] | Complaint within 3 months (extendable by 3 mos); inquiry within 90 days | indiacode.nic.in/2104 |

---

## Schema per Topic JSON

```json
{
  "id": "string (kebab-case identifier)",
  "title_en": "string",
  "title_hi": "string",
  "keywords_en": ["array of english search phrases"],
  "keywords_hi": ["array of devanagari search phrases"],
  "laws": [
    {
      "act": "Statute name with enactment year",
      "section": "Section number with new/old dual reference where applicable",
      "plain_meaning": "Citizen-accessible plain-language summary of rights/liabilities",
      "source_url": "Official indiacode.nic.in or gov portal URL"
    }
  ],
  "steps": [
    {
      "order": 1,
      "action_en": "Actionable instruction in English",
      "action_hi": "Actionable instruction in Devanagari Hindi",
      "where": "Designated authority / office / court / portal",
      "deadline_or_limitation": "Statutory time limit or urgency guidance",
      "documents_needed": ["List of physical/digital proofs needed"]
    }
  ],
  "helplines": [
    {
      "name": "Helpline name",
      "number": "Toll-free / official number",
      "description": "Scope of emergency or advice service"
    }
  ],
  "free_legal_aid": {
    "eligible": "Statutory criteria under Section 12 LSAA 1987",
    "how_to_apply": "Step-by-step procedure at DLSA front office / 15100",
    "authority": "District Legal Services Authority / TLSC",
    "helpline": "15100"
  },
  "when_to_see_a_lawyer": [
    "Specific warning indicators and trigger scenarios requiring advocate intervention"
  ],
  "last_checked": "2026-11-23",
  "sources": ["Array of official URLs"],
  "hi_reviewed": false
}
```

## Section Verification Notes

- **Motor Vehicles Act, 1988**: Section 166 (Claims Tribunal application), Section 164 (No-fault compensation scheme inserted by MV Amendment Act 2019 replacing old s.140/163A), Section 161 (Hit and run compensation scheme amended in 2022 increasing solatium to Rs. 2 lakh for death and Rs. 50,000 for grievous hurt), Section 134A (Good Samaritan protection inserted by 2019 amendment). Verified on indiacode.nic.in act id 1798.
- **BNSS 2023 vs CrPC 1973**:
  - FIR: BNSS s.173 replaces CrPC s.154. Explicitly codifies e-FIR and Zero FIR transfer.
  - Superintendent of Police remedy: BNSS s.173(4) corresponds to CrPC s.154(3).
  - Magistrate direction for investigation: BNSS s.175(3) corresponds to CrPC s.156(3) with new requirement of mandatory affidavit and prior s.173(4) compliance.
  - Arrest provisions: BNSS s.35 (old s.41), s.47 (old s.50), s.48 (old s.50A), s.53 (old s.54), s.58 (old s.57).
  - Maintenance: BNSS s.144 corresponds to CrPC s.125.
  - Seized money / property disposal: BNSS s.503 corresponds to CrPC s.457.
- **BNS 2023 vs IPC 1860**:
  - Rash driving: BNS s.281 (old IPC s.279).
  - Death by negligence: BNS s.106(1) (old IPC s.304A).
  - Cruelty to woman: BNS s.85/86 (old IPC s.498A).
  - Dowry death: BNS s.80 (old IPC s.304B).
  - Cheating: BNS s.318(4) (old IPC s.420).
  - Criminal breach of trust: BNS s.316 (old IPC s.405/406).
  - Public servant disobeying law on recording information: BNS s.199 (old IPC s.166A).
  - Sexual harassment: BNS s.75 (old IPC s.354A); Stalking: BNS s.78 (old IPC s.354D).
  - Criminal trespass & intimidation: BNS s.329 (old IPC s.441) and s.351 (old IPC s.506).
- **Chhattisgarh Rent Control Act, 2011 (CG Act No. 19 of 2012)**:
  - Tenancy agreements mandatory in writing: Section 4.
  - Rent payable: Section 5.
  - Rent Controller / Tribunal exclusive jurisdiction: Section 8.
  - Landlord and Tenant rights: Schedules 2 and 3. Verified on indiacode.nic.in act id 10041.
- **Consumer Protection Act, 2019**:
  - Enacted 2019, operational July 2020. Pecuniary jurisdictions updated by notification: District Commission up to Rs. 50 lakh; State Commission Rs. 50 lakh to Rs. 2 crore; National Commission above Rs. 2 crore. e-Daakhil filing governed by Section 35. Limitation period is 2 years under Section 69.

All topics have `hi_reviewed: false` indicating that while the Hindi text and keywords are authentic and verified for statutory terminology, fluent native speaker review before final public production rollout is earmarked.
