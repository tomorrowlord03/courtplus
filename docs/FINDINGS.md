# Retrospective real-order audit cohort

**Audit date:** 23 November 2026, 08:56 IST, after the intake fixes through `e5069db`. **Source:** 34 published Chhattisgarh High Court bail orders dated October 2026. This is a convenience sample, not a representative sample. Every screen is retrospective at the order date; these findings make no claim about anyone's current custody or legal status.

## Headline results

| Measure | Result |
| --- | ---: |
| Orders imported and screened | 34 / 34 |
| Orders with one coherent order date, charged offence set, and custody start for an order-level screen | 30 / 34 |
| `APPLY_NOW` | 0 / 34 |
| `DUE_IN_N_DAYS` | 0 / 34 |
| `NEEDS_LAWYER_REVIEW` | 34 / 34 |
| `OUTSIDE_SCREEN` | 0 / 34 |
| Verified eligible grants with a stated grant date and calculable s.479 threshold | 0 / 27 granted orders |

The threshold-to-grant interval has **n = 0**; median and range are therefore **not calculable**. The orders' stated outcomes were 27 grants, 5 rejections, 1 withdrawal, and 1 order with mixed outcomes for different applicants (34 total). A grant order records a judicial decision, not proof of release from custody.

## Offence mix

Counts are orders mentioning at least one charged offence under the Act. Acts can overlap within an order, so the counts do not sum to 34. Procedural bail provisions and common-intention provisions were not counted as separate offences.

| Act | Orders |
| --- | ---: |
| Bharatiya Nyaya Sanhita (BNS) | 16 |
| Narcotic Drugs and Psychotropic Substances Act (NDPS) | 10 |
| Chhattisgarh Excise Act | 8 |
| Indian Penal Code (IPC) | 2 |
| Arms Act | 2 |
| Information Technology Act | 1 |
| Chhattisgarh Freedom of Religion Act | 1 |
| Chhattisgarh Agricultural Cattle Preservation Act | 1 |
| Motor Vehicles Act | 1 |

## Why lawyer review was required

All 34 orders left prior conviction history or other current holds insufficiently established for the engine's release screen. Additional overlapping review reasons were NDPS special-law charges in 10 orders, multiple applicants or cases with nonuniform facts in 4, and additional Acts whose penalties the engine could not resolve in 4. The 30 orders with coherent core fields were still review cases; “enough facts” here means enough to run an order-level screen, not enough to establish entitlement or release.

## AI extraction and masking audit

The field comparison treats each order as one unit. A field is correct only when the promoted value exactly matches the human-checked value; a full charge set must match. “Proposed” counts promoted suggestions where one verified value exists. “Known” counts orders with a single verifiable value for that field.

| Field | Exact / proposed | Exact / known |
| --- | ---: | ---: |
| Charged offence set and Act | 9 / 9 | 9 / 34 |
| Custody-since date | 32 / 32 | 32 / 32 |
| Order date | 34 / 34 | 34 / 34 |
| Bail outcome | 0 / 0 | 0 / 34 |

The AI also promoted a single custody date in 2 orders that had different dates across applicants or cases, so those promotions were unusable for one applicant's case history. All 34 orders had a correct raw order-date candidate, and each passed the script's header-context check. The intake does not propose a bail-outcome field, so that field was checked entirely by hand. The charge-set measure uses the script's conservative single-candidate promotion rule; it does not count every suggestion shown in the desktop UI. These are exact field measures for this cohort, not the model's held-out entity F1.

I read the full masked text of all 34 orders and checked residual personal-name text against the originals. **At least 26 unmasked person-name occurrences or fragments remained in 18 / 34 orders** (22 distinct strings across the cohort). This includes names in narrative text and court sign-off lines; three additional ambiguous sign-off fragments were excluded from the confirmed minimum. A broader identifier check found **visible court citation, case or crime identifiers in 32 / 34 masked outputs**. The previous `MCRC No.`-only check missed these other formats. These counts do not certify the other two orders as safe. A separate human release check remains mandatory before display or export.

## Method and limits

The audit script imported each local PDF through the current `@courtplus/intake` source with the locally trained LegalNER model, promoted only single candidate suggestions under conservative cue checks, and screened a contract-shaped CaseRecord through the current `@courtplus/engine` source at `asOf = orderDate`. Because this worktree has no installed packages, `scripts/cohort/prepare-runtime.mjs` transpiled those sources into the ignored cohort `dist/` using installed dependencies from the adjacent checkout. I reused the previous hand-checked charge, custody, date and outcome facts in a local verification file that is not published, replayed every screen, then read every new masked output in full and checked observed name leaks against the original text. The ignored output contains per-order alias records, field-level comparisons, the private text review and `summary.json`; none of the order text or identifying facts is committed.

The CaseRecords use FIR charges provisionally because these orders did not supply verified framing orders. A continuing custody spell represents only the order's stated custody start through its hearing date; interim release, accused-caused delay, independent jail roster, other cases, prior convictions, and later release were not assumed from silence. Four combined orders cannot be reduced to one unambiguous applicant and case history. Some charged Acts and penalty variants are outside the engine's resolved table. The retrospective status counts are routing results for checking, not findings that s.479 relief was legally due or that any person remained detained after the order.
