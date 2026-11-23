import { writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type * as Export from '@courtplus/export' with { 'resolution-mode': 'import' };
import { chainIncludesAnchor, GENESIS_HASH, verifyAuditChain } from '../audit';
import type { Store } from '../store';
import { indiaDate } from './board';
import { readSettings } from './settings';

interface AnchorPorts {
  savePath: (filename: string) => Promise<string | undefined>;
  print: (html: string) => Promise<Uint8Array>;
  localizationRoot?: string;
}

/**
 * The DLSA keeps a paper copy of the chain head. Anyone holding the database key can drop the
 * append-only triggers and rehash the log, but cannot change the hash already on the DLSA's sheet.
 */
export function createAnchor(store: Store, exports: Pick<typeof Export, 'renderHtml'>, ports: AnchorPorts) {
  async function exportHandoff(lang: 'en' | 'hi'): Promise<{ file: string; head: string } | undefined> {
    const entries = store.auditEntries();
    if (!verifyAuditChain(entries)) {
      throw new Error('The audit log failed its integrity check. Do not print a handoff sheet; report this to the DLSA.');
    }
    const head = entries.at(-1)?.hash ?? GENESIS_HASH;
    const date = indiaDate();
    const path = await ports.savePath('courtplus-dlsa-handoff-' + date + '.pdf');
    if (!path) return undefined;
    const { prison, district } = readSettings(store);
    const html = exports.renderHtml('DLSA_HANDOFF', { date, prison, dlsaName: district, auditLogHead: head }, lang, {
      localizationRoot: ports.localizationRoot,
    });
    await writeFile(path, await ports.print(html));
    store.audit('audit.anchor', { head, date });
    return { file: basename(path), head };
  }

  function checkAnchor(anchor: string): { chain: 'intact' | 'mismatch'; entries: number } {
    const entries = store.auditEntries();
    return { chain: chainIncludesAnchor(entries, anchor) ? 'intact' : 'mismatch', entries: entries.length };
  }

  return { exportHandoff, checkAnchor };
}
