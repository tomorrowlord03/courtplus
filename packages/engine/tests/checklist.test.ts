import { describe, expect, it } from 'vitest';
import { proceduralChecklist } from '../src/checklist.js';

describe('case-file procedural checklist', () => {
  it('links all relevant checks to extracted evidence and legal authorities', () => {
    const text = [
      'The fictional Accused-1 was arrested under section 379 IPC.',
      'The remand order records that the charge sheet had not been filed after 62 days.',
      'The prosecution tendered CCTV footage and WhatsApp messages.',
      'The accused police officer was prosecuted for an act in purported discharge of official duty.',
      'Counsel applied for condonation of delay in filing the appeal.',
    ].join('\n');
    const checks = proceduralChecklist(text);
    expect(checks.map(check => check.id)).toEqual([
      'arrest-necessity', 'arrest-grounds', 'default-bail', 'electronic-evidence', 'public-servant-sanction', 'limitation',
    ]);
    for (const item of checks) {
      expect(item.check).toMatch(/^Check /);
      expect(text).toContain(item.evidence);
      expect(item.sources.some(source => source.url.startsWith('https://www.indiacode.nic.in/'))).toBe(true);
    }
  });

  it('only prompts for recorded facts, and keeps longer sentences outside the short-term arrest check', () => {
    const text = [
      'A fictional judge heard a civil rent dispute and sent a procedural email.',
      'A police officer witnessed the exchange.',
      'The parties discussed the deadline for rent.',
      'Counsel sought anticipatory bail on instructions.',
    ].join('\n');
    expect(proceduralChecklist(text)).toEqual([]);
    expect(proceduralChecklist('The defendant was arrested for an offence punishable with imprisonment for seven years to ten years.')
      .map(item => item.id)).toEqual(['arrest-grounds']);
    expect(proceduralChecklist('The accused was arrested under section 302 IPC.').map(item => item.id)).toEqual(['arrest-grounds']);
  });

  it('recognises an appearance notice without treating it as an arrest', () => {
    const result = proceduralChecklist('Police issued a notice under section 35(3) to the fictional applicant.');
    expect(result.map(item => item.id)).toEqual(['arrest-necessity']);
  });
});
