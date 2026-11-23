import type { Authority } from '@courtplus/contracts';
import { quotes } from './generated/quotes.js';

function authority(act: string, section: string, text: string, url: string): Authority {
  return { act, section, text, url };
}

export const statute = quotes;
export const section479 = [statute.bnss479_1, statute.bnss479_2, statute.bnss479_3];
export const aug2024 = authority('Supreme Court', '23 August 2024, paras 3–6',
  'Section 479 applies to undertrials in pending cases registered before 1 July 2024 as well.',
  'https://api.sci.gov.in/supremecourt/2013/18545/18545_2013_9_2_55018_Order_23-Aug-2024.pdf');
export const nov2024 = authority('Supreme Court', '19 November 2024, para 11',
  'Verify the offences actually charged where jail records still show the original FIR offences.',
  'https://api.sci.gov.in/supremecourt/2013/18545/18545_2013_4_10_57306_Order_19-Nov-2024.pdf');
export const wadhawan = authority('Supreme Court', 'Kapil Wadhawan, 27 March 2023',
  'Count the first remand day in the default-bail period.',
  'https://api.sci.gov.in/supremecourt/2020/17613/17613_2020_16_1501_43163_Order_27-Mar-2023.pdf');
export const ravindran = authority('Supreme Court', 'M. Ravindran, 26 October 2020',
  'A subsequent charge sheet does not defeat a right already availed of by an application made after expiry.',
  'https://api.sci.gov.in/supremecourt/2020/8936/8936_2020_39_1501_24488_Judgement_26-Oct-2020.pdf');
export const tenYearCases = [
  authority('Karnataka High Court', 'Hyder Ali, W.P. 33526/2024 with Crl.P. 13459/2024, 13 December 2024',
    'The court applied the shorter period to the offence punishable up to ten years in that case.',
    'https://hcservices.ecourts.gov.in/ecourtindiaHC/cases/s_kiosk_order.php?court_code=1&dist_cd=1&stateNm=Karnataka&state_cd=3'),
  authority('Kerala High Court', 'Mohammed Sajjid, 2025:KER:10727, B.A. 910/2025, 10 February 2025',
    'The court applied the shorter period to NDPS section 22(b) in that case.',
    'https://hcservices.ecourts.gov.in/ecourtindiaHC/cases/s_citation_no.php?court_code=1&dist_cd=1&stateNm=Kerala&state_cd=4')
];
export const postBail = authority('Supreme Court', 'In Re Policy Strategy for Grant of Bail, 31 January 2023',
  'After seven days without release, inform the DLSA Secretary. After one month with bail bonds unfurnished, the granting court may consider relaxation on its own motion.',
  'https://api.sci.gov.in/supremecourt/2021/26546/26546_2021_2_23_41396_Order_31-Jan-2023.pdf');
export const poor = quotes.poorPrisoners;
export const nalsa = authority('NALSA', 'Revised UTRC categories 1–16',
  'Categories identify cases for Under Trial Review Committee action and review.',
  'https://cdnbbsr.s3waas.gov.in/s32e45f93088c7db59767efef516b306aa/uploads/2026/02/20260209543755368.pdf#page=4');
export const antil = authority('Supreme Court', 'Satender Kumar Antil, 11 July 2022',
  'A: up to seven years excluding B and D. B: death, life or more than seven years. C: special Acts with stringent bail conditions. D: other economic offences.',
  'https://api.sci.gov.in/supremecourt/2021/27955/27955_2021_5_1505_36261_Judgement_11-Jul-2022.pdf');
export const juvenile = authority('JJ Act', '21, 94',
  'Review the evidence of age and the statutory limits on sentencing a child.',
  'https://upload.indiacode.nic.in/showfile?actid=AC_CEN_13_14_000010_201602_1517807328168&filename=a2016-2.pdf&type=actfile');
export const mentalHealth = authority('MHCA', '103', 'Review the statutory pathway for prisoners with mental illness.',
  'https://upload.indiacode.nic.in/showfile?actid=AC_CEN_12_13_00024_201710_1517807327874&filename=a2017-10.pdf&type=actfile');
