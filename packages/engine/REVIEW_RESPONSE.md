# R7 engine review response

Run `npm test -w @courtplus/engine` from the repository root. Verification passed with 121 tests across four files. The review regressions are in [review.test.ts](tests/review.test.ts), [detention.test.ts](tests/detention.test.ts), and [alerts.test.ts](tests/alerts.test.ts).

## Critical

| Finding | Response and verification |
| --- | --- |
| Conviction or appeal in another case | An appeal or a conviction visible on the screening date establishes prior conviction and flags the other hold for review. Tests cover both statuses, the half fraction, the hold reason, the first-time NALSA tag and isolation from future or unrelated convictions. |
| Unverified framing overrides a death-eligible FIR | A charge needs the verification flag, a valid framing date, a document ID and a positive integer page. Tests exercise missing document and page, page zero, an impossible date, the surviving FIR and the review reason. |

## High

| Finding | Response and verification |
| --- | --- |
| Fine-only offence in custody | A zero maximum with current custody triggers urgent review. Tests check the reason, the ceiling flag and the case where only the roster confirms custody. |
| Bare offences with higher variants | IPC 451 and 392 and BNS 309(4) and 332(c) now require the limb to be identified. Tests assert the section-specific reason and the unresolved lookup. |
| BNS 303(2) repeat penalty | A bare theft charge with a prior conviction or unknown history requires review of the repeat limb. Tests cover both histories, the confirmed first-offence term and the explicit repeat term. |
| Absolute ceiling uses adjusted days | The engine uses raw custody for the ceiling and deducted custody for the fraction. The regression reaches the ceiling with only 337 counted days and confirms both board lanes. |
| Juvenile claim with IPC 302 | Review reasons take precedence over the death or life exclusion for pending undertrials. The regression verifies both juvenile and mental-health reasons. The trace cites the JJ Act's age determination and sentencing provisions. |

## Medium

| Finding | Response and verification |
| --- | --- |
| Continuation order trace | The trace reports `no record` when there is no dated evidence. An explicit unknown still triggers the continuation-order review reason. |
| IPC and BNS offence dates | The earliest known custody or first remand bounds the offence date. Tests check a post-commencement IPC date, undated BNS with pre-commencement custody and an offence date after custody. |
| Retrospective order date | A different date adds a warning and a review reason. Tests check the mismatch and 29 February 2024. |
| Reasons lost on outside-screen branches | Reasons are copied into every result. A disposed-case regression checks that the hold warning remains visible. |
| Ceiling and apply-now lanes | The result produces both lane keys when the ceiling and the application threshold are reached. |
| Arrest before first remand | One calendar day before first remand is allowed for the window check. Tests check both sides of that boundary. |
| Ongoing police custody with no dated snapshot | The standalone check marks the window unresolved and keeps any completed spells. A dated order tests all 16 police days and the over-15 alert. |
| Calendar days in lookup and screening | Both functions use month-end clamping. The optional lookup date defaults to 1 January 2025 for existing callers. Tests compare the six-month maximum at month-end and the default reference. |
| IPC 365 and BNS 140(3) bailability | Both First Schedules classify these provisions as non-bailable. IPC 365 inherits the non-bailable column through the preceding “Ditto” entries. Tests lock both classifications and the absence of a section 478 alert or NALSA category 5. [CrPC First Schedule](https://www.indiacode.nic.in/bitstream/123456789/15272/1/the_code_of_criminal_procedure%2C_1973.pdf), [BNSS First Schedule](https://www.indiacode.nic.in/bitstream/123456789/21920/1/the_bharatiya_nagarik_suraksha_sanhita%2C_2023.pdf) |
| Missing IPC 457 and BNS 331(1)–(5) | Added nine rows for the new provisions and their theft limbs. Tests verify ordinary and theft ceilings, the crosswalk, and the other subsection terms. [India Code IPC](https://www.indiacode.nic.in/repealedfileopen?rfilename=A1860-45.pdf#page=107), [India Code BNS](https://www.indiacode.nic.in/indiacode/bitstream/123456789/20062/1/a202345.pdf#page=100) |
| Third-party statute PDFs and page references | IPC links point to section pages in the India Code archive. Chhattisgarh excise links point to PDF page 59 of the official Gazette compilation for the 2011 amendment. That page documents the five-bulk-litre threshold in s.34(2) and changes to s.34(1). The unchanged repeat-conviction maxima in s.34 still need confirmation against an official consolidated source. Citation tests check representative links and pages. [India Code excise compilation](https://indiacode.gov.in/server/api/core/bitstreams/7b3b6499-dcf3-4ca7-986a-64e60196a784/content#page=59), [Supreme Court case applying the three-year maximum in s.34(2)](https://api.sci.gov.in/supremecourt/2019/7108/7108_2019_7_16_50432_Order_14-Feb-2024.pdf) |
| High Court PDFs for Hyder Ali and Mohammed Sajjid | The citations now include the case numbers and link to the official eCourts lookup forms. Direct court PDFs remain unverified because the forms require an interactive CAPTCHA. The alert test verifies both lookup links and case identifiers. [Karnataka case number search](https://hcservices.ecourts.gov.in/ecourtindiaHC/cases/s_kiosk_order.php?court_code=1&dist_cd=1&stateNm=Karnataka&state_cd=3), [Kerala neutral citation search](https://hcservices.ecourts.gov.in/ecourtindiaHC/cases/s_citation_no.php?court_code=1&dist_cd=1&stateNm=Kerala&state_cd=4) |
| Status-only review tests | The detention and review suites assert the individual reasons for multiple offences, missing case, unknown conviction, holds, continuation, unverified framing and unresolved penalties. |
| Missing date and routing regressions | The new suite covers both critical and all high findings, ongoing interim bail, same-day re-arrest, invalid framing date, leap-day `asOf`, ongoing police custody and both ceiling lanes. |

## Low

| Finding | Response and verification |
| --- | --- |
| IPC 307 and 380 mappings | The life-convict hurt limb maps to BNS 109(2). IPC 380 maps to BNS 305(a), which also has a lookup row. Mapping tests check both. |
| Same-day default-bail filings | The alert flags uncertain filing order for disputed windows as well as ordinary ones. NALSA category 8 marks the case for review when the other conditions apply. The regression checks the message, category and absence of a confirmed timely filing. |
| Disputed 60- and 90-day expiry | The alert names both dates and leaves a single due date unset. The regression checks the message and date fields. |
| July to August 2024 transition | A case with pre-commencement custody or remand in the transition window shows the s.531 warning and the date of the Supreme Court clarification. Test the first day of the window in the detention suite. |
| Unknown conviction in CrPC mode | CrPC continues with the half threshold. A test checks the projected day with unknown history. |
| Unknown juvenile and mental-health claims | The threshold trace marks each fact as unchecked. A test checks both warnings. |
| Selected case absent from the person's case list | A missing selected ID triggers review and a specific reason. |
| Same-day re-arrest clipped | Release clips detention spells that began before release. The regression verifies the new spell and the custody total. |
| Poor Prisoners quotation | The text explicitly identifies itself as a summary of the SOP. The referral test checks the label. |
| BNSS and CrPC statute handles | India Code's BNSS 21920 PDF contains the cited provisions. The old CrPC 15269 URL could not be confirmed. The CrPC citations use the retrieved 15272 PDF. The tests assert both links. [BNSS](https://www.indiacode.nic.in/bitstream/123456789/21920/1/the_bharatiya_nagarik_suraksha_sanhita%2C_2023.pdf), [CrPC](https://www.indiacode.nic.in/bitstream/123456789/15272/1/the_code_of_criminal_procedure%2C_1973.pdf) |
| Tautological and leap-day assertions | The detention tests check the day-convention language and the threshold status across a leap day. |
