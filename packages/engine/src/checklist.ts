import type { Authority, ProceduralCheck } from '@courtplus/contracts';
import { lookupOffence } from './offences.js';

const bnss = 'https://www.indiacode.nic.in/bitstream/123456789/20340/1/bnss%2C_2023.pdf';
const bsa = 'https://www.indiacode.nic.in/bitstream/123456789/20063/1/aa202347.pdf';
const law = (act: string, section: string, text: string, url = bnss): Authority => ({ act, section, text, url });

interface Rule {
  id: string;
  label: string;
  check: string;
  evidence: (passages: string[]) => string | undefined;
  sources: Authority[];
}

const arrest = /\b(?:was arrested|were arrested|police arrested|arrested (?:on|at|under|for)|arrest memo|grounds of arrest|taken into (?:police )?custody|notice of appearance)\b|\bnotice under (?:section )?35\(3\)/i;
const arrestTerm = /\b(?:punish(?:able|ment)|maximum (?:term|sentence|imprisonment))\b[^.;\n]{0,100}?\b(?:up to |not exceeding )?([1-7]|one|two|three|four|five|six|seven)\s*years?\b/i;
const charge = /\b(?:under|charged (?:under|with)|offences? (?:under|punishable under))\s+(?:section\s+|s\.\s*)?(\d+[a-z]?(?:\([\da-z]+\))?)\s+(?:of\s+(?:the\s+)?)?(IPC|BNS|Indian Penal Code|Bharatiya Nyaya Sanhita)\b/gi;

function shortTermArrest(passages: string[]): string | undefined {
  return passages.find(passage => {
    if (!arrest.test(passage)) return false;
    const maxTerm = arrestTerm.test(passage) && !/\b(?:life imprisonment|imprisonment for life|death penalty|(?:minimum|at least)\s+(?:of\s+)?(?:[1-7]|one|two|three|four|five|six|seven)\s+years?)\b/i.test(passage)
      && !/\byears?\s+(?:or more|to\s+(?:eight|nine|ten|\d+))\b/i.test(passage);
    if (maxTerm || /\b35\(3\)/.test(passage)) return true;
    return [...passage.matchAll(charge)].some(([, section, act]) => {
      const provision = lookupOffence(/^(?:IPC|Indian)/i.test(act) ? 'IPC' : 'BNS', section);
      return provision?.maxDays !== undefined && provision.maxDays <= 2557;
    });
  });
}

const rules: Rule[] = [
  {
    id: 'arrest-necessity', label: 'Arrest procedure for offences up to seven years',
    check: 'Check the law applicable on the arrest date, the recorded necessity and reasons for arrest, and whether an appearance notice was required and complied with. Check the Magistrate’s scrutiny of the reasons.',
    evidence: shortTermArrest,
    sources: [
      law('BNSS', '§35(1)(b), (3)–(6)', 'Necessity, recorded reasons and notice of appearance'),
      law('Arnesh Kumar v. State of Bihar (2014)', 'Directions at ¶11 (judgment ¶7.1–11)', 'Arrest and remand safeguards under the CrPC', 'https://indiankanoon.org/doc/2982624/'),
    ],
  },
  {
    id: 'arrest-grounds', label: 'Communication of written grounds of arrest',
    check: 'Check when and how the written grounds were supplied, whether the person understood the language, and the timing rules applicable to this arrest.',
    evidence: passages => passages.find(passage => arrest.test(passage) && !/\b(?:notice (?:of appearance|under)|anticipatory bail)\b/i.test(passage))
      ?? passages.find(passage => /\bgrounds of arrest\b/i.test(passage)),
    sources: [
      law('BNSS', '§47(1)', 'Communication of grounds of arrest'),
      law('Pankaj Bansal v. Union of India (2023)', '¶¶35–39', 'Written grounds in the PMLA context', 'https://indiankanoon.org/doc/189692408/'),
      law('Prabir Purkayastha v. State (NCT of Delhi) (2024)', '¶¶20–22, 48–50', 'Article 22(1) and written grounds in the UAPA context', 'https://indiankanoon.org/doc/17476648/'),
      law('Mihir Rajesh Shah v. State of Maharashtra (2025)', '2025 INSC 1288, ¶¶55–56', 'Written grounds across offences and timing before remand', 'https://ganjam.dcourts.gov.in/document/judgment-dtd-06-11-2025-passed-in-criminal-appeal-no-2195-of-2025-mihir-rajesh-shah-vrs-state-of-maharashtra-and-another-by-honble-the-supreme-court-of-india/'),
    ],
  },
  {
    id: 'default-bail', label: 'Charge-sheet filing and default bail',
    check: 'Check the first remand and filing dates, the applicable 60- or 90-day period, any special-law extension, and when the accused applied and was ready to furnish bail.',
    evidence: passages => passages.find(passage => /\b(?:default bail|statutory bail)\b|\b(?:167\(2\)\s*(?:of (?:the )?)?Cr\.?P\.?C\.?|187\(3\))/i.test(passage)
      || /\b(?:remand(?:ed)?|judicial custody|detention)\b/i.test(passage)
        && /\b(?:charge[ -]?sheet|police report|pending investigation|(?:[6-9]\d|\d{3,}) days|sixty days|ninety days)\b/i.test(passage)),
    sources: [law('BNSS', '§187(3)', '90 days for death, life imprisonment or a term of ten years or more, and 60 days for other offences')],
  },
  {
    id: 'electronic-evidence', label: 'Certificate for electronic evidence',
    check: 'Check the applicable evidence regime and how the electronic record is tendered. For a computer output under the BSA, check the prescribed certificate and its submission with the record.',
    evidence: passages => passages.find(passage => /\b(?:section\s+65b|65b certificate|(?:section\s+)?63\s+(?:of (?:the )?)?(?:BSA|Bharatiya Sakshya Adhiniyam)|electronic (?:record|evidence))\b/i.test(passage)
      || /\b(?:CCTV|WhatsApp (?:messages?|chats?)|screenshots?|call detail records?|audio recording|video recording|e-?mails?)\b/i.test(passage)
        && /\b(?:seized|relied on|relied upon|produced|exhibited|filed|submitted|adduced|tendered|evidence|certificate)\b/i.test(passage)),
    sources: [
      law('Bharatiya Sakshya Adhiniyam', '§63(4) and Schedule', 'Certificate accompanying computer output', bsa),
      law('Arjun Panditrao Khotkar v. Kailash Kushanrao Gorantyal (2020)', '¶¶73.1–73.2', 'Certificate requirement under former Evidence Act §65B', 'https://indiankanoon.org/doc/172105947/?type=print'),
    ],
  },
  {
    id: 'public-servant-sanction', label: 'Sanction for prosecuting a public servant',
    check: 'Check the link between the alleged act and official duty, whether the office is covered, any statutory exception, and whether sanction was obtained or deemed after the applicable period.',
    evidence: passages => passages.find(passage => /\b(?:sanction (?:for prosecution|to prosecute)|prosecution sanction|previous sanction)\b/i.test(passage)
      || /\b(?:public servant|government officer|police officer|magistrate|judge)\b/i.test(passage)
        && /\b(?:accused|prosecuted|charged with|allegations? against|cognizance against)\b/i.test(passage)
        && /\b(?:official (?:duty|duties|capacity)|colour of office|sanction)\b/i.test(passage)),
    sources: [law('BNSS', '§218(1)–(4)', 'Previous sanction, official duty, exceptions and the 120-day decision period')],
  },
  {
    id: 'limitation', label: 'Limitation and filing dates',
    check: 'Check the applicable Schedule article or special law, the start and filing dates, and any exclusion, extension or condonation available for this type of proceeding.',
    evidence: passages => passages.find(passage => /\b(?:barred by limitation|limitation period|period of limitation|limitation act|time[- ]barred|condonation of delay|delay in filing (?:the )?(?:suit|appeal|application))\b/i.test(passage)),
    sources: [law('Limitation Act 1963', '§§3–5, 12–24, 29(2) and Schedule', 'Limitation periods, exclusions and special laws', 'https://www.indiacode.nic.in/bitstream/123456789/1565/5/A1963-36.pdf')],
  },
];

export function proceduralChecklist(maskedText: string): ProceduralCheck[] {
  const passages = maskedText.replace(/[^\S\r\n\f]+/g, ' ')
    .split(/[\r\n\f]+|(?<=[.!?।])\s+(?=[\p{Lu}])/u).map(passage => passage.trim()).filter(Boolean);
  return rules.flatMap(rule => {
    const evidence = rule.evidence(passages);
    return evidence ? [{ id: rule.id, label: rule.label, check: rule.check, evidence, sources: rule.sources }] : [];
  });
}
