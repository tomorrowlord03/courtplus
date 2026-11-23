import { join } from 'node:path';
import { readOptional, supportedLanguages, type Language } from './resources.js';

const english = {
  rights_card_title: 'Prisoner Legal Rights Card',
  rights_legal_aid_statutory: 'People in custody have a right to free legal aid under section 12 of the Legal Services Authorities Act, 1987.',
  rights_bnss_479_release: 'Under section 479 of the Bharatiya Nagarik Suraksha Sanhita (BNSS), an undertrial who has never been convicted of any offence may be released on bond after spending one-third of the maximum prison term for the offence in custody; other undertrials may be released on bail after one-half. This does not apply to offences punishable with death or life imprisonment. It may not apply if more than one offence or case is pending; ask a lawyer to check. The court decides. After hearing the Public Prosecutor, the court may order continued custody, giving written reasons.',
  rights_superintendent_duty: 'Under BNSS section 479(3), the jail superintendent must apply to the court when the relevant custody threshold is reached.',
  rights_post_bail_7_days: 'If you are still in jail seven days after bail was granted, the jail superintendent must inform the District Legal Services Authority (DLSA), under the Supreme Court order of 31 January 2023.',
  rights_ask_lawyer: 'You can ask the DLSA for a free legal aid lawyer.',
  rights_contact: 'Contact {dlsaName} at {dlsaPhone}.',
  rights_disclaimer: 'The court makes the decision about release.',
};

type RightsCopy = Record<keyof typeof english, string>;

function loadRights(root: string, lang: Language) {
  const file = readOptional(join(root, 'data', 'i18n', lang + '.json'));
  if (!file) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(file.toString('utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const data = parsed as Partial<RightsCopy> & { _meta?: { reviewed?: boolean; machineTranslated?: boolean } };
  for (const key of Object.keys(english) as (keyof RightsCopy)[]) {
    const value = data[key];
    if (typeof value !== 'string' || !value.trim()) return undefined;
  }
  if (!data.rights_contact?.includes('{dlsaName}') || !data.rights_contact.includes('{dlsaPhone}')) return undefined;
  return {
    copy: data as RightsCopy,
    reviewed: data._meta?.reviewed === true,
    machineTranslated: data._meta?.machineTranslated !== false,
  };
}

export function rightsCopy(root: string, requested: string) {
  const code = requested.trim().toLowerCase().split('-')[0];
  const lang = supportedLanguages.find((language) => language === code);
  const translated = lang ? loadRights(root, lang) : undefined;
  const enCopy = (lang === 'en' ? translated?.copy : loadRights(root, 'en')?.copy) ?? english;

  if (lang && lang !== 'en' && translated) {
    if (lang === 'hi') {
      return {
        lang,
        copy: translated.copy,
        notice: translated.reviewed
          ? ''
          : 'मशीन अनुवाद, समीक्षा बाकी। Machine translation, not yet reviewed. The English card is authoritative.',
      };
    }
    const combinedCopy: RightsCopy = {
      rights_card_title: `${translated.copy.rights_card_title} / ${enCopy.rights_card_title}`,
      rights_legal_aid_statutory: `${translated.copy.rights_legal_aid_statutory}\n\n${enCopy.rights_legal_aid_statutory}`,
      rights_bnss_479_release: `${translated.copy.rights_bnss_479_release}\n\n${enCopy.rights_bnss_479_release}`,
      rights_superintendent_duty: `${translated.copy.rights_superintendent_duty}\n\n${enCopy.rights_superintendent_duty}`,
      rights_post_bail_7_days: `${translated.copy.rights_post_bail_7_days}\n\n${enCopy.rights_post_bail_7_days}`,
      rights_ask_lawyer: `${translated.copy.rights_ask_lawyer}\n\n${enCopy.rights_ask_lawyer}`,
      rights_contact: `${translated.copy.rights_contact}\n${enCopy.rights_contact}`,
      rights_disclaimer: `${translated.copy.rights_disclaimer}\n\n${enCopy.rights_disclaimer}`,
    };
    return {
      lang,
      copy: combinedCopy,
      notice: translated.reviewed
        ? ''
        : 'Machine translation, not legally reviewed. The English text is authoritative.',
    };
  }

  return {
    lang: 'en' as const,
    copy: enCopy,
    notice: code === 'en' ? '' : 'The requested translation is unavailable. This card is in English.',
  };
}
